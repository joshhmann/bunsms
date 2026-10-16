#!/bin/bash
# Install root-owned, mode0755 as /usr/local/sbin/buns-private-deploy.
# Called over the existing operator SSH route, or a separately configured CI SSH
# route. It does NOT create runner connectivity, open a port, or install secrets.
set -euo pipefail
set +x
ROOT=/opt/buns
set -a
. /etc/buns/assets.env
set +a
export DASHBOARD_URL=http://192.168.0.164:3001
command=${1:?Expected publish/bootstrap/rollback/deploy-dashboard/deploy-web}
argument=${2:?Expected approved candidate ID, retained release ID, or commit SHA}
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then echo 'Expected operation, argument, and optional exact source SHA' >&2; exit 2; fi
if [ "$#" -eq 3 ]; then
  [[ "$3" =~ ^[a-f0-9]{40}$ ]] || exit 2
  [ "$(git -C "$ROOT" rev-parse HEAD)" = "$3" ] || { echo 'Private publisher source is not the approved workflow commit; deploy verified source first' >&2; exit 1; }
fi
case "$command" in
  publish|bootstrap)
    [[ "$argument" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{7,95}$ ]] || exit 2
    source="$ROOT/publication-inputs/$argument"
    [ -d "$source" ] && [ ! -L "$source" ] || { echo 'Approved candidate directory is missing' >&2; exit 1; }
    [ "$(realpath "$source")" = "$source" ] || exit 2
    options=()
    if [ "$command" = bootstrap ]; then options+=(--bootstrap); fi
    if [ -f "$source/operations.json" ]; then options+=(--operations "$source/operations.json"); fi
    exec bash "$ROOT/tools/publish_assets.sh" "${options[@]}" "$source"
    ;;
  rollback)
    [[ "$argument" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{7,95}$ ]] || exit 2
    exec bash "$ROOT/tools/publish_assets.sh" --rollback "$argument"
    ;;
  deploy-dashboard|deploy-web)
    [[ "$argument" =~ ^[a-f0-9]{40}$ ]] || exit 2
    # Refuse local edits rather than discarding operator work.
    git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet || { echo 'Tracked deployment files are dirty; preserve and resolve changes first' >&2; exit 1; }
    git -C "$ROOT" fetch origin "$argument"
    git -C "$ROOT" merge --ff-only "$argument"
    [ "$(git -C "$ROOT" rev-parse HEAD)" = "$argument" ] || { echo 'Deployment did not select the exact approved commit' >&2; exit 1; }
    if [ "$command" = deploy-dashboard ]; then
      exec docker compose --env-file /etc/buns/assets.env -f "$ROOT/docker-compose.test.yml" up -d --no-deps --build dashboard
    fi
    git -C "$ROOT" submodule update --init --recursive -- web-client/vendor/maplestory-wasm
    release="/var/lib/buns/web-releases/$argument"
    [ ! -e "$release" ] || { echo 'Web release already exists; refusing overwrite' >&2; exit 1; }
    mkdir -p "$release"
    image="buns-web:$argument"
    docker build -t "$image" "$ROOT/web-client"
    container=$(docker create "$image")
    trap 'docker rm "$container" >/dev/null' EXIT
    docker cp "$container:/app/." "$release/"
    [ -s "$release/build/JourneyClient.js" ] && [ -s "$release/build/JourneyClient.wasm" ] && [ -s "$release/web/index.html" ]
    ln -s "$release" "/var/lib/buns/.web-current-$argument"
    mv -T "/var/lib/buns/.web-current-$argument" "/var/lib/buns/web-current"
    systemctl restart buns-web.service
    ;;
  *) echo 'Unsupported private deployment operation' >&2; exit 2 ;;
esac
