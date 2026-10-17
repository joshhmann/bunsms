"""Exercise the real aiohttp service against isolated immutable registry objects."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer

SPEC = importlib.util.spec_from_file_location(
    'nx_cohort_server', Path(__file__).resolve().parents[2] / 'web-client' / 'server.py')
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class NxCohortTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for directory in ('web', 'build', 'baseline', 'assets'):
            (self.root / directory).mkdir()
        self.authority = self.root / 'authority.json'
        self.patches = patch.multiple(server, STATIC_ROOT=str(self.root),
            NX_LOCAL_DIR=str(self.root / 'baseline'),
            CLIENT_ASSETS_DIR=str(self.root / 'assets'),
            CLIENT_MANIFEST_PATH=str(self.authority))
        self.patches.start()
        self.environment = patch.dict(os.environ, {'GAME_CONTROL_SOCKET': '', 'GM_API_SECRET': 'secret'})
        self.environment.start()
        self.client = TestClient(TestServer(server.build_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.environment.stop()
        self.patches.stop()
        self.temp.cleanup()

    def write_json(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def cohort(self, release, marker=b'old', state=None, missing=None):
        assets = {}
        keys = (tuple('nx/' + name for name in server.NX_NAMES) +
                tuple(name[:-3] + '.wz' for name in server.NX_NAMES) +
                ('List.wz', 'server-wz.tar.gz'))
        for key in keys:
            name = key.rsplit('/', 1)[-1]
            if name == missing:
                continue
            data = marker + b':' + name.encode()
            digest = hashlib.sha256(data).hexdigest()
            path = self.root / 'assets' / 'objects' / digest / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o444)
            assets[key] = {'key': key, 'hash': digest, 'size': len(data)}
        view = {'releaseId': release, 'assets': assets, 'files': []}
        if state:
            self.write_json(self.root / 'assets' / 'staging' / release / 'release.json',
                {'id': release, 'state': state, 'base': {'assets': {}}, 'prepared': assets})
        else:
            self.write_json(self.root / 'assets' / 'manifests' / (release + '.json'), view)
        return view

    async def test_native_snapshot_is_required_and_stock_isolated(self):
        for missing in ('List.wz', 'Map.wz', 'server-wz.tar.gz'):
            self.cohort('release_bad', missing=missing)
            response = await self.client.get('/nx/manifest.json?releaseId=release_bad')
            self.assertEqual(response.status, 404)
        view = self.cohort('release_old')
        # Profile-specific extras are not part of the generic native projection.
        view['assets']['Custom.wz'] = {'key': 'Custom.wz', 'hash': 'f' * 64, 'size': 5}
        view['assets']['Ezorsia.wz'] = {'key': 'Ezorsia.wz', 'hash': 'e' * 64, 'size': 5}
        self.write_json(self.root / 'assets/manifests/release_old.json', view)
        response = await self.client.get('/nx/manifest.json?releaseId=release_old')
        self.assertEqual(response.status, 200)
        projection = await response.json()
        self.assertEqual(len(projection['nativeFiles']), 17)
        self.assertNotIn('Custom.wz', {item['name'] for item in projection['nativeFiles']})
        self.assertNotIn('Ezorsia.wz', {item['name'] for item in projection['nativeFiles']})

    async def test_publication_rollback_and_legacy_never_mix(self):
        old = self.cohort('release_old')
        new = self.cohort('release_new', b'new', state='sealed')
        (self.root / 'baseline' / 'Base.nx').write_bytes(b'legacy')
        for authority in (old, new, old):
            self.write_json(self.authority, authority)
            response = await self.client.get('/nx/manifest.json')
            self.assertEqual(response.status, 200)
            projection = await response.json()
            self.assertEqual(projection['releaseId'], authority['releaseId'])
            self.assertEqual(len(projection['files']), 16)
            self.assertEqual(len(projection['nativeFiles']), 17)
            self.assertEqual({item['name'] for item in projection['nativeFiles']},
                {name[:-3] + '.wz' for name in server.NX_NAMES} | {'List.wz'})
            for item in projection['nativeFiles'] + [projection['serverTar']]:
                native_response = await self.client.get(item['url'])
                self.assertEqual(native_response.status, 200)
                data = await native_response.read()
                self.assertEqual(hashlib.sha256(data).hexdigest(), item['sha256'])
                self.assertEqual(len(data), item['size'])
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            for release, marker in (('release_old', b'old'), ('release_new', b'new')):
                for name in server.NX_NAMES:
                    response = await self.client.get('/nx/r/' + release + '/' + name)
                    self.assertEqual(response.status, 200)
                    self.assertEqual(await response.read(), marker + b':' + name.encode())
            response = await self.client.get('/nx/Base.nx')
            self.assertEqual(await response.read(), b'legacy')

    async def test_head_ranges_and_conditional_cache(self):
        view = self.cohort('release_old')
        self.write_json(self.authority, view)
        url = '/nx/r/release_old/Base.nx'
        response = await self.client.head(url)
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.read(), b'')
        self.assertEqual(int(response.headers['Content-Length']), len(b'old:Base.nx'))
        self.assertIn('immutable', response.headers['Cache-Control'])
        self.assertIn('Last-Modified', response.headers)
        etag = response.headers['ETag']
        response = await self.client.get(url, headers={'Range': 'bytes=1-4'})
        self.assertEqual(response.status, 206)
        self.assertEqual(await response.read(), b'ld:B')
        self.assertEqual(response.headers['Content-Range'], 'bytes 1-4/11')
        response = await self.client.get(url, headers={'If-None-Match': etag})
        self.assertEqual(response.status, 304)

    async def test_prepared_partial_and_malformed_fail_closed(self):
        for state in ('open', 'prepared', 'failed', 'committed'):
            self.cohort('release_bad', state=state)
            response = await self.client.get('/nx/r/release_bad/Base.nx')
            self.assertEqual(response.status, 404)
        self.cohort('release_bad', state='sealed', missing='UI.nx')
        response = await self.client.get('/nx/manifest.json?releaseId=release_bad')
        self.assertEqual(response.status, 404)
        view = self.cohort('release_old')
        view['assets']['nx/Base.nx']['key'] = 'nx/Item.nx'
        self.write_json(self.root / 'assets/manifests/release_old.json', view)
        response = await self.client.get('/nx/r/release_old/Base.nx')
        self.assertEqual(response.status, 404)
        self.write_json(self.authority, {'releaseId': 'unknown_release', 'assets': {}})
        response = await self.client.get('/nx/manifest.json')
        self.assertEqual(response.status, 404)

    async def test_writable_and_symlink_objects_rejected(self):
        view = self.cohort('release_old')
        asset = view['assets']['nx/Base.nx']
        path = self.root / 'assets/objects' / asset['hash'] / asset['key']
        path.chmod(0o644)
        response = await self.client.get('/nx/r/release_old/Base.nx')
        self.assertEqual(response.status, 404)
        path.unlink()
        outside = self.root / 'outside'
        outside.write_bytes(b'old:Base.nx')
        outside.chmod(0o444)
        path.symlink_to(outside)
        response = await self.client.get('/nx/r/release_old/Base.nx')
        self.assertIn(response.status, (400, 404))

    async def test_traversal_and_control_not_public(self):
        self.cohort('release_old')
        for url in ('/nx/r/short/Base.nx', '/nx/r/release_old/%2e%2e%2fBase.nx',
                    '/nx/r/release_old/unknown.nx', '/nx/%2e%2e%2fsecret.nx'):
            response = await self.client.get(url)
            self.assertIn(response.status, (400, 404))
        for endpoint in ('verify-nx', 'prepare-nx', 'restart'):
            response = await self.client.post('/' + endpoint, json={'releaseId': 'release_old'})
            self.assertEqual(response.status, 404)

    async def test_private_verifier_reads_http_and_rejects_unbound_success(self):
        self.cohort('release_old', state='sealed')
        script = self.root / 'verifier.py'
        script.write_text(
            'import hashlib,json,sys,urllib.request\n'
            'p=json.load(sys.stdin)\n'
            'for f in p["files"]:\n'
            ' data=urllib.request.urlopen(p["baseUrl"]+"/"+f["name"]).read()\n'
            ' assert len(data)==f["size"] and hashlib.sha256(data).hexdigest()==f["sha256"]\n'
            'proof={"success":True,"releaseId":p["releaseId"],"files":p["files"]}\n'
            'proof["reportSha256"]=hashlib.sha256(json.dumps(p["files"]).encode()).hexdigest()\n'
            '# Protocol fixture fingerprints its actual executing reader artifacts.\n'
            'proof["readerJsSha256"]=hashlib.sha256(open(__file__,"rb").read()).hexdigest()\n'
            'proof["readerWasmSha256"]=hashlib.sha256(open(sys.executable,"rb").read()).hexdigest()\n'
            'json.dump(proof,sys.stdout)\n')
        private = TestClient(TestServer(server.build_control_app()))
        await private.start_server()
        try:
            with patch.dict(os.environ, {
                'NX_HTTP_ORIGIN': str(self.client.make_url('/')).rstrip('/'),
                'NX_CONSUMER_VERIFY_COMMAND': json.dumps([sys.executable, str(script)]),
            }):
                response = await private.post('/verify-nx', json={'releaseId': 'release_old'})
                self.assertEqual(response.status, 401)
                response = await private.post('/verify-nx',
                    headers={'x-gm-secret': 'secret'},
                    json={'releaseId': 'release_old', 'baseUrl': 'http://untrusted.invalid'})
                self.assertEqual(response.status, 200)
                proof = await response.json()
                self.assertTrue(proof['success'])
                self.assertEqual(proof['releaseId'], 'release_old')
                self.assertEqual(len(proof['files']), 16)
                for invalid in ('print(\'{"success":true}\')\n', 'pass\n'):
                    script.write_text(invalid)
                    response = await private.post('/verify-nx',
                        headers={'x-gm-secret': 'secret'}, json={'releaseId': 'release_old'})
                    self.assertEqual(response.status, 502)
        finally:
            await private.close()


if __name__ == '__main__':
    unittest.main()
