# BunsMS 🍑

A MapleStory v83 private server powered by an AI Game Master. Built on [Cosmic](https://github.com/P0nk/Cosmic) (HeavenMS fork) with a custom dashboard, auto-updating launcher, and an LLM-driven Game Master that manages the world autonomously.

## Architecture

```
bunsms/
  server/       # Java game server (Cosmic v83, Docker on the measured LXC host)
  dashboard/    # Next.js 15 private admin panel + APIs (App Router)
  launcher/     # Electron desktop launcher (auto-update, Windows)
  client/       # Patched MapleStory v83 client + custom WZ files
  mcp-server/   # Standalone MCP tools server (external integrations)
```

Current release boundary: the accepted full-content Windows TESTING RC and its
matching Linux test server are required together. Production .164 Java/DB and
the existing browser/NX world stay unchanged until verified acceptance/rollout.
Browser and Linux/Wine work are parked, not new-world compatibility claims.
See [current source, exact artifacts and evidence](server/docs/CURRENT-STATE.md)
and [the accepted roadmap](server/docs/ROADMAP-BACKLOG.md); the Windows CI Java
stack is temporary QA, not a Windows production backend/player dependency.

### Game Server
- Cosmic v83 on the existing Linux LXC/Docker Compose `/opt/server` deployment
- MySQL with shipped Liquibase migrations; isolated current RC proofs use8.0.36
- Login8484 and channels7575–7577; private QA cohorts do not change public NAT
- Runtime environment/config plus genuine authored bot data, not a Java source-tree copy

### Dashboard
- Next.js 15 with App Router, on the private LAN Docker stack
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
* `BUNSMS_API_BASE` runtime env (default `https://buns.asslorde.com`)
  selects the dashboard for manifest/news/status — set to
  `http://192.168.0.164:3001` when launching against the test stack
* Server Address field: persisted locally, stamped into game `config.ini`
  `ServerIP_Address` on change and after downloads (compiled client dials
  fixed login port **8484** — point at a host with 8484 reachable; test
  needs 8484, not the 9494 docker alias)
* Server status display, news feed from GM activity
* Client/native art/server/NX files use verified immutable selfhost releases;
  see [publication and rollback](server/docs/SELFHOST-ASSETS.md).

## Deployment

Source deployments use the measured LXC `.164` application host and `.70`
Caddy edge. The public edge exposes browser/WSS, asset reads and the three
launcher/server read APIs, not private mutation/control endpoints.

- **Dashboard/assets:** writable shared manifest directory and immutable object
  storage; authenticated private-LAN publisher and Unix-only control worker.
- **Game server:** verified selfhost baseline/overlay, server-only private apply;
  DB/schema and content activation retain their owner gates.
- **CI:** provisioned private SSH/known-host credentials and an actually reachable
  runner are required; absent credentials fail closed. No public write tunnel.
- **Launcher:** standalone Windows installer workflow/artifact.

Use the [selfhost operating contract](server/docs/SELFHOST-ASSETS.md) and
`deployment/` configuration, not the superseded Fly/R2 deployment instructions.
Canonical advertised production native host is `buns.asslorde.com`; explicit
LAN/loopback overrides remain supported. **Public native activation deferred by
owner**; this source does not claim public TCP connectivity or change ports/NAT.

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
   with the existing `8484:8484` mapping; future public host `buns.asslorde.com`,
   whose native activation is deferred by owner, not proven by this change).
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
- `cd web-client && python3 -m unittest test_routing -v`: 3/3 passed.
  Retained regressions exercise denied-target rejection without dialing a
  listening TCP probe, observable page/config/build revalidation, and NX Range.
  Source-string assertions and fixture-handshake forwarding tests were removed;
  actual deployed handshakes below supply the connection evidence.
- Real HTTP config and WS-to-TCP smoke passed on all four URLs above,
  for all five allowed ports: 16-byte handshake, packet length 14, version
  83. Denied targets closed without a handshake; `/nx/Base.nx` returned
  HTTP 206 with `Content-Range: bytes 0-15/13296` and `PKG4` bytes.
