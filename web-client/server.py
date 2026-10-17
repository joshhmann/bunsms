"""Combined static file server + NX proxy + WebSocket TCP proxy for the BunsMS web client.

Routes:
  GET /           -> index.html (or WS upgrade bridged to game server)
  GET /web/*      -> static /app/web
  GET /build/*    -> static /app/build
  GET /nx/*       -> unchanged local baseline; /nx/r/<id>/* -> sealed retained cohort
  GET /healthz    -> 'ok'

The WS proxy accepts the target address as its first text message (same protocol
as the original ws_proxy.py from maplestory-wasm) but restricts the target to a
small allow-list of host:port pairs to prevent abuse.
"""

import asyncio
import hmac
import json
import logging
import os
import re
import stat
from urllib.parse import urlsplit
from aiohttp import web, WSMsgType

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
log = logging.getLogger('buns-ms-web')

STATIC_ROOT = os.environ.get('STATIC_ROOT', '/app')
PORT = int(os.environ.get('PORT', '8080'))
NX_LOCAL_DIR = os.environ.get('NX_DIR', '/opt/buns/nx')
CLIENT_ASSETS_DIR = os.environ.get('CLIENT_ASSETS_DIR', '/opt/buns/client-assets')
CLIENT_MANIFEST_PATH = os.environ.get('LAUNCHER_MANIFEST_PATH', '/opt/buns/manifest-writable/launcher-manifest.json')

# Comma-separated host:port allow list, e.g. "127.0.0.1:8484,127.0.0.1:7575,..."
# Override per-deploy via the ALLOWED_TARGETS env var.
# Default covers a local game server (login + 3 channels).
DEFAULT_ALLOWED = (
    '127.0.0.1:8484,'
    '127.0.0.1:7575,'
    '127.0.0.1:7576,'
    '127.0.0.1:7577'
)
ALLOWED_TARGETS = {
    t.strip() for t in os.environ.get('ALLOWED_TARGETS', DEFAULT_ALLOWED).split(',') if t.strip()
}

INDEX_HTML = os.path.join(STATIC_ROOT, 'web', 'index.html')


async def handle_root(request: web.Request) -> web.StreamResponse:
    """Serve index.html, or upgrade to WS and bridge to the game server."""
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return await handle_ws_proxy(request)
    return web.FileResponse(INDEX_HTML)


