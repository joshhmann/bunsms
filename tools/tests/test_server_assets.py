"""Exercise the actual game entrypoint against isolated HTTP/storage, never Java/DB."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ENTRYPOINT = Path(__file__).resolve().parents[2] / "server" / "entrypoint.sh"
ARCHIVES = "Base Character Effect Etc Item Map Mob Morph Npc Quest Reactor Skill Sound String TamingMob UI".split()


def archive(files, link=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for name, content in files.items():
            data = content.encode()
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
        if link:
            entry = tarfile.TarInfo(link)
            entry.type = tarfile.SYMTYPE
            entry.linkname = "/tmp/outside-selfhost-overlay"
            tar.addfile(entry)
    return output.getvalue()


class ServerOverlayTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="server-assets-")
        self.root = Path(self.temporary.name)
        self.bytes = {}
        self.requests = []
        self.descriptor = {}
        for name in ARCHIVES:
            (self.root / "wz" / f"{name}.wz").mkdir(parents=True)
        (self.root / "scripts").mkdir()
        (self.root / "scripts" / "existing.js").write_text("installed baseline script")
        (self.root / "config.yaml").write_text("server:\n  HOST: localhost\n")
        binaries = self.root / "bin"
        binaries.mkdir()
        java = binaries / "java"
        java.write_text('#!/bin/sh\nprintf "started\\n" >> "$GAME_ROOT/java-starts"\n')
        java.chmod(0o755)
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                fixture.requests.append(self.path)
                payload = json.dumps(fixture.descriptor).encode() if self.path == "/client/server-wz.version" else fixture.bytes.get(self.path)
                if payload is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.http.server_port}"
        self.environment = {**os.environ, "GAME_ROOT": str(self.root), "ASSET_BASE_URL": self.origin,
                            "PATH": str(binaries) + os.pathsep + os.environ["PATH"]}
        for name in ("GAME_HOST", "DB_PASS", "DISABLE_AUTO_REGISTER", "WZ_SEED_BASELINE_ONLY", "WZ_VERSION_URL"):
            self.environment.pop(name, None)

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def release(self, name, files, link=None, key="server-wz.tar.gz"):
        content = archive(files, link)
        digest = hashlib.sha256(content).hexdigest()
        path = f"/client/r/{digest}/{key}"
        self.bytes[path] = content
        return {"releaseId": name, "key": key, "hash": digest, "size": len(content), "url": self.origin + path}

    def run_entrypoint(self, success=True):
        result = subprocess.run(["bash", str(ENTRYPOINT)], env=self.environment, cwd=self.root, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def starts(self):
        path = self.root / "java-starts"
        return len(path.read_text().splitlines()) if path.exists() else 0

    def marker(self):
        return json.loads((self.root / "wz" / ".version").read_text())

    def test_partial_overlay_preserves_baseline_and_marker_skips_repeat_download(self):
        self.descriptor = self.release("first", {"wz/Item.wz/new.img.xml": "first", "scripts/existing.js": "first script"})
        self.run_entrypoint()
        self.assertEqual(self.marker(), self.descriptor)
        self.assertEqual((self.root / "scripts/existing.js").read_text(), "first script")
        self.assertTrue((self.root / "wz/Map.wz").is_dir())
        before = len([path for path in self.requests if "/client/r/" in path])
        self.run_entrypoint()
        self.assertEqual(len([path for path in self.requests if "/client/r/" in path]), before)
        self.assertEqual(self.starts(), 2)

    def test_sealed_prefixed_descriptor_applies_without_following_active_authority(self):
        prefix = "/rc-assets"
        candidate = self.release("sealed-candidate", {"scripts/candidate.js": "sealed bytes"})
        old_path = candidate["url"].removeprefix(self.origin)
        self.bytes[prefix + old_path] = self.bytes.pop(old_path)
        candidate["url"] = self.origin + prefix + old_path
        descriptor_bytes = json.dumps(candidate).encode()
        descriptor_hash = hashlib.sha256(descriptor_bytes).hexdigest()
        descriptor_path = prefix + f"/client/r/{descriptor_hash}/server-wz.version"
        self.bytes[descriptor_path] = descriptor_bytes
        self.environment.update(ASSET_BASE_URL=self.origin + prefix,
                                WZ_VERSION_URL=self.origin + descriptor_path)
        self.descriptor = self.release("unrelated-active", {"scripts/active.js": "active bytes"})
        self.run_entrypoint()
        self.assertEqual(self.marker(), candidate)
        self.assertEqual((self.root / "scripts/candidate.js").read_text(), "sealed bytes")
        self.assertFalse((self.root / "scripts/active.js").exists())
        self.assertNotIn("/client/server-wz.version", self.requests)

    def test_retained_rollback_removes_later_files_and_restores_installed_script(self):
        first = self.release("first", {"wz/Item.wz/old.img.xml": "old bytes"})
        self.descriptor = first
        self.run_entrypoint()
        self.descriptor = self.release("second", {"wz/Item.wz/new.img.xml": "new bytes", "scripts/existing.js": "new script", "scripts/new.js": "new script file"})
        self.run_entrypoint()
        self.assertFalse((self.root / "wz/Item.wz/old.img.xml").exists())
        self.descriptor = first
        self.run_entrypoint()
        self.assertEqual(self.marker(), first)
        self.assertEqual((self.root / "wz/Item.wz/old.img.xml").read_text(), "old bytes")
        self.assertFalse((self.root / "wz/Item.wz/new.img.xml").exists())
        self.assertFalse((self.root / "scripts/new.js").exists())
        self.assertEqual((self.root / "scripts/existing.js").read_text(), "installed baseline script")

    def test_wrong_hash_never_starts_java_or_advances_marker(self):
        self.descriptor = self.release("first", {"scripts/existing.js": "first"})
        self.run_entrypoint()
        previous = self.marker()
        bad = self.release("bad", {"scripts/existing.js": "bad"})
        self.bytes[bad["url"].removeprefix(self.origin)] = b"corrupt transfer"
        self.descriptor = bad
        self.run_entrypoint(False)
        self.assertEqual(self.marker(), previous)
        self.assertEqual((self.root / "scripts/existing.js").read_text(), "first")
        self.assertEqual(self.starts(), 1)

    def test_unsafe_archive_is_rejected_before_game_changes(self):
        self.descriptor = self.release("bad", {"wz/../outside.xml": "escape"})
        self.run_entrypoint(False)
        self.assertFalse((self.root / "outside.xml").exists())
        self.assertEqual(self.starts(), 0)
        self.descriptor = self.release("link", {}, link="scripts/link.js")
        self.run_entrypoint(False)
        self.assertFalse((self.root / "scripts/link.js").exists())
        self.assertEqual(self.starts(), 0)

    def test_partial_copy_failure_is_recovered_even_when_rolling_back_to_current_marker(self):
        first = self.release("first", {"scripts/existing.js": "first"})
        self.descriptor = first
        self.run_entrypoint()
        (self.root / "wz/Item.wz/blocked").write_text("unrelated installed file")
        self.descriptor = self.release("failed", {"scripts/new.js": "partially copied", "wz/Item.wz/blocked/file.img.xml": "cannot create parent"})
        self.run_entrypoint(False)
        self.assertTrue((self.root / "scripts/new.js").exists())
        self.assertEqual(self.marker(), first)
        self.assertEqual(self.starts(), 1)
        self.descriptor = first
        self.run_entrypoint()
        self.assertFalse((self.root / "scripts/new.js").exists())
        self.assertEqual((self.root / "scripts/existing.js").read_text(), "first")
        self.assertFalse(json.loads((self.root / ".selfhost-assets/overlay.json").read_text())["pending"])
        self.assertEqual(self.starts(), 2)

    def test_cold_baseline_requires_and_consumes_exact_selfhost_pin(self):
        shutil.rmtree(self.root / "wz/Base.wz")
        baseline = self.release("baseline", {f"wz/{name}.wz/base.img.xml": "baseline" for name in ARCHIVES}, key="server-wz-baseline.tar.gz")
        self.environment.update(WZ_BASELINE_URL=baseline["url"], WZ_BASELINE_HASH=baseline["hash"], WZ_BASELINE_SIZE=str(baseline["size"]))
        self.descriptor = self.release("overlay", {"scripts/new.js": "new"})
        self.run_entrypoint()
        self.assertEqual((self.root / "wz/Base.wz/base.img.xml").read_text(), "baseline")
        self.assertEqual((self.root / "scripts/existing.js").read_text(), "installed baseline script")
        self.assertEqual(self.marker(), self.descriptor)
        self.assertEqual(self.starts(), 1)


if __name__ == "__main__":
    unittest.main()