- Fresh Chromium Journey pages (not Maplewright) rendered login on LAN
  and both public origins. CDP captured HTTP 101, the binary first message
  `192.168.0.164:9494`, and the binary 16-byte v83 response for production
  LAN and both public WSS origins. Dev LAN logged same-host `ws` on 8081.
- Browser-derived runtime snapshots recorded target `.164:9494`, `/nx`,
  and proxy host/port/protocol matching each origin: `.164:8080`/`ws`,
  `.164:8081`/`ws`, `buns.asslorde.com:443`/`wss`, and
  `dev.buns.asslorde.com:443`/`wss`. All reached `[runtime] Initialized`.
  CDP observed actual WS URLs `ws://192.168.0.164:8080/`,
  `wss://buns.asslorde.com/`, and `wss://dev.buns.asslorde.com/`;
  dev LAN's client log recorded `ws://192.168.0.164:8081`.
- This establishes connection and login-surface rendering, not a complete
  Journey login/gameplay feature audit. No account login was attempted;
  the separate Maplewright gameplay demo at `.187` was not modified.

## Journey remote-player movement repair — 2026-10-14 (promoted to PROD 2026-10-15)

The browser engine treated the first remote movement as **50 physics updates**
of buffering (400 ms at the 8 ms timestep), then drained one endpoint per
update without using fragment durations. When the queue emptied it restarted
that delay. It also retained only the last fragment of each packet.

The discriminating experiment used a fresh, normal-protocol test account and
an actual remote character spawned by the live server. In that account's
isolated browser tab only, a protocol-valid synthetic stream entered the
original Emscripten WebSocket callback, through the real packet decoder,
`OtherChar`, physics, and renderer. The stream contained 140 single-command
absolute movements, each advancing 3 pixels over 50 ms. Physics coordinates
were sampled each animation frame; 60 fps videos independently show the motion.
No packet filtering or instrumentation is part of the shipped repair.

Ranked hypotheses and falsifiable discriminators:
1. **Update-count buffering:** regular 50 ms input would still produce
   approximately 400 ms freezes. Confirmed on the production engine and the
   exact pre-change dev bundle; duration-based playback removed those freezes.
2. **Lost fragment timing/endpoints:** a multi-fragment packet would not visit
   its intermediate endpoint at the specified time. The old caller selected
   only `.back()`; retained real-parser/model regressions now cover ordered
   fragments and leftover update time.
3. **Frame stalls or packet cadence:** if necessary for the defect, regular
   input and stable render frames would remove it. They did not: pre-change
   frame intervals never exceeded 16.8 ms while motion paused for 433.4 ms.
   This does not certify every live bot's packet cadence.
4. **Server reversals or foothold corrections:** if necessary, monotonic
   constant-Y input would not reproduce it. It did, with zero input/output
   reversals. Other maps and native clients remain untested.

Actual dev-engine comparison, using the same stream before and after:

| Measurement | Before | Deployed DEV |
| --- | ---: | ---: |
| Mean packet interval | 49.9986 ms | 50.0237 ms |
| Largest gap between position changes | 433.4 ms | 16.8 ms |
| Motionless gaps over 100 ms | 13 | 0 |
| Position-changing render samples | 70 | 418 |
| Largest per-frame position step | 6 px | 1.44 px |
| Final X / reversals | 573 / 0 | 573 / 0 |

The first command intentionally holds the spawn position for 50 ms; the first
observed position change was 407.4 ms before and 63.4 ms after. Both runs
finished without a WASM abort or JavaScript error. Before deployment, the rebuilt
pair also passed this same real-engine loop in an isolated browser asset
override: maximum motion gap 16.8 ms, no long holds.

Source/build ownership:
- `web-client/patches/remote-movement.patch` is BunSMS-owned and applies to the
  pinned submodule **8eece1d1fc43afa48e12df56b4719ca63af88e0b**. The submodule
  gitlink is unchanged; there is no unpublished replacement revision.
