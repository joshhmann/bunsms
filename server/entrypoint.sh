#!/bin/bash
set -e

export GAME_ROOT="${GAME_ROOT:-/opt/server}"
CONFIG="$GAME_ROOT/config.yaml"

# Use exact key matching (anchored to line start with spaces) to avoid partial matches
# Config format: "  KEY: value" (2 spaces indent under server:)

if [ -n "$GAME_HOST" ]; then
  sed -i 's|^  HOST: .*|  HOST: '"$GAME_HOST"'|' "$CONFIG"
  sed -i 's|^  LANHOST: .*|  LANHOST: '"$GAME_HOST"'|' "$CONFIG"
fi

if [ -n "$DB_PASS" ]; then
  sed -i 's|^  DB_PASS: .*|  DB_PASS: "'"$DB_PASS"'"|' "$CONFIG"
fi

if [ -n "$DISABLE_AUTO_REGISTER" ]; then
  sed -i 's|^  AUTOMATIC_REGISTER: .*|  AUTOMATIC_REGISTER: false|' "$CONFIG"
fi

echo "=== BunsMS Game Server starting ==="
grep -E '^\s+(HOST|LANHOST|DB_HOST|AUTOMATIC_REGISTER):' "$CONFIG" | head -5
echo "DB_HOST env override: ${DB_HOST:-none}"
echo "=================================="

# Selfhost authority is fetched once. Its descriptor pins the exact overlay
# bytes, so a concurrent publish cannot pair a new marker with an old tar.
python3 - <<'PY'
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
from urllib.parse import urlparse

root = Path(os.environ["GAME_ROOT"])
state_root = root / ".selfhost-assets"
state_root.mkdir(mode=0o700, exist_ok=True)
lock = (state_root / "apply.lock").open("a")
fcntl.flock(lock, fcntl.LOCK_EX)
state_path = state_root / "overlay.json"

def save_state(state):
    with tempfile.NamedTemporaryFile("w", prefix="overlay-", dir=state_root, delete=False) as temporary:
        json.dump(state, temporary, sort_keys=True)
        temporary.flush()
        os.fsync(temporary.fileno())
        name = Path(temporary.name)
    try:
        name.replace(state_path)
    finally:
        name.unlink(missing_ok=True)

def load_state():
    state = json.loads(state_path.read_text()) if state_path.exists() else {"originals": {}, "pending": False}
    if not isinstance(state.get("originals"), dict) or not isinstance(state.get("pending"), bool):
        raise RuntimeError("Invalid persistent server overlay ledger")
    for key, existed in state["originals"].items():
        path = PurePosixPath(key)
        if not isinstance(existed, bool) or path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in ("wz", "scripts"):
            raise RuntimeError("Invalid persistent server overlay path")
    return state
required = {name + ".wz" for name in ("Base", "Character", "Effect", "Etc", "Item", "Map", "Mob", "Morph", "Npc", "Quest", "Reactor", "Skill", "Sound", "String", "TamingMob", "UI")}
base = os.environ.get("ASSET_BASE_URL", "https://buns.asslorde.com").rstrip("/")

