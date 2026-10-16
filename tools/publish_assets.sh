#!/bin/bash
# Authenticated private-LAN publication. No rsync/live-directory write path.
# GM_SECRET_FILE (preferred) or GM_API_SECRET; DASHBOARD_URL defaults to LAN.
# --bootstrap SOURCE verifies/stages the complete authority, preserving version.
# --operations FILE supplies explicit native-content operations for WZ changes.
# --rollback RELEASE selects retained immutable bytes; never accepts manifest JSON.
set -euo pipefail
set +x
exec python3 - "$@" <<'PY'
import argparse
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import socket
import ssl
import sys
from urllib.parse import urlsplit
import uuid

parser = argparse.ArgumentParser(description="Publish verified immutable selfhost assets over the authenticated private LAN API")
parser.add_argument("source", nargs="?", default="./patched")
parser.add_argument("--bootstrap", action="store_true", help="Stage the complete exact seed set, without changing version/timestamp")
parser.add_argument("--rollback", metavar="RETAINED_RELEASE_ID")
parser.add_argument("--operations", type=Path, help="JSON array, or object with operations array, identifying approved native NX edits")
args = parser.parse_args()
try:
    origin = urlsplit(os.environ.get("DASHBOARD_URL", "http://192.168.0.164:3001"))
    if origin.scheme not in ("http", "https") or not origin.hostname or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
        raise ValueError("DASHBOARD_URL must be a private LAN origin without credentials/path")
    addresses = socket.getaddrinfo(origin.hostname, origin.port or (443 if origin.scheme == "https" else 80), type=socket.SOCK_STREAM)
    if not addresses or any(not (ipaddress.ip_address(item[4][0]).is_private or ipaddress.ip_address(item[4][0]).is_loopback) for item in addresses):
        raise ValueError("DASHBOARD_URL must resolve only to private LAN/loopback addresses, not the public read-only origin")
    secret_file = os.environ.get("GM_SECRET_FILE")
    secret = Path(secret_file).read_text().strip() if secret_file else os.environ.get("GM_API_SECRET", "")
    if not secret or "\n" in secret or "\r" in secret:
        raise ValueError("Set GM_SECRET_FILE or GM_API_SECRET to the private API credential")

    def connection():
        if origin.scheme == "https":
            return http.client.HTTPSConnection(origin.hostname, origin.port, timeout=7200, context=ssl.create_default_context())
        return http.client.HTTPConnection(origin.hostname, origin.port, timeout=7200)

    def response(conn):
        reply = conn.getresponse()
        raw = reply.read()
        conn.close()
        try:
            result = json.loads(raw)
        except ValueError:
            raise ValueError(f"Private publication returned non-JSON HTTP {reply.status}") from None
        if not 200 <= reply.status < 300 or not isinstance(result, dict) or result.get("success") is False or result.get("error"):
            # Never print a server body that might contain submitted credentials.
            raise ValueError(f"Private publication failed (HTTP {reply.status}); no release success acknowledged")
        return result

    def request(path, payload=None):
        conn = connection()
        body = None if payload is None else json.dumps(payload).encode()
        conn.request("GET" if payload is None else "POST", path, body=body,
                     headers={"x-gm-secret": secret, "Content-Type": "application/json"})
        return response(conn)

    if args.rollback:
        result = request("/api/launcher/manifest", {"rollback": args.rollback})
        print("Restored retained release:", result.get("releaseId", args.rollback))
        sys.exit(0)

    authority = request("/api/admin/assets/release")
    manifest = authority["manifest"]
    allowed = authority["allowlist"]
    if not isinstance(allowed, list) or not all(isinstance(name, str) for name in allowed):
        raise ValueError("Invalid complete writer allowlist")
    launcher_names = {entry["name"] for entry in manifest["files"]}
    if not launcher_names.issubset(set(allowed)):
        raise ValueError("Writer authority omitted complete launcher entries")
    # Other committed art/NX keys use their dedicated private operations.
    supported = launcher_names | {"server-wz.tar.gz", "server-wz-baseline.tar.gz"}
    allowed = sorted(set(allowed) & supported)
    if any(Path(name).name != name or any(c in name for c in ('"', chr(13), chr(10))) for name in allowed):
        raise ValueError("Unsafe launcher/server candidate name")
    source = Path(args.source).resolve(strict=True)
    if not source.is_dir():
        raise ValueError("Source is not a directory")
    # Legacy producer names are accepted only during the explicit byte-preserving bootstrap.
    aliases = {"BunsMS.exe": "AugurMS.exe", "config.ini": "ezorsia-config.ini"} if args.bootstrap else {}
    candidates = []
    for name in allowed:
        canonical = source / name
        alias = source / aliases[name] if name in aliases else None
        if canonical.exists() and alias is not None and alias.exists():
            raise ValueError(f"Both canonical and legacy source names exist for {name}; supply one unambiguous file")
        path = canonical if canonical.exists() else alias
        if args.bootstrap and name == "server-wz-baseline.tar.gz" and not canonical.exists():
            # The measured existing tar contains all required baseline directories.
            # Import the same independently hashed source under its canonical baseline key.
            path = source / "server-wz.tar.gz"
        if path is None or not path.exists():
            continue
        if path.is_symlink() or not path.is_file() or path.resolve().parent != source:
            raise ValueError(f"Source must be a regular local file: {name}")
        # Producer-side expectations are captured BEFORE any staging request.
        h, size = hashlib.sha256(), 0
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                h.update(block)
                size += len(block)
        candidates.append({"name": name, "hash": h.hexdigest(), "size": size, "path": path})
    if not candidates:
        raise ValueError("No allowlisted candidates; nothing staged")
    if args.bootstrap:
        if not launcher_names.issubset({item["name"] for item in candidates}):
            raise ValueError("Bootstrap requires the entire complete launcher set, including profile-specific files")
        expected = {**manifest.get("assets", {}), **{item["name"]: item for item in manifest["files"]}}
        if any(item["name"] in expected and (item["hash"], item["size"]) != (expected[item["name"]]["hash"], expected[item["name"]]["size"]) for item in candidates):
            raise ValueError("Bootstrap bytes differ from the independently approved complete seed authority")
    operations = []
    if args.operations:
        operations = json.loads(args.operations.read_text())
        if isinstance(operations, dict):
            operations = operations["operations"]
        if not isinstance(operations, list):
            raise ValueError("Operations must be an explicit JSON array")
    base_id = manifest.get("releaseId")
    staged = request("/api/launcher/manifest", {"stage": True, "baseReleaseId": base_id})
    release_id = staged["releaseId"]
    for item in candidates:
        boundary = "buns-" + uuid.uuid4().hex
        prefix = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"releaseId\"\r\n\r\n{release_id}\r\n"
                  f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{item['name']}\"\r\n"
                  "Content-Type: application/octet-stream\r\n\r\n").encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        conn = connection()
        conn.putrequest("POST", "/api/launcher/upload")
        conn.putheader("x-gm-secret", secret)
        conn.putheader("Content-Type", "multipart/form-data; boundary=" + boundary)
        conn.putheader("Content-Length", str(len(prefix) + item["size"] + len(suffix)))
        conn.endheaders()
        conn.send(prefix)
        with item["path"].open("rb") as stream:
            remaining = item["size"]
            while remaining:
                block = stream.read(min(1024 * 1024, remaining))
                if not block:
                    conn.close()
                    raise ValueError("Source shrank after independent hashing; release not registered")
                remaining -= len(block)
                conn.send(block)
            if stream.read(1):
                conn.close()
                raise ValueError("Source grew after independent hashing; release not registered")
        conn.send(suffix)
        response(conn)
        print("Staged", item["name"], item["size"], "bytes")
    result = request("/api/launcher/manifest", {
        "releaseId": release_id,
        "register": [{key: item[key] for key in ("name", "hash", "size")} for item in candidates],
        "operations": operations,
    })
    print("Committed immutable release:", result.get("releaseId", release_id))
except (OSError, ValueError, KeyError, http.client.HTTPException) as error:
    # Transport exceptions never include the credential or request headers.
    print("Publication failed:", str(error), file=sys.stderr)
    sys.exit(1)
PY