- The Docker build applies the patch with `git apply --check` followed by
  `git apply`. Drift or double application fails the build; nothing is silently
  skipped. Build from a clean initialized submodule checkout:
  `git submodule update --init web-client/vendor/maplestory-wasm`, then
  `docker build -t buns-journey web-client`.
- `RemoteMovement` advances all decoded fragments by their wire duration in
  milliseconds, carries time across fragment boundaries, and moves the real
  `PhysicsObject` once per update. Relative fragments carry pixels/second;
  teleport/zero-duration position changes remain instantaneous. No bot-ID
  branch, predictive buffer, speed cap, or arbitrary smoothing constant exists.
- Parser changes consume the existing teleport/chair and no-op payloads so
  following fragments stay aligned; jump-down destination/origin footholds
  remain distinct. Empty lists and stance-only moves are covered.
- `cd web-client && python3 -m unittest test_movement -v` passed. It exports the
  exact pinned source into a temporary directory, applies the shipped patch,
  and compiles the actual parser/playback/physics seam with
  `g++ -std=c++17 -Wall -Wextra -Werror`. Its 50 ms stream had a maximum hold
  of 0 ms and reached X=299.64 at 5 s; duration, multi-fragment, relative,
  no-op, stance, teleport, empty-list, and foothold boundaries passed.

Deployment and provenance:
- Only `/opt/buns-dev/build` on **192.168.0.164:8081** was replaced. A Linux
  `renameat2(RENAME_EXCHANGE)` atomically exchanged the complete build directory
  with `/opt/buns-dev/build.before-movement-20261014`, which retains the exact
  previous JS/WASM pair. No service restart, Java/DB/Caddy change, or production
  asset replacement was performed.
- Build: isolated `/tmp/bot-jitter-wasm-build`, Emscripten **4.0.21**, Release,
  `./scripts/build_wasm.sh --jobs 4`; completed without compiler warnings.
  The original dev source tree was not edited. Its existing NPC/chat changes
  in `UIChatBar.cpp`, `UINpcTalk.cpp`, and `NpcInteractionHandlers.cpp` were
  copied by an explicit patch and their file hashes match the originals.
- Exact base, movement patch, complete applied source delta, preserved-file
  hashes, compiler image digest, baseline/new asset hashes, and measurements
  are recorded in `web-client/movement-build-manifest.json`. The complete dev
  source delta is backed up on the host at
  `/opt/buns-dev/movement-applied-source-20261014.patch`; the manifest is also
  copied to `/opt/buns-dev/movement-build-manifest-20261014.json`.
- New JS SHA256:
  `98ff3048bc1d99a8a4b9ac4e88f96d2772eb137b9b78e49314c528bf1c1dbe7f`.
  New WASM SHA256:
  `9a099050d05f02bc354bc7bc9cda9257663237813a1926347a5d6e7b9df211cb`.
  A fresh public dev browser fetched those hashes, completed normal login and
  character entry, and observed HTTP 101 on root WSS with first-frame targets
  `.164:9494` and `.164:7575`. Ordinary local-player walking still worked.
  Fresh LAN dev also rendered login without abort, using root
  `ws://192.168.0.164:8081/` and a real 16-byte v83 handshake.
- Local evidence: `/tmp/jitter-dev-before.webm`, `/tmp/jitter-dev-after.webm`,
  `/tmp/jitter-dev-before-metadata.json`, `/tmp/jitter-dev-after-metadata.json`,
  and `/tmp/jitter-dev-live-smoke.webm`. Metadata is explicitly synthetic;
  authentication packets/passwords are not published in the repository.

Limitations: the actual tutorial-map bot remained idle, so no live walking-bot
`CHAR_MOVED` cadence was claimed. Normal tutorial NPC interaction was attempted
but did not reach a bot-populated town. The experiment proves this browser
mechanism under the server's documented 50 ms single-fragment input shape,
not every live emitter path. Production's older binary/source provenance could
not be certified; the user explicitly authorized promotion despite that limit.
Desktop Journey, native OpenStory/Kaentake, and the separate Maplewright
`.187` surface were not tested or changed.