async def handle_ws_proxy(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(max_msg_size=50 * 1024 * 1024)
    await ws.prepare(request)
    peer = request.remote or '?'

    # First message = target address "host:port"
    try:
        msg = await ws.receive(timeout=10)
    except asyncio.TimeoutError:
        log.warning('ws %s: handshake timeout', peer)
        await ws.close()
        return ws

    # The WASM client sends the target address as the first frame. The
    # upstream maplestory-wasm ws_proxy accepts either text or binary —
    # mirror that so the existing WASM build works unchanged.
    if msg.type == WSMsgType.TEXT:
        target_raw = msg.data
    elif msg.type == WSMsgType.BINARY:
        try:
            target_raw = msg.data.decode('utf-8')
        except UnicodeDecodeError:
            log.warning('ws %s: first binary frame is not utf-8', peer)
            await ws.close()
            return ws
    else:
        log.warning('ws %s: first frame was %s, not text/binary', peer, msg.type)
        await ws.close()
        return ws

    target = target_raw.strip()
    if target not in ALLOWED_TARGETS:
        log.warning('ws %s: target %r rejected (not in allow-list)', peer, target)
        await ws.close()
        return ws

    host, port_str = target.rsplit(':', 1)
    port = int(port_str)
    try:
        reader, writer = await asyncio.open_connection(host, port)
    except Exception as e:
        log.warning('ws %s: dial %s failed: %s', peer, target, e)
        await ws.close()
        return ws

    log.info('ws %s <-> %s opened', peer, target)

    async def pump_ws_to_tcp():
        try:
            async for m in ws:
                if m.type == WSMsgType.BINARY:
                    writer.write(m.data)
                    await writer.drain()
                elif m.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                    break
        except Exception as e:
            log.debug('ws %s: ws->tcp pump ended: %s', peer, e)
        finally:
            try:
                writer.close()
            except Exception:
                pass

    async def pump_tcp_to_ws():
        try:
            while not ws.closed:
                data = await reader.read(65536)
                if not data:
                    break
                await ws.send_bytes(data)
        except Exception as e:
            log.debug('ws %s: tcp->ws pump ended: %s', peer, e)
        finally:
            if not ws.closed:
                await ws.close()

    await asyncio.gather(pump_ws_to_tcp(), pump_tcp_to_ws(), return_exceptions=True)
    log.info('ws %s <-> %s closed', peer, target)
    return ws


async def healthz(_request: web.Request) -> web.Response:
    return web.Response(text='ok')


def read_asset_authority():
    with open(CLIENT_MANIFEST_PATH, encoding='utf-8') as source:
        return json.load(source)


def immutable_asset_path(key, digest):
    """Resolve verified retained bytes; never hash a large file on a public request."""
    if (not isinstance(key, str) or not key or '\\' in key or
            not re.fullmatch(r'[a-f0-9]{64}', digest or '')):
        raise web.HTTPBadRequest(text='Invalid revision')
    parts = key.split('/')
    if any(not p or p in ('.', '..') or p.startswith('.') for p in parts):
        raise web.HTTPBadRequest(text='Invalid asset key')
    base = os.path.realpath(CLIENT_ASSETS_DIR)
    path = os.path.join(base, 'objects', digest, *parts)
    resolved = os.path.realpath(path)
    if resolved != path or not resolved.startswith(base + os.sep):
        raise web.HTTPBadRequest(text='Invalid asset path')
    try:
        info = os.stat(path)
    except OSError:
        raise web.HTTPNotFound()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o222:
        raise web.HTTPNotFound()
    return path


NX_NAMES = (
    'Base.nx', 'Character.nx', 'Effect.nx', 'Etc.nx', 'Item.nx', 'Map.nx',
    'Mob.nx', 'Morph.nx', 'Npc.nx', 'Quest.nx', 'Reactor.nx', 'Skill.nx',
    'Sound.nx', 'String.nx', 'TamingMob.nx', 'UI.nx',
)


def validate_release_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', value):
        raise web.HTTPBadRequest(text='Invalid release id')
    return value


def read_registry_json(relative):
    base = os.path.realpath(CLIENT_ASSETS_DIR)
    path = os.path.join(base, *relative.split('/'))
    if os.path.realpath(path) != path:
        raise web.HTTPNotFound(text='Invalid registry path')
    with open(path, encoding='utf-8') as source:
        return json.load(source)


def resolve_nx_view(release_id=None):
    """Read one sealed/retained registry snapshot, never merge current per file."""
    try:
        if release_id is None:
            release_id = read_asset_authority().get('releaseId')
        validate_release_id(release_id)
        try:
            view = read_registry_json('manifests/' + release_id + '.json')
        except FileNotFoundError:
            record = read_registry_json('staging/' + release_id + '/release.json')
            if record.get('id') != release_id or record.get('state') != 'sealed':
                raise web.HTTPNotFound(text='Cohort is not sealed')
            view = dict(record['base'])
            view['assets'] = {**view.get('assets', {}), **record['prepared']}
            view['releaseId'] = release_id
        if view.get('releaseId') != release_id:
            raise ValueError('Mismatched release')
        assets = view['assets']
        expected = {'nx/' + name for name in NX_NAMES}
        if {key for key in assets if key.startswith('nx/')} != expected:
            raise ValueError('Incomplete NX cohort')
        files, paths = [], {}
        for name in NX_NAMES:
            key = 'nx/' + name
            asset = assets[key]
            paths[name] = checked_asset_path(key, asset)
            files.append({'name': name, 'sha256': asset['hash'], 'size': asset['size']})
        native_files = []
        for name in tuple(name[:-3] + '.wz' for name in NX_NAMES) + ('List.wz',):
            asset = assets[name]
            checked_asset_path(name, asset)
            native_files.append({
                'name': name, 'sha256': asset['hash'], 'size': asset['size'],
                'url': '/client/r/' + asset['hash'] + '/' + name,
            })
        archive = assets['server-wz.tar.gz']
        checked_asset_path('server-wz.tar.gz', archive)
        server_tar = {
            'sha256': archive['hash'], 'size': archive['size'],
            'url': '/client/r/' + archive['hash'] + '/server-wz.tar.gz',
        }
        return view, {
            'releaseId': release_id, 'baseUrl': '/nx/r/' + release_id,
            'files': files, 'nativeFiles': native_files, 'serverTar': server_tar,
        }, paths
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise web.HTTPNotFound(text='Complete sealed NX cohort unavailable')


def checked_asset_path(key, asset):
    if (not isinstance(asset, dict) or asset.get('key') != key or
            type(asset.get('size')) is not int or not 0 <= asset['size'] <= 9007199254740991):
        raise ValueError('Invalid asset metadata')
    path = immutable_asset_path(key, asset.get('hash'))
    if os.stat(path).st_size != asset['size']:
        raise ValueError('Asset size mismatch')
    return path


async def handle_nx_manifest(request):
    _, projection, _ = await asyncio.to_thread(resolve_nx_view, request.query.get('releaseId'))
    return web.json_response(projection, headers={
        'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
    })


async def handle_nx_cohort(request):
    name = request.match_info['name']
    if name not in NX_NAMES:
        raise web.HTTPNotFound()
    _, _, paths = await asyncio.to_thread(resolve_nx_view, request.match_info['release_id'])
    return web.FileResponse(paths[name], headers={
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000, immutable',
    })


async def handle_nx(request: web.Request) -> web.StreamResponse:
    """The approved local baseline never follows registry publication or rollback."""
    name = request.match_info['path']
    if '/' in name or '\\' in name or not name.endswith('.nx') or name.startswith('.'):
        raise web.HTTPBadRequest(text='Invalid NX name')
    base = os.path.realpath(NX_LOCAL_DIR)
    path = os.path.realpath(os.path.join(base, name))
    if not path.startswith(base + os.sep) or not os.path.isfile(path):
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, must-revalidate',
    })


