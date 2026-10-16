#!/bin/bash
# BunsMS Asset Publisher — stage client files to the self-hosted asset dir
# and record hashes in the launcher manifest.
#
# Usage:
#   ./tools/publish_assets.sh [source-dir]            # stage + register + bump
#   ./tools/publish_assets.sh --urls-only             # rewrite URLs to self-hosted base, no version bump
#
# Flow (mirrors the old publish_client.sh scope, all manifest names not just *.wz):
#   1. rsync/scp bytes to the asset host dir (ASSET_HOST:ASSET_DIR or local ASSET_DIR)
#   2. POST register to the dashboard (re-hashes landed bytes fail-closed)
#      .. which patch-bumps the manifest version atomically.
#
# Env:
#   DASHBOARD_URL  dashboard origin (default https://buns.asslorde.com)
#   ASSET_HOST     ssh target for rsync (empty = local copy)
#   ASSET_DIR      asset dir on target (default /opt/buns/client-assets)

set -euo pipefail

SOURCE_DIR="${1:-./patched}"
DASHBOARD_URL="${DASHBOARD_URL:-https://buns.asslorde.com}"
ASSET_HOST="${ASSET_HOST:-}"
ASSET_DIR="${ASSET_DIR:-/opt/buns/client-assets}"
ASSET_BASE="${ASSET_BASE_URL:-https://buns.asslorde.com}"

if [ "${1:-}" = "--urls-only" ]; then
  echo "=== Rewriting manifest URLs to self-hosted base (no version bump) ==="
  MANIFEST_JSON=$(curl -s "$DASHBOARD_URL/api/launcher/manifest")
  URLS=$(python3 -c "
import json,sys
m = json.load(sys.stdin)
base = '$ASSET_BASE/client/'
urls = {}
for f in m['files']:
    obj = f['name']
    urls[f['name']] = base + obj
print(json.dumps(urls))
" <<< "$MANIFEST_JSON")
  curl -s -X POST "$DASHBOARD_URL/api/launcher/manifest" \
    -H "Content-Type: application/json" \
    -d "{\"urls\":$URLS}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  URLs rewritten' if d.get('success') else f'  ERROR: {d}')"
  echo "=== Done (version unchanged — zero re-downloads expected) ==="
  exit 0
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: Source directory not found: $SOURCE_DIR"
  exit 1
fi

echo "=== BunsMS Asset Publisher (self-hosted) ==="
echo "Source: $SOURCE_DIR"
echo "Target: ${ASSET_HOST:+$ASSET_HOST:}$ASSET_DIR"
echo ""

# 1. Sync bytes (rsync delta-transfer; --checksum so same-name-changed-bytes are caught)
if [ -n "$ASSET_HOST" ]; then
  rsync -avz --checksum --progress "$SOURCE_DIR/" "$ASSET_HOST:$ASSET_DIR/"
else
  mkdir -p "$ASSET_DIR"
  rsync -av --checksum "$SOURCE_DIR/" "$ASSET_DIR/"
fi

# 2. Build register payload from staged files that are in the manifest allowlist
MANIFEST_JSON=$(curl -s "$DASHBOARD_URL/api/launcher/manifest")
REGISTER=$(python3 -c "
import json,sys,os
m = json.load(sys.stdin)
allowed = {f['name'] for f in m['files']}
items = []
for fn in sorted(os.listdir('$SOURCE_DIR')):
    if fn in allowed:
        items.append({'name': fn})
    else:
        print(f'  SKIP (not in manifest): {fn}', file=sys.stderr)
print(json.dumps(items))
" <<< "$MANIFEST_JSON")

COUNT=$(python3 -c "import json; print(len(json.loads('$REGISTER')))" 2>/dev/null || echo 0)
if [ "$COUNT" = "0" ]; then
  echo "No manifest-tracked files to register in $SOURCE_DIR"
  exit 0
fi

echo ""
echo "--- Registering $COUNT file(s) (server re-hashes landed bytes) ---"
curl -s -X POST "$DASHBOARD_URL/api/launcher/manifest" \
  -H "Content-Type: application/json" \
  -d "{\"register\":$REGISTER}" | python3 -c "
import sys,json
d = json.load(sys.stdin)
if d.get('success'):
    print(f'  Registered -> manifest v{d.get(\"version\")}')
    for r in d.get('results', []):
        print(f'    {r[\"name\"]}: {r[\"size\"]} bytes sha256:{r[\"hash\"][:16]}...')
else:
    print(f'  ERROR: {d}')
    sys.exit(1)
"

echo ""
echo "=== Done ==="
echo "Players download only changed files on next launcher start (size+hash diff)."
echo "Rollback: re-publish the previous manifest JSON via POST {manifest: ...}."