Production promotion — 2026-10-15 UTC:
- Promoted the exact verified dev JS/WASM pair above, without rebuilding, to
  `/opt/buns/web-client/build` on `192.168.0.164`. All four live/dev hashes
  matched the authorized values immediately before deployment.
- Whole-directory `renameat2(RENAME_EXCHANGE)` retained the previous pair at
  `/opt/buns/web-client/build.before-movement-20261015T005049Z`.
  Old JS SHA256:
  `d9154da1077a3e3349a04a57fdd6c9e03f343f56844eac244dad5ad55bd01329`;
  old WASM SHA256:
  `180e21d75edebc0611a40960df6d5ba78a68e9c2ba545e8443f9eb5cc88ceb57`.
  No Java, DB, systemd, Caddy, or service restart changes were made.
- Fresh cache-disabled Chromium at `https://buns.asslorde.com/` rendered login
  and completed normal isolated-account login, channel selection, character
  entry, and 1500 ms ordinary right-arrow movement. No page errors or runtime
  abort occurred. Both root WSS connections returned HTTP 101; the captured
  login target was `192.168.0.164:9494`, with a 16-byte v83 server handshake.
- Publicly fetched JS/WASM SHA256 matched the promoted pair exactly. Page
  and both build responses used `Cache-Control: no-cache, must-revalidate`.
  `Range: bytes=0-63` on `/nx/Map.nx` returned HTTP 206 and
  `Content-Range: bytes 0-63/1515032544`.
- Repeated `cd web-client && python3 -m unittest test_movement -v` passed:
  native actual-model/parser boundaries passed; uniform 50 ms input had
  maximum hold 0 ms and final X=299.64. This was a **native regression**,
  not a new production WASM synthetic replay. The prior DEV synthetic replay
  (16.8 ms maximum pause versus 433.4 ms baseline) used byte-identical assets;
  the controlled production replay was not repeated.
- Host provenance and complete preserved-source delta are alongside the build:
  `/opt/buns/web-client/movement-build-manifest-20261015.json`,
  `/opt/buns/web-client/movement-applied-source-20261015.patch`, and
  `/opt/buns/web-client/movement-production-smoke-20261015.json`.
  Local evidence: `/tmp/jitter-prod-smoke-20261015.json` and
  `/tmp/jitter-prod-live-smoke.webm`. No credentials are published.
- Rollback, if needed: atomically exchange the live whole build directory
  with the timestamped backup above using `renameat2(RENAME_EXCHANGE)`;
  never restore JS and WASM individually.

## Journey browser modernization — DEV only

This iteration targets reliable NPC/PIC input followed by true desktop
widescreen, not a client replacement or a production promotion. The production
baseline remains Journey JS
`98ff3048bc1d99a8a4b9ac4e88f96d2772eb137b9b78e49314c528bf1c1dbe7f`
and WASM
`9a099050d05f02bc354bc7bc9cda9257663237813a1926347a5d6e7b9df211cb`.
Candidate source is separate from the user's dirty `/root/workspace` checkout.
No Java, database, service, gateway, routing, or NX changes are part of this
iteration; HTTPS continues using same-origin WSS and login target `.164:9494`.
The existing prefetch mismatch and on-demand asset-loading policy are unchanged.

User-facing DEV changes:
- Desktop **Display** selects Auto viewport, Classic 800×600, Wide 1280×720,
  or Wide 1920×1080. The choice is saved locally and applies **in-game**.
  Login/world/character/creation screens remain centered classic 800×600 so
  their original art and control coordinates are not stretched or left
  top-left in a blank wide canvas. The toolbar reports both actual current
  dimensions and the requested in-game dimensions. Wide world modes reveal
  more world space instead of magnifying the classic framebuffer.
  Actual map extents cap the effective world mode: a requested 1920×1080
  becomes 1280×720 on the 1440px-wide Small Forest map, then upgrades on
  sufficiently large maps without losing the saved choice. Unknown coverage
  uses classic mode; no terrain is invented beyond authored extents.