async def handle_client(request: web.Request) -> web.StreamResponse:
    raw = request.match_info['path']
    if raw.startswith('r/'):
        parts = raw.split('/', 2)
        if len(parts) != 3:
            raise web.HTTPBadRequest(text='Invalid revision')
        path = immutable_asset_path(parts[2], parts[1])
        cache = 'public, max-age=31536000, immutable'
    else:
        try:
            manifest = await asyncio.to_thread(read_asset_authority)
        except FileNotFoundError:
            raise web.HTTPNotFound()
        asset = manifest.get('assets', {}).get(raw)
        if not asset or asset.get('key') != raw:
            raise web.HTTPNotFound()
        path = immutable_asset_path(raw, asset.get('hash'))
        cache = 'no-cache, must-revalidate'
    return web.FileResponse(path, headers={
        'Access-Control-Allow-Origin': '*', 'Cache-Control': cache,
    })


@web.middleware
async def authenticate_control(request, handler):
    secret_file = os.environ.get('GM_SECRET_FILE')
    try:
        if secret_file:
            with open(secret_file, encoding='utf-8') as source:
                expected = source.read().strip()
        else:
            expected = os.environ.get('GM_API_SECRET', '')
    except OSError:
        raise web.HTTPServiceUnavailable(text='Private control authentication is not configured')
    supplied = request.headers.get('x-gm-secret', '')
    if not expected or not supplied or not hmac.compare_digest(expected, supplied):
        raise web.HTTPUnauthorized()
    return await handler(request)


