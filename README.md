# BunsMS 🍑

A MapleStory v83 private server powered by an AI Game Master. Built on [Cosmic](https://github.com/P0nk/Cosmic) (HeavenMS fork) with a custom dashboard, auto-updating launcher, and an LLM-driven Game Master that manages the world autonomously.

## Architecture

```
bunsms/
  server/       # Java game server (Cosmic v83, Docker, Fly.io)
  dashboard/    # Next.js 15 admin panel + APIs (App Router, Fly.io)
  launcher/     # Electron desktop launcher (auto-update, Windows)
  client/       # Patched MapleStory v83 client + custom WZ files
  mcp-server/   # Standalone MCP tools server (external integrations)
```

### Game Server
- Cosmic v83 MapleStory emulator running on Fly.io (IAD region)
- MySQL 8.4 database with Liquibase migrations
- Login server (port 8484) + 3 channel servers (7575-7577)
- Config patched at runtime via environment variables

### Dashboard
- Next.js 15 with App Router, deployed on Fly.io
- 24+ API endpoints: maps, mobs, items, characters, drops, config, server control, scripts, accounts
- Admin authentication with Cloudflare Turnstile
- Real-time server status and player management

### AI Game Master
- Uses Claude via `@anthropic-ai/claude-agent-sdk` (Claude Code SDK)
- ~35 MCP tools for reading/modifying game state (drops, shops, events, spawns, config, WZ files)
- Streams responses via SSE (thinking, tool calls, text)
- Can autonomously manage events, balance drop rates, adjust economy, and publish client updates
- Dashboard UI at `/gamemaster` with preset prompts, session history, and live tool execution logs

### Launcher
* Electron app for Windows (NSIS installer; standalone `launcher-installer.yml`
  workflow builds on `windows-latest` and uploads the installer as an artifact)
* Manifest-based auto-update: checks SHA256 hashes, downloads changed files
* `BUNSMS_API_BASE` env (baked at build time, default `https://buns.asslorde.com`)
  selects the dashboard for manifest/news/status — set to
  `http://192.168.0.164:3001` for test-stack builds
* Server Address field: persisted locally, stamped into game `config.ini`
  `ServerIP_Address` on change and after downloads (compiled client dials
  fixed login port **8484** — point at a host with 8484 reachable; test
  needs 8484, not the 9494 docker alias)
* Server status display, news feed from GM activity
* Client files hosted on R2 (`pub-34b8b332208f464a9e74fa14104be3e2.r2.dev`)

## Deployment

All deployments are automated via GitHub Actions on push to `main`:
- **Dashboard**: Builds and deploys to Fly.io (`buns-ms`)
- **Game Server**: Builds and deploys to Fly.io (`buns-ms-game`)
- **Launcher**: Builds Windows installer and publishes to GitHub Releases

### Infrastructure
- **Fly.io**: Game server (2GB RAM, 2 CPU), dashboard (512MB), MySQL database
- **Cloudflare**: DNS + CDN for bunsms.com (dashboard)
- **GitHub Releases**: Client file hosting for launcher downloads

## Local Development

```bash
# Game server (requires Docker)
cd server && docker compose up

# Dashboard
cd dashboard && npm install && npm run dev

# Launcher
cd launcher && npm install && npm start -- --dev
```

## Client Setup

Manifest-driven (no manual WZ hunting):
1. Install `BunsMS Setup 1.0.2.exe` (CI artifact `bunsms-launcher-installer`).
2. Open the launcher, set Install Location, and let it download + hash-verify
   every file from `:3001/api/launcher/manifest` (or prod manifest by default).
3. Set Server Address to your login host — the compiled client dials fixed
   port **8484**, so that host must have 8484 reachable (test: `192.168.0.164`
   with the `8484:8484` mapping; prod host default `213.188.212.103`).
4. For test-stack use, launch with
   `$env:BUNSMS_API_BASE='http://192.168.0.164:3001'` (runtime env, see notes).
5. Press Play. HD Mode (Ezorsia `dinput8.dll` + `config.ini`) is optional.

## Journey browser routing repair — 2026-10-14 (solobots)

The existing Journey surface is deployed and smoke-verified:
- Production: <https://buns.asslorde.com/> or <http://192.168.0.164:8080/>.
- Development: <https://dev.buns.asslorde.com/> or <http://192.168.0.164:8081/>.
- The loader derives `ProxyIP`, `ProxyPort`, and `AssetsServerProtocol` from
  the page origin: LAN uses `ws` on 8080/8081; HTTPS uses same-origin `wss`
  on 443. Both config files now select game target `192.168.0.164:9494`
  and local assets `/nx`; config fetch bypasses cache, while the page,
  config, and existing JS/WASM files are served with revalidation headers.

Diagnosis, in ranked order: (1) served configs selected the old `.157`
target and public proxy, matching the reported browser log; (2) deployed
Python allowlists still permitted only `.157`, independently rejecting a
direct LAN WS request for `.164:9494`; (3) inspection of Caddy's disk and
live configuration found both public upstreams still pointing at `.157`.
The new-target LAN probe was red (WS closed without a v83 handshake);
the known old-domain failure was not rerun just to reconfirm it.

Deployment truth:
- `server.py`, routing configs, and the loader fix were deployed to
  `/opt/buns/web-client` and `/opt/buns-dev`; existing dev-page differences
  were preserved. Only `buns-web` and `buns-web-dev` were restarted.
- Their units retain `STATIC_ROOT`, ports 8080/8081, and
  `NX_DIR=/opt/buns/nx`, and explicitly set
  `ALLOWED_TARGETS=192.168.0.164:9494,192.168.0.164:8484,192.168.0.164:7575,192.168.0.164:7576,192.168.0.164:7577`.
  Configure this environment explicitly on future deployments; the Python
  default remains loopback-only for a colocated server.
- Pre-change web files and units are backed up at
  `/opt/buns/backups/journey-routing-20261014-0748/web-routing.tar`.
- The authorized gateway repair on `192.168.0.70` changed only the
  buns/dev `reverse_proxy` destinations in `/etc/caddy/public.Caddyfile`
  to `.164:8080`/`.164:8081`, validated and reloaded Caddy. Its backup is
  `/etc/caddy/public.Caddyfile.bak.journey-20261014-upstream`.
- No Java, database, compose, NX files, or Node/WASM engine changes.
  Production JS/WASM hashes start `d9154da1`/`180e21d7`; dev retains its
  distinct pre-existing pair `948404ba`/`e8cefcd9`. Neither pair was copied
  or rebuilt; both initialized and rendered the login screen.

Verification:
- `cd web-client && python3 -m unittest test_routing -v`: 5/5 passed after
  the config/cache regressions were observed red. Covers first-message text
  and binary WS targets, TCP v83 handshake forwarding, denied targets,
  page/config/build revalidation, and NX Range.
- Real HTTP config and WS-to-TCP smoke passed on all four URLs above,
  for all five allowed ports: 16-byte handshake, packet length 14, version
  83. Denied targets closed without a handshake; `/nx/Base.nx` returned
  HTTP 206 with `Content-Range: bytes 0-15/13296` and `PKG4` bytes.
- Fresh Chromium Journey pages (not Maplewright) rendered login on LAN
  and both public origins. CDP captured HTTP 101, the binary first message
  `192.168.0.164:9494`, and the binary 16-byte v83 response for production
  LAN and both public WSS origins. Dev LAN logged same-host `ws` on 8081.
- This establishes connection and login-surface rendering, not a complete
  Journey login/gameplay feature audit. No account login was attempted;
  the separate Maplewright gameplay demo at `.187` was not modified.

## Patch Notes — 2026-10-14 (solobots `9b56e04`)

Deployed to TEST stack (192.168.0.164, compose `test`):
- Upstream cherry-picks Group A (`0874223`, live in server image):
  ChangeMapSpecialHandler script-NPC fallback (Door of Dimension),
  PlayerShop visitor-removal broadcast. (Python WS proxy changes were
  deployed separately in the Journey routing repair above.)
- Group B (`60b869c` + `ea42615`, live): Autoban SKIP log-gate for noisy
  heal/gacha (dead `flagCheat` helper removed — zero call sites, no DB
  writes; `cheat_flags` table idle), stylist `getLiveWzStyles` + TTL cache,
  DeleteChar PIC removal (deliberate).
- World capacity counts humans only (`0d76a4d`, live): 3168 bots no longer
  wedge charlist at SERVERSTATUS 2 — maple-build verified
  `GOT-CHARLIST status=0 chars=1 (Admin)`; 300-human cap still enforced.
  `WorldCapacityBotsTest` 3/3 GREEN (bots-open / humans-closed / mixed).
  Known design flag: bot predicate is `id > 20000` — a real character row
  with id above 20000 would count as bot (no redesign in this pass).
- Test compose: `8484:8484` added alongside `9494:8484` (host 8484 was free;
  `ss` checked before change). Both TCP handshakes OK; `9494` retained.
- Dashboard rebuilt — `:3001/api/launcher/manifest` serves v1.0.5 (16 files,
  8 live-verified hashes); `:3001/api/server` `players:0` = human sessions
  (`accounts WHERE loggedin>0`; bots hold no login rows — by design).
- Repo config: `SPAWN_BOTS_ON_STARTUP:true` + `USE_CUSTOM_KEYSET:false`
  committed (were live-only drift); live config byte-identical after sync.

Source-only (in repo, NOT deployed):
- Launcher changes (`bfd3082`): NOT installed anywhere — ship via the CI
  artifact below. `BUNSMS_API_BASE` is a **runtime** process env (read at
  Electron launch, not baked). Test-stack launch from PowerShell:
  `$env:BUNSMS_API_BASE='http://192.168.0.164:3001'; & "$env:LOCALAPPDATA\BunsMS\BunsMS.exe"`
  (default `%LOCALAPPDATA%\BunsMS` per NSIS oneClick install; adjust if you
  chose otherwise). Without it the launcher defaults to the public origin;
  use the explicit test-stack API base for this test deployment.
- Name note: manifest keeps local name `BunsMS.exe` but downloads the
  `AugurMS.exe` R2 key — byte-identical (SHA256 `d4be8319…`, full 9920523 B
  download verified), no recompile/upload. `config.ini` entry uses live
  `ezorsia-config.ini` bytes (990 B, `eb397665…`).

Manual setup (manifest-driven, no fake paths): install the NSIS artifact,
set Install Location in the launcher, and let it download/verify every file
from the manifest (hash-checked; `config.ini` skipped if you customized it).
Then set Server Address to your login host (client dials fixed port 8484)
and press Play. No `client/cosmic-wz/` directory exists in this repo.

CI: [Deploy & Release run 38576650941](https://github.com/joshhmann/bunsms/actions/runs/38576650941)
(success; `bunsms-launcher-installer` 83.8 MB,
`BunsMS Setup 1.0.2.exe` SHA256 `34fc2005…`).

Live browser smoke (maple-build, 2026-10-14, test stack — no mocks):
- Chain: LOGIN OK → CHARLIST len=151 status=0 → channel :7575 →
  SET_FIELD map 100000000 (Henesys). Reviewed `/tmp/shot14_hgame.png`
  (test character standing in live Henesys, 3+ dressed remote bot peers
  rendered) and `/tmp/shot14_hmoved.png` (displaced right after 2.5 s
  ArrowRight — movement works, peers persist). Zero browser console errors.
- Native diagnostic (same session): 71 map peers / 71 sprite sets loaded,
  ~4250 live movement packets in 20 s — bots move server-side.
- Reproducible local checkout `/tmp/mw` + patch `/tmp/mw.patch` (136 lines,
  5 files) + runbook `/tmp/RUNBOOK.md`; demo at `http://192.168.0.187:8080`
  (WS :8081, nohup unsupervised — not part of shipped stack).
- Asset limits: stock v83 installer + hash-verified UI confirmed; Kinoko set
  FAILED the WZ parser — must not be described as v83-compatible;
  Sound/TamingMob absent, NPC/quest/shop alpha incomplete.

- Public Journey buns/dev routes are restored by the repair above.
- Group C remainder, Cosmic PRs #348/#352/#353/#354, owner bundle: parked.
- Kaentake preferred-target trial (UNVERIFIED, local-only
  `/tmp/kaentake-trial/` — nothing pushed): v3.4.1 assets staged
  (Kaentake.exe `792e1023…`, Kaentake.dll `b05a9e12…`,
  Custom.wz `79180961…`; both PE32 x86, matching stock
  `MapleStory.exe` x86 from `/tmp/mw-wz/full/`). Upstream declares NO
  license — no redistribution without grant. Trial `config.ini` points at
  `192.168.0.164:8484`. No Ezorsia DLLs mixed in; no Wine/Windows host
  here so end-to-end is UNVERIFIED (blocker). Config/port compatibility is
  source-based only (`[config] host/port`, CLI precedence) — NOT a working
  client claim. Later launcher support must use a distinct profile, never
  silently replace `BunsMS.exe`.