def apply(descriptor, baseline=False):
    url, digest, size = descriptor["url"], descriptor["hash"], descriptor["size"]
    parsed, authority = urlparse(url), urlparse(base)
    if (parsed.scheme, parsed.netloc) != (authority.scheme, authority.netloc):
        raise RuntimeError("WZ tar must use the configured selfhost authority")
    if not re.fullmatch(r"[a-f0-9]{64}", digest) or not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise RuntimeError("Invalid independently pinned WZ metadata")
    key = "server-wz-baseline.tar.gz" if baseline else "server-wz.tar.gz"
    if parsed.path != authority.path.rstrip("/") + f"/client/r/{digest}/{key}" or parsed.query or parsed.fragment:
        raise RuntimeError("WZ tar URL is not the exact immutable revision")
    with tempfile.TemporaryDirectory(prefix="wz-verified-", dir=root) as temp:
        archive = Path(temp) / "archive.tar.gz"
        h, received = hashlib.sha256(), 0
        # Curl transports opaque bytes; verification still precedes any overlay write.
        with subprocess.Popen(
                ["curl", "--fail", "--location", "--silent", "--show-error",
                 "--connect-timeout", "120", "--speed-time", "120", "--speed-limit", "1", url],
                stdout=subprocess.PIPE) as source, archive.open("xb") as output:
            while block := source.stdout.read(1024 * 1024):
                received += len(block)
                if received > size:
                    raise RuntimeError("WZ tar exceeded pinned size")
                h.update(block)
                output.write(block)
            if source.wait() != 0:
                raise RuntimeError("WZ tar HTTP download failed")
        if received != size or h.hexdigest() != digest:
            raise RuntimeError("WZ tar hash/size mismatch")
        extracted = Path(temp) / "extract"
        extracted.mkdir()
        with tarfile.open(archive, "r:gz") as source:
            names = set()
            for member in source:
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in ("wz", "scripts"):
                    raise RuntimeError("WZ tar contains an unsafe path")
                if not (member.isdir() or member.isfile()):
                    raise RuntimeError("WZ tar contains a link or special file")
                if member.isfile():
                    if len(path.parts) < 2 or (path.parts[0] == "wz" and not path.parts[1].endswith(".wz")):
                        raise RuntimeError("WZ tar contains an entry outside server WZ/scripts")
                    if str(path) in names:
                        raise RuntimeError("WZ tar contains duplicate entries")
                    names.add(str(path))
                source.extract(member, extracted)
        if baseline and any(not (extracted / "wz" / name).exists() for name in required):
            raise RuntimeError("Baseline tar does not contain all 16 server WZs")
        if baseline:
            for directory in ("wz", "scripts"):
                if (extracted / directory).exists():
                    shutil.copytree(extracted / directory, root / directory, dirs_exist_ok=True)
            return None
        # Retain originals outside the writable game trees. The persistent ledger
        # survives container replacement, including failures before marker update.
        state = load_state()
        for key in sorted(names):
            if key in state["originals"]:
                continue
            target, backup = root / key, state_root / "originals" / key
            if target.is_symlink() or (target.exists() and not target.is_file()):
                raise RuntimeError("Server overlay target is not a regular file")
            existed = backup.exists() or target.exists()
            if existed and not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(target, backup)
                backup.chmod(0o444)
            state["originals"][key] = existed
        state["pending"] = True
        save_state(state)
        # Remove or restore files absent from this retained overlay. A merge-only
        # copy would leave later-added scripts/XML active after manifest rollback.
        for key, existed in state["originals"].items():
            if key in names:
                continue
            target = root / key
            if existed:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(state_root / "originals" / key, target)
            elif target.exists() or target.is_symlink():
                target.unlink()
        for key in sorted(names):
            target = root / key
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(extracted / key, target)
        return state

if any(not (root / "wz" / name).exists() for name in required):
    apply({"url": os.environ["WZ_BASELINE_URL"], "hash": os.environ["WZ_BASELINE_HASH"],
           "size": int(os.environ["WZ_BASELINE_SIZE"])}, baseline=True)
if os.environ.get("WZ_SEED_BASELINE_ONLY") != "1":
    descriptor = json.loads(subprocess.check_output(
        ["curl", "--fail", "--location", "--silent", "--show-error",
         "--connect-timeout", "30", "--speed-time", "30", "--speed-limit", "1",
         os.environ.get("WZ_VERSION_URL") or base + "/client/server-wz.version"]))
    if not isinstance(descriptor.get("releaseId"), str) or not descriptor["releaseId"]:
        raise RuntimeError("Server WZ descriptor has no release identity")
    marker = root / "wz" / ".version"
    current = json.loads(marker.read_text()) if marker.exists() and marker.read_text().lstrip().startswith("{") else None
    if current != descriptor or load_state()["pending"]:
        state = apply(descriptor)
        temporary = marker.with_name(".version.next")
        temporary.write_text(json.dumps(descriptor, sort_keys=True) + "\n")
        temporary.replace(marker)
        state["pending"] = False
        save_state(state)
        print("Applied verified selfhost server WZ release", descriptor["releaseId"])
PY

if [ "${WZ_SEED_BASELINE_ONLY:-}" = "1" ]; then
  exit 0
fi

exec java -Xmx1280m -Xms512m -jar ./Server.jar