async def run_control(request, command_env, payload, timeout):
    configured = os.environ.get(command_env, '')
    try:
        command = json.loads(configured)
        if not isinstance(command, list) or not command or any(not isinstance(arg, str) for arg in command):
            raise ValueError()
    except (ValueError, TypeError):
        raise web.HTTPServiceUnavailable(text=command_env + ' must be a configured JSON argv')
    if request.app['command_lock'].locked():
        raise web.HTTPConflict(text='Another private operation is running')
    async with request.app['command_lock']:
        process = await asyncio.create_subprocess_exec(
            *command, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(json.dumps(payload).encode()), timeout=timeout,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise web.HTTPGatewayTimeout(text='Private operation timed out')
        if process.returncode:
            detail = stderr.decode(errors='replace')[-3000:]
            if not detail:
                try:
                    failure = json.loads(stdout)
                    if isinstance(failure, dict) and isinstance(failure.get('error'), str):
                        detail = failure['error'][-8000:]
                except (ValueError, TypeError):
                    pass
            return web.json_response({
                'success': False, 'error': detail or 'Private operation failed',
            }, status=502)
        return stdout


async def control_restart(request):
    result = await run_control(request, 'GAME_RESTART_COMMAND', {}, 240)
    if isinstance(result, web.StreamResponse):
        return result
    return web.json_response({'success': True})


async def control_prepare_nx(request):
    payload = await request.json()
    if not isinstance(payload, dict) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', payload.get('releaseId', '')):
        raise web.HTTPBadRequest(text='A verified candidate release is required')
    result = await run_control(request, 'NX_PREPARE_COMMAND', payload, 1800)
    if isinstance(result, web.StreamResponse):
        return result
    try:
        response = json.loads(result)
        if not isinstance(response, dict) or not isinstance(response.get('files'), list):
            raise ValueError()
    except (ValueError, TypeError):
        raise web.HTTPBadGateway(text='NX preparation returned an invalid result')
    return web.json_response(response)


async def control_verify_nx(request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise web.HTTPBadRequest(text='A sealed release is required')
    release_id = validate_release_id(payload.get('releaseId'))
    view, projection, _ = await asyncio.to_thread(resolve_nx_view, release_id)
    origin = os.environ.get('NX_HTTP_ORIGIN', '').rstrip('/')
    parsed = urlsplit(origin)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise web.HTTPServiceUnavailable(text='NX_HTTP_ORIGIN must be a service-configured HTTP origin')
    native = []
    try:
        for item in projection['nativeFiles']:
            key = item['name']
            asset = view['assets'][key]
            native.append({'key': key, 'hash': asset['hash'], 'size': asset['size'],
                           'path': checked_asset_path(key, asset)})
    except (ValueError, KeyError, TypeError):
        raise web.HTTPNotFound(text='Native assets unavailable')
    result = await run_control(request, 'NX_CONSUMER_VERIFY_COMMAND', {
        **projection, 'baseUrl': origin + projection['baseUrl'], 'nativeFiles': native,
    }, 1800)
    if isinstance(result, web.StreamResponse):
        return result
    try:
        response = json.loads(result)
        if (not isinstance(response, dict) or response.get('success') is not True or
                response.get('releaseId') != release_id or
                response.get('files') != projection['files'] or
                any(not isinstance(response.get(key), str) or
                    not re.fullmatch(r'[a-f0-9]{64}', response[key])
                    for key in ('reportSha256', 'readerJsSha256', 'readerWasmSha256'))):
            raise ValueError()
    except (ValueError, TypeError):
        raise web.HTTPBadGateway(text='NX verifier did not prove the requested cohort')
    return web.json_response(response)


def build_control_app():
    app = web.Application(middlewares=[authenticate_control], client_max_size=2 * 1024 * 1024)
    app['command_lock'] = asyncio.Lock()
    app.router.add_post('/restart', control_restart)
    app.router.add_post('/prepare-nx', control_prepare_nx)
    app.router.add_post('/verify-nx', control_verify_nx)
    return app


async def start_private_control(app):
    path = os.environ.get('GAME_CONTROL_SOCKET')
    if not path:
        return
    os.makedirs(os.path.dirname(path), mode=0o770, exist_ok=True)
    if os.path.lexists(path):
        if not stat.S_ISSOCK(os.lstat(path).st_mode):
            raise RuntimeError('Private control path is not a socket')
        os.unlink(path)
    runner = web.AppRunner(build_control_app())
    await runner.setup()
    await web.UnixSite(runner, path).start()
    os.chmod(path, 0o660)
    app['control_runner'] = runner


async def stop_private_control(app):
    runner = app.get('control_runner')
    if runner:
        await runner.cleanup()


@web.middleware
async def revalidate_client_files(request: web.Request, handler):
    """Revalidate routing config/page as well as the matched JS/WASM build pair."""
    response = await handler(request)
    if (request.path.startswith('/build/') or
            request.path in ('/', '/web/index.html', '/web/config.json', '/web/config.prod.json')):
        response.headers['Cache-Control'] = 'no-cache, must-revalidate'
    return response


async def preserve_asset_representation(request: web.Request, response: web.StreamResponse):
    # FileResponse guesses Content-Encoding:gzip from .tar.gz. These files are
    # publisher-hashed archives, not HTTP-compressed representations: decoding
    # them in a proxy or downloader changes the immutable bytes and breaks Range.
    if request.path.startswith('/client/') and isinstance(response, web.FileResponse):
        response.headers.pop('Content-Encoding', None)
        response.headers['Content-Type'] = 'application/octet-stream'


def build_app() -> web.Application:
    app = web.Application(middlewares=[revalidate_client_files])
    app.on_response_prepare.append(preserve_asset_representation)
    app.on_startup.append(start_private_control)
    app.on_cleanup.append(stop_private_control)
    app.router.add_get('/', handle_root)
    app.router.add_get('/healthz', healthz)
    app.router.add_get('/nx/manifest.json', handle_nx_manifest)
    app.router.add_get('/nx/r/{release_id}/{name}', handle_nx_cohort)
    app.router.add_get('/nx/{path:.*}', handle_nx)
    app.router.add_get('/client/{path:.*}', handle_client)
    # Static mounts. Route order matters — these only match if the path starts with /web or /build.
    app.router.add_static('/web/', path=os.path.join(STATIC_ROOT, 'web'), show_index=False)
    app.router.add_static('/build/', path=os.path.join(STATIC_ROOT, 'build'), show_index=False)
    return app


def build_asset_app() -> web.Application:
    """Read-only RC byte service using the same immutable registry and handler."""
    app = web.Application()
    app.on_response_prepare.append(preserve_asset_representation)
    app.router.add_get('/healthz', healthz)
    app.router.add_get('/client/{path:.*}', handle_client)
    return app


if __name__ == '__main__':
    log.info('starting on :%d, static_root=%s, allowed_targets=%s', PORT, STATIC_ROOT, sorted(ALLOWED_TARGETS))
    web.run_app(build_asset_app() if os.environ.get('ASSET_ONLY') == '1' else build_app(),
                host='0.0.0.0', port=PORT, print=None)