- **Fullscreen** (or F11 while the game page owns input) enters/exits the
  game container; logical coordinates remain separate from CSS size and DPR.
  Numeric DPR changes are also detected when the browser emits no resolution
  media-query event; fitting is change-only, not repeated layout every frame.
- NPC dialogs own movement/attack/hotkeys while open. Previously held
  actions release on dialog entry or blur. End/Escape cancel; Back follows
  the server's navigation flags. Text keeps its server default; number
  validation reports bounds instead of sending the wrong string packet.
  Style selection sends its byte-sized option index.
- Character selection requests an explicit masked PIC rather than silently
  submitting a fixed value. Creating a PIC requires matching confirmation;
  rejection reopens the prompt without credential logging.
- Status/chat controls use their real asset bounds. The baked quickslot grid
  reflows within the viewport but remains decorative: interactive quickslot
  bindings are a separate parity gap, not newly implemented here.
- Quiz6/speed-quiz7 layouts are explicitly unsupported, not misread as a style
  picker. These changes do not certify shops, combat, advanced jobs, PQs,
  bosses, native cash-shop windows, or mobile/touch support.

### Reconstructable source and checks

The engine stays pinned to public submodule commit
`8eece1d1fc43afa48e12df56b4719ca63af88e0b`. Apply repository-owned patches in order:
`web-client/patches/remote-movement.patch`,
`web-client/patches/deployed-npc-chat.patch`,
`web-client/patches/browser-modernization.patch`.
The second patch preserves the three deployed user files: `UIChatBar.cpp`,
`UINpcTalk.cpp`, and `NpcInteractionHandlers.cpp`; the final patch makes the
bounded changes on top. No private gitlink or remote dirty directory is needed.
The Dockerfile uses the same pinned emsdk image digest as the movement build.

The preserved user patch SHA256 is
`011fcc2d778bccdec71452e99fc884e5c57ddc385aac9c22acd661299250b9cb`,
matching the prior deployed manifest. Frozen modernization source patch
SHA256 is `a9ab5a1687722a135953d0a12e10658084c7d673e6726869f50fe3be624585d8`;
its shell SHA256 is
`f8f5a128328ab81bb5ed2426617c93b35f1b0a0f5d1c75056a45d7c05a44fe8d`.
These identify the final owned source; DEV deployment and exercised evidence follow below.

Run `cd web-client && python3 -m unittest test_modernization test_movement test_routing -v`.
This command passed **5 tests** in 8.586 seconds against the reconstructed
patch stack. Modernization runs four real native executables: NPC parser/state/
wire and held-input ownership; viewport/map-extent/camera/HUD geometry; PIC state/
wire; and movement parsing against the complete three-patch stack. The unchanged
movement baseline and three HTTP/WS/NX routing contracts also pass. Both
movement runs' uniform 50 ms streams retained maximum
hold 0 ms and final X 299.64. Initial native compilation exposed eager Session
singleton linkage in the serializer and three legacy narrow arithmetic
conversions; dispatch now lives with Session transport and those conversions
are explicit, without packet-API changes or diagnostic suppression.
Native tests are not a substitute for actual WASM/browser acceptance. Build and deployment
records must identify the candidate source, patch hashes, shell, coordinated
JS/WASM pair, and rollback directory. Only DEV at `/opt/buns-dev` / port 8081
may receive the candidate. A rollback restores the whole shell/build snapshot,
never an individual JS or WASM file. Production `/opt/buns/web-client` / port
8080 remains untouched until separately approved.

### Current DEV deployment and recorded evidence

DEV serves source-content hash
`5874e6cacda35541a99cc3aa4c7874d9f4c14c69edd61bd77e76fe57e8348962`,
rebuilt from a clean pinned engine and the three patches above. The isolated
emsdk Release build passed in 154.23 seconds. Current assets are:

