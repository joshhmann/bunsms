# Self-hosted asset serving — implementation record (branch `selfhost-assets`)

Owner direction executed: ALL R2 reads/writes moved to self-hosting on the
measured topology (LXC .164 app host, .70 Caddy edge). No Fly references remain
in the asset path. R2 objects are NOT deleted (rollback standby).

## What changed (code)

- `dashboard/src/lib/assets.ts` (new): `ASSET_BASE_URL`/`ASSET_DIR`, allowlist
  `resolveAssetPath` (traversal → 400), atomic manifest writes (tmp+rename),
  fail-closed `verifyStagedBytes`/`hashFileStream`, `bumpPatch` (URL-only edits
  never bump), canonical `BunsMS.exe`/`config.ini` object names (bytes preserved:
  R2 `AugurMS.exe` sha256 == manifest `BunsMS.exe` hash, verified).
- `dashboard/src/app/api/launcher/manifest/route.ts`: single authority +
  `?profile=stock|kaentake` server-side filter (absent → full set for old
  launchers; stock default; Kaentake never in stock results) + `register` mode
  (re-hash landed bytes fail-closed) + atomic writes.
- `dashboard/src/app/api/launcher/download/[name]/route.ts` (new): 200 / 206 +
  `Content-Range` / 416 / HEAD / `ETag` / `Accept-Ranges` / `Content-Length`.
- `dashboard/src/app/api/launcher/upload/route.ts`,
  `api/admin/wz/upload`, `api/admin/wz/register`: stage to asset dir, no R2
  gate/credentials, no game-server restart.
- Publish flows (`items`, `assets`, `baker`, `reactors`), art uploads
  (`assets`, `reactors`), render routes (`render-concept`, `render-weapon`,
  `items/generate`), WZ readers (`explorer`, `server-xml`): asset-dir
  reads/writes under `ASSET_BASE_URL/client/`.
- Retired: `dashboard/src/lib/r2.ts`, `dashboard/src/lib/fly-restart.ts`.
  All `restartGameServer` call sites (4 publish flows, `gm/restart`,
  `gm/npcs`, GM engine text) → manual-restart messaging. No live Java/DB
  mutated by this workstream.
- `launcher/launcher-manifest.json` + `dashboard/launcher-manifest.json`:
  unified to the 19-file set with `https://buns.asslorde.com/client/` URLs,
  version pinned at 1.0.5 (URL-only flip → zero re-downloads).
- `web-client/server.py`: `/client/{path}` static route (basename-only,
  `FileResponse` Range/206 native), `CLIENT_ASSETS_DIR` env.
- `tools/publish_assets.sh` (new): rsync + register + `--urls-only` flip;
  `publish_client.sh` (wrangler) retained until soak ends.
- Tracker: Ticket 17 in `server/docs/ROADMAP-BACKLOG.md` (actually-exercised
  scope, not a blanket done-claim).

## Cutover proof (live, 2026-10-16)

- Dashboard rebuilt on .164 (`docker compose build dashboard` + `up -d`,
  volume mounts `./client-assets:/cosmic/client-assets` +
  `./launcher-manifest.json:/cosmic/launcher-manifest.json:ro`,
  `ASSET_BASE_URL`/`ASSET_DIR` env): LAN manifest = v1.0.5/19 files,
  `?profile=kaentake` = 15 incl. triple, `?profile=stock` = 16 with zero
  Kaentake mix.
- Public manifest (`https://buns.asslorde.com/api/launcher/manifest`) = same
  19-file set. Public `/client/List.wz` sha256 matches manifest;
  Range-resume 206 verified publicly.
- LAN `api/launcher/download/*` = 200 + 206 resume (internal spare path);
  publicly 404 by design (only `/client/*` advertised, admin/ops unrouted).
- Launcher-flow test (real `filterManifest` + Range-append resume):
  stock subset + Kaentake triple resume + profile isolation PASS.

## Remaining

- Soak (≥1 publish cycle) → retire R2 + `publish_client.sh` + wrangler.

## Rollback

- Manifest: re-publish previous R2-URL JSON via `POST {manifest: …}`;
  backups in `/opt/buns/manifest-backups/`. R2 objects untouched.
- Caddy: restore `public.Caddyfile.bak-pre-selfhost-*` + reload.
- web static: restore `server.py.bak-pre-selfhost` + restart service.
- Dashboard: `/opt/buns/dashboard.bak-pre-selfhost` + compose backup.

## Known gaps (not hosted, by decision)

- Native runtime (MapleStory.exe, Canvas.dll, Gr2D_DX8.dll, ijl15.dll,
  bz32ex.dll, aossdk.dll, l3codeca.acm, ASPLnchr.exe) + Base/Effect/Sound/
  Morph/TamingMob.wz: never on R2; pending WZ owner pinned-installer baseline
  (dump-instructions) + desktop owner runtime files. No download URLs added
  without bytes. Complete Kaentake onboarding manifest open.
- `BunsMS.dll`: seeded bytes only after dll-tree-build handoff hash; OUT of
  manifest until co-load audit passes (`profiles:["kaentake"]`+experimental
  agreed for later).
- Hosted UI.wz lacks DailyCheckin backdrop art (flagged by dll-tree-build);
  ships via this pipeline when art is ready.
