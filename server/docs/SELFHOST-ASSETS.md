# Self-hosted asset serving — operating record (branch `selfhost-assets`)

Owner direction executed: ALL R2 reads/writes moved to self-hosting on the
measured topology (LXC .164 app host, .70 Caddy edge). Zero R2/Fly code
references remain (`lib/r2.ts`, `lib/fly-restart.ts`, `tools/publish_client.sh`
deleted). R2 bucket objects are NOT deleted (external standby only — nothing
reads them).

## Serving topology (actual)

- Bytes: aiohttp static on .164 (`buns-web.service`,
  `CLIENT_ASSETS_DIR=/opt/buns/client-assets`), route `/client/{path}`.
  Nested keys allowed with realpath containment (no traversal/symlink escape;
  `releases/` staging + dotfiles never served). Flat `Map.wz` and nested
  `assets/hair/00060000.img`, `server-wz.tar.gz`, `candidates/…` all served.
- Cache: mutable live keys `max-age=60, must-revalidate` (a same-path new WZ
  can never stay stale); immutable revision paths `/client/r/<sha256>/<key>`
  hash-gated (404 on mismatch) with `immutable`.
- Manifest/bytes authority: dashboard on .164 (`buns-dashboard-1`), manifest
  read order volume `manifest-writable/` → legacy volume file → bundled
  bootstrap seed; GET discloses `X-Manifest-Authority: volume:…|bundled-…`.
- Public edge (.70 Caddy): `/client/*` → :8080; `/api/launcher/manifest*`,
  `/api/launcher/news*`, `/api/server` GET/HEAD-only → :3001 (named matchers;
  POST/PUT/DELETE/PATCH → 405, proven, no state change); everything else →
  :8080; `/api/admin/*` unrouted (404). No Next.js download route exists —
  the spare `api/launcher/download/[name]` was removed; the aiohttp service
  is the single byte path.

## Publish contract (actual, all flows)

Staged release with expected-hash verification, atomic promotion, and
previous-bytes retention — in `POST /api/launcher/manifest {stage,register}`,
`POST /api/launcher/upload?releaseId=`, `POST /api/admin/wz/upload`, and the
four publish jobs (`items`, `assets`, `baker`, `reactors`):

1. `stage` mints `releaseId`; bytes land under `releases/<id>/` (never live).
2. Caller supplies EXPECTED `{name, hash, size}` per file (built from the
   patched bytes it just produced, or from the WZ owner's provenance
   manifest — never inferred from live).
3. Under the inter-process publish lock: verify ALL staged bytes against
   expected (any mismatch aborts, live + manifest untouched) → promote each
   (per-file rename; previous live bytes retained under
   `releases/prev-<id>/`) → atomic manifest write (tmp+rename) + patch version
   bump → NX dispatch fires only after promotion.
4. Rollback = restore previous manifest JSON (`POST {manifest: …}`) + copy
   retained previous bytes live (one `cp` per file from `releases/prev-<id>/`).
   R2 plays no role.
5. Auth: public `/api/launcher/` is GET/HEAD-only (middleware); POST requires
   session JWT or `x-gm-secret` (LAN unauth POST → 401, proven).

Generated art (`assets/<type>/<id>.<ext>`, `reactors/<id>/idle.png`,
`custom-items/…`, `server-wz.tar.gz` + `server-wz.version`) stages through the
same release dirs and promotes with the same lock — not a CLI-register-only
path. No game-server restart is triggered anywhere (owner-manual on LXC).

## Proven live (2026-10-16, evidence in result JSON)

- Wrong-hash register → 400, live bytes + manifest unchanged; correct register
  → v1.0.6 promoted with new bytes; previous bytes retained; rollback →
  v1.0.5 + original bytes publicly verified. Real List.wz cycle bytes were a
  DIAGNOSTIC payload (seed List.wz + suffix, NOT a valid WZ) — no fake asset
  was published as content; the entry was rolled back to the true WZ bytes.
- Stock-default GET (no param) = 16 files, zero triple leak; `?profile=kaentake`
  = 15; unknown profile = 400; authority header `volume:…manifest-writable/…`.
- Map.wz full-SHA + tail-206; nested candidate-3 (10/10) + candidate-4 (13/13
  URLs, 51/51 provenance incl. HShield/*) staged UNPROMOTED, zero manifest refs.
- 16-assertion isolated staged-cycle proof (`/tmp/accept/cycle.mjs`), 22-assertion
  smoke (`/tmp/asset-smoke/smoke.mjs`), launcher profile tests, `tsc` clean,
  Node-20 compat (container v20.20.2).
- `gameHost`/`gamePort` additive on `/api/server` (in-compose check documented
  as such). External TCP reachability = UNVERIFIED (no non-LAN vantage);
  external friends stay LAN/VPN-required.

## Operator runbook

- Publish: `./tools/publish_assets.sh <staged-dir>` (rsync → register with
  expected hashes → verify/promote/bump) or the admin UI register flow.
- Rollback (self-host): re-POST previous manifest from
  `/opt/buns/manifest-backups/` + `cp releases/prev-<id>/<file> <live>` per
  changed file. R2 restore is NOT the rollback path.
- Caddy: restore `public.Caddyfile.bak-pre-methodgate-*` + reload (method gates
  included). web static: `server.py.bak-pre-nested` + restart service.
  Dashboard: `/opt/buns/dashboard.bak-pre-selfhost` + compose backups.
- Mounts that must stay writable by uid 1001: `client-assets/`,
  `manifest-writable/` (fixed live via chown after EACCES; `GM_API_SECRET` set).

## Open (not done)

- Ticket 15 STAYS OPEN: full native corpus + final triple/DLL decisions pending
  WZ/desktop owners. No 'all tickets complete' claim from cutover.
- `BunsMS.dll` out-of-manifest until co-load audit; DailyCheckin backdrop art
  pending; Windows CI installer smoke with DLL worker.