| DEV asset | SHA256 |
| --- | --- |
| `JourneyClient.js` | `292f2e5b38ffb31477b107c4af8342e91eb2ed1abb84c7ae01a8d3c87429481c` |
| `JourneyClient.wasm` | `90a9a30870f98ab0340b06fbd160b3210c7531e4f1e33a6bb5bb1d266e24f531` |

The durable source/build/native-test/deployment record is
`.164:/opt/buns-dev/browser-modernization-build-manifest.json`; its deployment
audit is `/opt/buns-dev/browser-modernization-deployment.json`, and reconstructed
patches are retained in `/opt/buns-dev/browser-modernization-source/`.
No service, Java, database, gateway, routing, or NX changes were made.
Production shell `dab75e59e39fecd1aaa1b03639769d02cc71672639a4d0e8da282714c6a0afdd`
and production JS `98ff3048…` / WASM `9a099050…` remain unchanged.

The **stable default rollback** is the pre-modernization whole root
`/opt/buns-dev.before-browser-modernization-20261015T021459Z`: original DEV
shell `d0702fda0e72e34eeee2c502e5040f9c5bd2bd0d79a8b17a1892f4a50528b3c4`
and verified movement JS `98ff3048…` / WASM `9a099050…`.
`/opt/buns-dev.before-browser-modernization-20261015T024925Z` is merely the
immediate previous **17e intermediate**, not that stable baseline. The other
intermediate snapshots ending `021917Z` and `022813Z` are also retained.
The guarded durable command is:
`ssh root@192.168.0.164 '/usr/bin/python3 /opt/buns-dev/browser-modernization-source/rollback_dev.py --authorize-dev-rollback'`.
No rollback was executed. Swap the whole root, never separate JS/WASM files.
Fixed asset URLs do not guarantee cross-request session atomicity during a swap;
hard-refresh to load the coordinated current shell/pair.

Recorded browser evidence is deliberately separated by candidate and source path:
Browser checks use one managed desktop Chromium session; DPR 1/2 are CDP-emulated
and recorded from actual `window.devicePixelRatio`, not inferred from a screenshot.
They are not physical-retina, Firefox/Safari/Edge, mobile, or Windows-client certification.
- The unchanged NPC/input/PIC paths were exercised in the 17e candidate:
  live Heena Yes/No/End/Escape/Next, held Right → modal → release → close,
  real canvas blur → release outside → refocus, six logical-mode/DPR combinations,
  and window/fullscreen enter/settle/exit geometry. All 24 geometry states matched
  rounded CSS × DPR; twelve actual dialog clicks emitted `03012a000000`.
- Controlled encrypted packets entered the original Emscripten callback and real
  C++ parser/UI/serializer. Number min/default/max/custom, malformed/overflow
  rejection and correction, text default/edit/empty, two style indices, cancel,
  navigation, 32-item menu scrolling and reopen were exercised. Every synthetic
  positive response was transport-blocked, not sent to shared-server scripts.
- Actual CHARLIST `require_pic=1` produced the normal explicit masked prompt
  despite `ENABLE_PIC=false`. Wrong-PIC opcode 28, missing-PIC registration/
  mismatch/matching confirmation and deletion branches used controlled real
  ingress with blocked transport; they are **not live-server transaction proof**.
- Final 5874 corrects the observed startup crop, centered-pregame presentation,
  finite-art overscan and 1366px HUD clipping. Small Forest's actual VR width
  is 1440; 1280×720 is clean, while 1920 exceeded authored coverage. Tile/object
  drawing has no old-800 culling loop; background tiling and graphics clipping
  already use runtime dimensions. No terrain or background paint was invented.
