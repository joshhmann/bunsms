# Roadmap backlog — PlayerBots+Augur fusion on `solobots`

Date: 2026-10-16. Required delivery is **all accepted content/addons/fixes together
in a Windows TESTING RC with a matching full-content test server**, not a reduced
stock baseline. [CURRENT-STATE.md](CURRENT-STATE.md) records exact source,
artifacts, exercised evidence and holds. Only full-content-server and
full-content-windows are active; old worker names are historical. Browser and
Linux/Wine are PARKED, not completed and not Windows runtime gates. Existing
production Java/DB/browser/NX remain unchanged until explicit verified rollout.
The backend retains its actual existing Linux deployment method; Windows backend
execution is a temporary CI harness only. GitHub Issues remain OFF.

Upstream review is pinned16ab7b7, unrelated histories: selective picks, not rebase.
Preserve GROUPA0874223/GROUPB60b869c; historical236 is not a latest436-behind claim.
No AI-GM/voting/Flux/Tripo3D/new-product parity is added. Evan remains REVIEW ONLY.
No accepted full-content item is USERDEFERRED. Source/test counts do not close
ordinary-player, bot, native-visual or lifecycle acceptance.

- [x] **Ticket 1 — Browser pointer input proven; false press-mapping bug closed (no fix was necessary)** — Owner: press-debug-lead (done)
  Evidence: durable `/tmp/shared/pointer-proof/browser-pointer-proof.json` (parent-viewed world-select + char-select images; trusted Login→Go transitions). Scope: viewport, DPR 1.25; native viewport tests only, no inventory/parity claim. Served bytes pre-b8bfc93 (31f9ca8a/090715ad); b8bfc93 hardening reverted separately (cleanup-press-mapping-noop 46dfd6c). The alleged CSS→logical Y-leg defect was a false diagnosis — backlog records proof, not a mapping fix.

- [ ] **Ticket 2 — Inventory/equipment acceptance + dev WASM promotion** — PARKED browser track
  Scope: Dev-smoke WASM pair `31f9ca8a`/`090715ad` (inventory-equipment +
  shop-storage, PacketSwitch op 306, BuyState soldout fix); promote to prod
  pair only after dev smoke passes; rollback = whole-root swap, never
  single JS/WASM file. Verifies the browser baseline later features test on.
  Dependencies: retained browser-track work only; not a Windows RC prerequisite.

- [ ] **Ticket 3 — Daily check-in: server → window → WZ → ship** — server integrated; paired native compiled; actual ACK/window/reward/relog acceptance pending
  Scope: Server handler + rewards + gm0 command, Liquibase port of
  `daily_checkin.sql`, opcode enum + PacketProcessor/Creator (registry range
  already reserved), tiny `UI.wz` fragment merge, client window (injector C++
  or the accepted paired native client); ship end-to-end. Native build success
  is not ordinary-player window/reward/relog proof.
  Dependencies: opcode registry/injector choice resolved; actual paired Windows
  negotiation and feature acceptance required, not parked browser promotion.

- [x] **Ticket 4 — Evan WZ merge review + playable prerequisites (REVIEW ONLY)** — Owner: WZ integration
  Evidence: [durable per-file review](EVAN-WZ-REVIEW.md) and its linked full SHA256 manifest.
  All 45 XML reviewed: 29 safe additions, 13 collisions, 3 shared files forbidden
  from wholesale replacement. Keep `Skill/Dragon/` separate; flattening would overwrite
  same-numbered skill books. Creation/packet/skill/action/dragon prerequisites recorded.
  No Evan assets merged, no playable class claimed. Informs ticket 15 asset manifest only.

- [x] **Ticket 5 — MapleRoot wave 1: shopupdate SQL** — integrated; actual172 per-pair/custom-row/idempotence and8074 NPC shop paths accepted
  Scope: Port `3-db_shopupdate.sql` (INSERT IGNORE, 3 shops + 318 rows) as
  Liquibase change; near-zero risk, no rates/packets/infra. First ranked
  MapleRoot slice; never bulk-port (rates, `USE_MTS`, multiclient/PIC,
  packet/exploit hunks, jedis/jackson, hardcoded Discord/admin SQL).
  Evidence: recovered real MySQL per-pair repair and actual NPC conversation/shop tests; parent accepted. Full item/native catalog qualification remains ticket15.

- [x] **Ticket 6 — MapleRoot wave 2: Maker extraction** — pure extraction integrated; real public opcode113 materials/cost/output/natural failure and ordinary disconnect/save/reload PASS on matching full-content Linux/MySQL fixture. Receipt: `/tmp/buns-full-content-private/linux-runtime-20261016-062756/maker-acceptance.json`; no RNG override or native-UI claim.
  Scope: Port `MakerService` + delegation delta; pure Java, no WZ/DB/client.
  Follows wave 1 in rank order; same never-bulk-port exclusions as ticket 5.
  Dependencies: None (ranked after ticket 5; unblocked server-only).

