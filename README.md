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

The launcher handles this automatically. For manual setup:
1. Run `MapleGlobal-v83-setup.exe` (vanilla installer)
2. Remove: `HShield/`, `ASPLnchr.exe`, `MapleStory.exe`, `Patcher.exe`
3. Copy all `.wz` files from `client/cosmic-wz/` into the install directory
4. Copy `BunsMS.exe` (R2 `AugurMS.exe` bytes, same SHA) into the install directory
5. Set `config.ini` `ServerIP_Address` to your login host (port is fixed 8484)
6. Launch `BunsMS.exe`

## Patch Notes — 2026-10-14 (solobots `0d76a4d`)

Shipped to TEST stack (192.168.0.164, docker compose `test`):
- Upstream cherry-picks Group A (`0874223`): env-driven WS proxy allowlist,
  no-cache `/build/*` middleware, PlayerShop visitor-removal broadcast,
  ChangeMapSpecialHandler script-NPC fallback (Door of Dimension).
- Group B (`60b869c`): Autoban SKIP log-gate (noisy heal/gacha), stylist
  `getLiveWzStyles` + TTL cache, DeleteChar PIC removal (deliberate).
- Baseline client (`bfd3082`): launcher `BUNSMS_API_BASE` (default prod,
  `http://192.168.0.164:3001` for test builds), Server Address field stamped
  to `config.ini` `ServerIP_Address`, manifest v1.0.5 with 8 live-verified
  hashes, artifact-only installer workflow.
- `/nx` route restored (`a75add5`) — live systemd units serve NX from disk.
- World capacity counts humans only (`0d76a4d` + `WorldCapacityBotsTest`
  3/3 GREEN): 3168 bots no longer wedge charlist at SERVERSTATUS 2; 300-human
  cap still enforced. `USE_CUSTOM_KEYSET:false` + `SPAWN_BOTS_ON_STARTUP:true`
  committed to repo config (was live-only drift).
- Test compose: `8484:8484` added alongside `9494:8484` (host 8484 was free).
  Dashboard rebuilt — `:3001/api/launcher/manifest` serves v1.0.5;
  `:3001/api/server` reports `players:0` = human sessions (bots excluded by
  design — `accounts WHERE loggedin>0` has no bot rows).
- Name note: launcher downloads `BunsMS.exe` (local name) from the
  `AugurMS.exe` R2 key — byte-identical (SHA256 `d4be8319…`), no recompile or
  upload performed.

CI: [Deploy & Release run 38576650941](https://github.com/joshhmann/bunsms/actions/runs/38576650941)
(success; `bunsms-launcher-installer` artifact 83.8 MB,
`BunsMS Setup 1.0.2.exe` SHA256 `34fc2005…`).

NOT done / known limits:
- Windows UI path untested (no Windows host): installer builds, but no
  click-through, DLL-load, or real `BunsMS.exe` connect exercised.
- Public domain `buns.asslorde.com` returns 502 — prod unreachable; recipes
  above target the test stack.
- Group C (launcher sleepTime/dinput8 already in tree; dashboard items),
  Cosmic PRs #348/#352/#353/#354, owner bundle: parked, not started.