- Actual ordinary portals reached map 1000000 (Amherst, VR 2700×1353) from
  40000 via 50000, upgrading to real 1920×1080 with the requested choice intact.
  Final DPR-only changes also matched backing resolution with zero media-query
  notifications, without changing mode or viewport geometry.
  The normal west portal returned to 50000 and automatically downgraded to
  1280×720 without losing requested 1920. All six final fullscreen mode/DPR
  cases opened the actual Skill Inventory through its visible HUD button.
  A normal world reload restored centered 800×600 pregame, not an asserted
  in-app logout feature. No runtime console error, WASM abort, or non-HEAD
  failed request was observed; final public production shell/JS/WASM hashes
  independently matched the original baseline.

The accepted, candidate-attributed browser summary is retained durably as
`.164:/opt/buns-dev/browser-modernization-browser-acceptance.json`.
Known limits remain: NPC menu ArrowDown/Enter selection is not implemented;
Menu/System/Trade/CashShop artwork without original handlers is not a working
settings/shop feature; quickslots are decorative. Skill Inventory active/
inactive clamping and a Skill Tooltip edge were exercised, not every window
family or an active-buff panel. The short Amherst edge lies within real VR
and is authored artwork, not newly invented terrain or pixel-perfect native parity.

Ephemeral QA artifacts are under `/tmp/browser-modernization-qa/`, notably
`summary.json`, `final-fixture-results.json`, `final-viewport-matrix.json`,
`pic-results.json`, `responsive-dpr-transition.json`,
`responsive-small-forest-request1920.png`,
`responsive-true1920-normal-map-upgrade.png`,
`responsive-normal-return-auto-downgrade.png`, and
`responsive-final-centered-pregame-after-world-reload.png`.
`responsive-normal-portal-roundtrip.webm` is actual final-5874 canvas footage
of live travel, wider town, fullscreen/HUD interactions and normal return.
`final-real-engine-fixtures.webm` is actual 17e fixture footage; neither is a
fabricated canvas or native/cross-browser parity claim. Isolated QA tabs and
recording streams were closed; no active fixture instrumentation or credentials
remain in retained evidence.


### Functional parity target and evidence

Kaentake v3.4.1 is the **reference target**, not a certified tested golden
client. Its staged Windows EXE/DLL/Custom.wz trial has no Windows/Wine smoke;
native observations remain pending. Upstream has no declared redistribution
license, so this browser work does not re-upload those binaries. Functional
parity means observable protocol/gameplay/UI behavior, not binary or renderer
identity. Browser acceptance does not wait on unavailable Windows hardware.

| Area / expected v83 contract | Journey source presence or known gap | Historical browser evidence (before modernization) | Actual Kaentake observations |
| --- | --- | --- | --- |
| Login / PIC | Account, world/channel, character entry; explicit masked PIC, registration confirmation, wrong-PIC handling. Actual CHARLIST emits `require_pic=1` despite server `ENABLE_PIC=false`; the normal prompt is therefore expected | Disposable account login and existing character reached tutorial world; earlier audit did not certify PIC prompt/register/rejection/deletion | Pending |
| NPC dialogue | Text/menu/yes-no/text/number/style, server-specific packet layouts and cancellation are this iteration's hardening scope | Heena dialogue rendered; pre-change No/End response failure after fullscreen is recorded, not a pass | Pending |
| Inventory / equipment | Move/drop/equip/unequip/use/gather/sort/pickup requests with server v83 read-order layouts; MODIFY/GATHER/SORT/CHANGE_STATS handlers; client equip-requirement pre-gate mirrors server canWearEquipment + tooltip job bands (inventory-equipment.patch; native test_inventory_equipment: parser strides/request layouts/gate matrix) | Native seams only; no live mutation/persistence certification in this slice | Pending |
| NPC shops / storage | Shop open/buy/sell/recharge + CONFIRM_SHOP_TRANSACTION result notices; storage open/deposit/withdraw/meso/sort with exact server strides (shop-storage.patch; native test_shop_storage: parser/state/serialized-payload seams) | Native seams only; no live transaction/persistence certification in this slice | Pending |
| Jobs / combat / buffs | Explorer/Aran job names, attack and buff paths present; extended-job stat assumptions and Flash Jump gap remain; damage is int32 | Beginner skill window opened only; no advanced-job/combat parity certification | Pending |
| Party / PQ | Party invite/join/leave/leader/HP present; clock, party doors and several PQ-specific handlers missing | Not exercised | Pending |
| Bosses / summons / statuses | Ongoing monster status/damage, mist, summons and door coverage have explicit gaps | Not exercised | Pending |
| Cash shop / native custom UI | Native bundles depend on Windows hooks; Journey does not implement those custom windows | Not exercised / no support claim | Pending |
| Desktop viewport / input | Existing renderer and runtime camera/UI seams extended by this iteration; classic mode retained | Pre-change 800x600 CSS scaling only; arrows/jump worked; NPC modal leak observed | Pending |
| HUD / quickslots | Stats/Inventory/Equip/Skill actions exist. Other button artwork can react visually without an implemented action (including Menu/System); the baked grid has no interactive quickslot implementation | HUD rendered; decorative slots and unimplemented actions were not certified as working controls | Pending |