- [ ] **Ticket 7 — MapleRoot wave 3: buyback ledger** — actual transactional economy seams green; combined ordinary-player persistence/relog acceptance pending
  Scope: +1 Liquibase table + `MAXIMUM_TRANSACTIONS_FOR_BUYBACK` port;
  server-only, no client/WZ. Ranked after Maker; same exclusions as ticket 5.
  Dependencies: None (ranked after ticket 6).

- [ ] **Ticket 8 — MapleRoot wave 4: QoL scripts (quicksell + search first)** — both scripts integrated; quicksell seam green; ordinary search/persistence acceptance pending, not WONTFIX/new-ticket
  Scope: Port quicksell + search-first NPC scripts (buns already has
  WhatDrops/WhoDrops; skip duplicates); script-only, no Java/WZ/DB.
  Ranked after buyback; same exclusions as ticket 5.
  Dependencies: None (ranked after ticket 7).

- [ ] **Ticket 9 — MapleRoot wave 5: boss-pack expeditions (FULL scope: all accepted families, not Wave 0 alone)** — remaining family/registrar/progression source plus033/034 and complete native/XML candidate integrated; NOT runtime accepted; family/bot/visual consumers pending
  Scope per ticket: +13 `ExpeditionType` + event scripts + registrar NPCs; map/mob WZ
  checks first, then BossLog/leaderboard, HyperTP handler, Rulax/Alcaster
  bundle, config flags per verdict. Wave-0-only + enum additions do NOT complete
  this ticket. Largest MapleRoot slice; same exclusions as ticket 5.
  ARIANT family + bots/FM/casino/rates preserved throughout. If a family is
  actually unavailable, implement the reachable parts and name the exact missing
  real prerequisite — no placeholder/fake completion. Server R12 acceptance
  exercises the genuine event lifecycle + ordinary player entry route, not
  syntax/enum counts.
  New-family quotas retain MapleRoot's actual limits while the existing stock-five
  daily-limit flag remains unchanged. Source origin: `MapleRoot Full Repack.zip`,
  `Server/scripts/` and `Server/src/main/java/server/expeditions/`; persistence
  schema comes only from `Database/CLEANDB.sql`, never its accounts/admin data.
  The complete candidate is not runtime acceptance:46 MISSING and five bounded
  UNCONSUMED references remain machine-recorded. A native null guard does not
  classify missing effects as cosmetic. Require genuine ordinary GM0 phases,
  rewards/relog/failure cleanup and bounded real bots-ON party/expedition
  combat/drop/clear/leave behavior wherever existing bot capabilities apply.
  Six human GM0 fixtures are not bot proof; preserve GM4 exclusion and bot cap0.
  Dependencies: matching full native/XML, fresh reader/catalog and actual
  lifecycle/visual/bot evidence, not parked browser GUI development.

- [ ] **Ticket 10 — Cash-shop window** — server integrated; paired native compiled; actual catalog/window/purchase/relog acceptance pending
  Scope: New `server/cashshop/` classes + handler + `CASHSHOP_*`
  (0x145–0x14D exist), catalog tooling, `UI/CashShop.img` merge, client
  window (injector or browser UI per decision). Server half standalone.
  Dependencies: actual paired native negotiation/catalog/window acceptance; no parked browser baseline gate.