Next slices are selected from observed gaps after this iteration's DEV proof:
first missing HUD/menu/settings/quickslot behavior and inventory/equipment/shop/storage transaction/persistence coverage;
then bounded Explorer combat/buff and party/PQ/boss routes with packet fixtures,
followed by explicitly chosen job mechanics. Native cash-shop/custom features
need capability-selected protocol/UI design, not injected Windows hooks.
Any future 64-bit native damage encoding must be negotiated per session and
serialized per recipient; existing browser int32 packets cannot be reinterpreted.
Mobile/touch, composition/IME input, a renderer rewrite, and automatic full-NX
prefetch are outside this desktop iteration. Candidate/browser acceptance,
including synthetic versus live paths, is recorded separately from source
presence; no table entry implies unexercised functionality works.


## Testing RC checkpoint — 2026-10-16 (not production rollout)

- Full accepted hard/normal/Magnus source, progression, drops/cards and native
  intake are integrated; missing-asset/native-engine/family acceptance is still
  held. No accepted family is silently deferred or replaced by a stock release.
- Server checkpoint `1f93de5` fixes the real weak-map HP scheduling race while
  retaining weak keys. Actual3188-background/eight-factory-bot runtime exercised
  640 map transitions/80 HP callbacks, correct400 hazard/zero safe-map damage.
  This is not bot expedition/combat proof; those actual controller paths remain open.
- Maker's real public opcode/material/cost/natural-failure/relog gate passed.
  The provided sanitized pre-upgrade snapshot plus owned inventory/price rows
  passed real40→51 migrations, idempotence and exact pre-backup restoration.
- Deployment checkpoint `6d6e264` cleanly uses installed curl for immutable HTTP
  transport. Actual canonical-HTTPS full4fe81 download/hash/extraction installed
  54658 exact XML payload files and started plain matched Java/GMS83 listeners in
  an isolated Linux Compose cohort, not a mock or a native/LAN qualification.
- HP-fixed backend seal `87179f72` contains exact JAR3745211c and all932 authored
  data files before Java startup; source/URLs/full hashes are in the single
  coordination contract. No seal activates production. Frozen rc3/old artifacts
  remain preserved and unqualified; fresh native engine acceptance is mandatory.
- Exact native controls isolate the current pre-login failure to Item.wz, not a
  proved bad node. Its five-image/47-added-item delta is preserved in immutable
  internal diagnostics; no accepted content is cut. Fresh Windows MapleLib
  run38926333427 reports57 errors, including46 known consumed gaps and reader
  vector/walk limitations, not native-engine acceptance. The oracle now retains
  individual child failures while continuing siblings and checks exact vector
  coordinates; a fresh real Windows execution is required for those changes.
- Upstream review remains pinned16ab7b7/selective GROUPA0874223/GROUPB60b869c,
  not unrelated-history parity or new AI/voting/Flux/Tripo3D scope. Evan review
  remains complete REVIEW ONLY, not playable-class scope.

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