- [ ] **Ticket 11 — Coloring prism** — server remote-owner delivery, zero-count clear and legacy-owner disconnect/save/reload exercised through real production handlers and raw outbound fixture capture (not v83 AES/account login/native wire); paired native compiled; actual native tint/observer/relog acceptance pending
  Scope: DB xml (12 cols) → server → opcodes `0x372E`/`0x372F` + item
  5782000 → `weapontint.cpp` hooks (`CAvatar::PrepareActionLayer 0x00453AD1`);
  merge (don't stack) with ImGui color-picker work. Registry reserved `f868346`.
  Dependencies: actual paired native smoke/feature behavior. Blocks paired ticket12 acceptance.

- [ ] **Ticket 12 — Damage cap to long** — Owner: unassigned — server-half [x] (landed; paired client release pending)
  Scope: Client + server ship together (mob HP already `long`); SP hooks +
  Patch helpers, 2^53 saturation; desync risk if halves mismatch, so paired
  release only. Needs injector toolchain proven by ticket 11.
  Dependencies: Blocked by ticket 11 (hooks + injector proven).

- [ ] **Ticket 13 — Weather/time (LAST, highest cost)** — server and paired weather/lamps native compiled; actual native acceptance pending; weather gameplay independently default-off
  Scope: 15 new Java destinations (clean add) + 10 `.java.patch` hunks over
  bot-touched files + Effect/Sound.wz manifest gap + injector client;
  NightCommand merge-or-rename first; elemental-bonus stays optional.
  Do after every other feature.
  Dependencies: paired native feature/runtime proof and exact Effect/Sound source
  disposition; consumed missing effects require actual visual classification.

- [ ] **Ticket 14 — Kaentake client smoke (EXE/DLL/Custom.wz)** — full-content-windows; actual ACK/login/world/feature acceptance pending
  Scope: Smoke staged Windows EXE/DLL/Custom.wz trial (Kaentake opt-in profile
  `0af7a62`+`35099e0` normally hosted); record pass/fail incl. Windows/Wine
  status; no behavior changes. Compat GO already recorded; this is the
  runtime proof the injector-based clients (tickets 11–13) build on.
  Dependencies: None (parallel). Blocks: ticket 11, ticket 12-client, ticket 13-client.

- [ ] **Ticket 15 — Verified selfhost content intake (NX/community pack)** — full51/17WZ and matching54659-file XML candidate assembled; fresh native/catalog/profile acceptance pending
  Scope: Inventory-then-fit TengaMS 4.9G / Community IMG 6.3G against WZ
  symlink + manifest + launcher hosting; settled NX set stages to the
  self-hosted asset dir (ticket 17 replaced R2); record hashes. Do not
  schedule indiscriminate whole-archive/Drive imports. STAYS OPEN until the exact
  full native catalog plus paired Kae/Buns/Custom/config/CRT9 and matching XML,
  JAR/tar are frozen and actually validated. Preserve MISSING/UNCONSUMED records
  and review-only Evan scope; do not claim full asset coverage.
  Dependencies: fresh genuine Windows reader/item-catalog and gameplay evidence
  for this hash set. Retained NX functionality is not a new browser runtime gate.

- [ ] **Ticket 16 — Linux/Wine spike** — PARKED; checkpoint/findings preserved, not a Windows RC gate
  Scope: Time-boxed spike: stock EXE and Kaentake EXE under Wine on Linux;
  record what runs (login/move/chat baseline), failures, and version pins;
  no fixes in this ticket — findings feed ticket 14 and client-work estimates.
  Parallel investigation, no build/deploy.
  Dependencies: None (parallel). Informs: ticket 14, tickets 11–13 estimates.

- [ ] **Ticket 17 — Self-hosted asset serving and atomic publication** — full-content-server
  True ancestry9396e2c plus recovered native-catalog/NX-cohort work integrated.
  Failedfaa818c is not deployable. Current publisher/control checks22 pass;
  actual Node20/public HTTPS gzip GET/HEAD/Range/common-publisher rollback proven.
  Repair implements one verified immutable object/retained-manifest boundary,
  stock-default/private-complete profiles, authenticated streaming upload/CLI,
  all art/GM/raw-WZ/four publisher callers, actual pinned WZ→NX I/O and a
  committed complete NX authority, server tar/marker/baseline application, and
  exact retained overlay rollback with persistent pending recovery.
  Source-compose/systemd/CI/runbook parity is part of the repair, not a manual
  substitute for a missing API. Final hash-set handler/SQL/byte-service,
  producer/cohort and entrypoint acceptance remain required. New read-only
  TESTING CAS `/rc-assets/` leaves production Java/DB/browser/NX unchanged.
  Generic binary tar headers are fixed; a `.bin` bootstrap alias alone is not final.
  Network contract is final: existing domains/ports, canonical advertised
  production client host `buns.asslorde.com`, explicit LAN/loopback overrides,
  no Tailscale/NAT changes. Public native activation deferred by owner.
  Internal Docker `server` is health only, never a client endpoint.
  Original R2 objects are retained but never used as runtime/rollback fallback.
  See [SELFHOST-ASSETS.md](SELFHOST-ASSETS.md) for the protocol and evidence
  boundaries. Ticket 15/content and native/browser activation retain their
  separate owner gates; this ticket does not claim all roadmap work complete.

## Dependency graph (summary)

- Browser2 and Linux/Wine16 are parked, not Windows RC prerequisites.
- Evan4 REVIEW ONLY is complete and constrains intake, not a playable class.
- 5→6→7→8→9 remain accepted full-content slices, never baseline-first deferrals.
- Paired native3/10/11/12/13/14 need actual negotiation/gameplay/UI proof.
- 9 also needs ordinary/bot lifecycle and missing-art visual disposition.
- 15 needs exact native/XML/catalog/runtime pins and fresh actual reader proof.
- 17 needs common immutable publication/real-byte rollback; rollout is separate.
