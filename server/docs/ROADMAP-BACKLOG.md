# Roadmap backlog — PlayerBots+Augur fusion on `solobots`

Date: 2026-10-15. Base: `solobots`. Completed: opcode registry `f868346`,
launcher profiles `0af7a62`+`35099e0`, Kaentake compat GO, NX coverage.
In flight: press-mapping fix (`press-debug-lead`), daily check-in
(`daily-checkin-lead`). Cross-cutting blocker (decision, not a ticket):
Kaentake-style injector adopt-or-not gates ALL DLL-shaped client work
(prism, damage-cap, weather clients, daily check-in DLL window).
(GitHub Issues are OFF for this repo; this file is the tracker.)

- [ ] **Ticket 1 — Land press-mapping fix (CSS→logical Y-leg) + test_viewport probe** — Owner: unassigned
  Scope: Land ordered CSS→logical Y-leg fix + uncommitted `test_viewport.cpp`
  login-button roundtrip probe as committed coverage; re-run
  `test_modernization`/`test_movement`/`test_routing` native gates green.
  Web-client-only, zero server/Java/DB/WZ/opcode touch.
  Dependencies: None. Blocks: ticket 2, and browser-baseline testing for tickets 3/10.

- [ ] **Ticket 2 — Inventory/equipment acceptance + dev WASM promotion** — Owner: unassigned
  Scope: Dev-smoke WASM pair `31f9ca8a`/`090715ad` (inventory-equipment +
  shop-storage, PacketSwitch op 306, BuyState soldout fix); promote to prod
  pair only after dev smoke passes; rollback = whole-root swap, never
  single JS/WASM file. Verifies the browser baseline later features test on.
  Dependencies: Blocked by ticket 1. Blocks: ticket 3 ship, ticket 10 testing, ticket 15.

- [ ] **Ticket 3 — Daily check-in: server → window → WZ → ship** — Owner: unassigned
  Scope: Server handler + rewards + gm0 command, Liquibase port of
  `daily_checkin.sql`, opcode enum + PacketProcessor/Creator (registry range
  already reserved), tiny `UI.wz` fragment merge, client window (injector C++
  or browser UI per step-0 decision); ship end-to-end. In flight with
  `daily-checkin-lead`; proves the 5-half pipeline on reconciled seam files.
  Dependencies: Opcode registry done; server half unblocked; window half
  blocked on injector-or-browser-UI decision; ship blocked by ticket 1 + ticket 2 baseline.

- [ ] **Ticket 4 — Evan WZ merge review (data-only)** — Owner: unassigned
  Scope: Merge-review 45 XML (`String/Skill.img.xml`, `UI/Basic`+`UIWindow`
  16.9MB shared replaces); flatten `Skill/` vs `Skill/Dragon/` without
  collision. `Job.java` EVAN 2001/2200–2218 already declared; zero code.
  Parallel filler while injector question settles.
  Dependencies: None. Blocks: Evan completeness answer; informs ticket 15 manifest.

- [ ] **Ticket 5 — MapleRoot wave 1: shopupdate SQL** — Owner: unassigned
  Scope: Port `3-db_shopupdate.sql` (INSERT IGNORE, 3 shops + 318 rows) as
  Liquibase change; near-zero risk, no rates/packets/infra. First ranked
  MapleRoot slice; never bulk-port (rates, `USE_MTS`, multiclient/PIC,
  packet/exploit hunks, jedis/jackson, hardcoded Discord/admin SQL).
  Dependencies: None (needs prod-commit pin recorded before porting).

- [ ] **Ticket 6 — MapleRoot wave 2: Maker extraction** — Owner: unassigned
  Scope: Port `MakerService` + delegation delta; pure Java, no WZ/DB/client.
  Follows wave 1 in rank order; same never-bulk-port exclusions as ticket 5.
  Dependencies: None (ranked after ticket 5; unblocked server-only).

- [ ] **Ticket 7 — MapleRoot wave 3: buyback ledger** — Owner: unassigned
  Scope: +1 Liquibase table + `MAXIMUM_TRANSACTIONS_FOR_BUYBACK` port;
  server-only, no client/WZ. Ranked after Maker; same exclusions as ticket 5.
  Dependencies: None (ranked after ticket 6).

- [ ] **Ticket 8 — MapleRoot wave 4: QoL scripts (quicksell + search first)** — Owner: unassigned
  Scope: Port quicksell + search-first NPC scripts (buns already has
  WhatDrops/WhoDrops; skip duplicates); script-only, no Java/WZ/DB.
  Ranked after buyback; same exclusions as ticket 5.
  Dependencies: None (ranked after ticket 7).

- [ ] **Ticket 9 — MapleRoot wave 5: boss-pack expeditions** — Owner: unassigned
  Scope: +13 `ExpeditionType` + event scripts + registrar NPCs; map/mob WZ
  checks first, then BossLog/leaderboard, HyperTP handler, Rulax/Alcaster
  bundle, config flags per verdict. Largest MapleRoot slice; same
  exclusions as ticket 5.
  Dependencies: Blocked on map/mob WZ checks (NX coverage); ranked after ticket 8.

- [ ] **Ticket 10 — Cash-shop window** — Owner: unassigned
  Scope: New `server/cashshop/` classes + handler + `CASHSHOP_*`
  (0x145–0x14D exist), catalog tooling, `UI/CashShop.img` merge, client
  window (injector or browser UI per decision). Server half standalone.
  Dependencies: Blocked by ticket 1 + ticket 2 baseline and injector-or-browser-UI decision.

- [ ] **Ticket 11 — Coloring prism** — Owner: unassigned
  Scope: DB xml (12 cols) → server → opcodes `0x372E`/`0x372F` + item
  5782000 → `weapontint.cpp` hooks (`CAvatar::PrepareActionLayer 0x00453AD1`);
  merge (don't stack) with ImGui color-picker work. Registry reserved `f868346`.
  Dependencies: Blocked on injector-YES decision + ticket 14 smoke. Blocks: ticket 12.

- [ ] **Ticket 12 — Damage cap to long** — Owner: unassigned
  Scope: Client + server ship together (mob HP already `long`); SP hooks +
  Patch helpers, 2^53 saturation; desync risk if halves mismatch, so paired
  release only. Needs injector toolchain proven by ticket 11.
  Dependencies: Blocked by ticket 11 (hooks + injector proven).

- [ ] **Ticket 13 — Weather/time (LAST, highest cost)** — Owner: unassigned
  Scope: 15 new Java destinations (clean add) + 10 `.java.patch` hunks over
  bot-touched files + Effect/Sound.wz manifest gap + injector client;
  NightCommand merge-or-rename first; elemental-bonus stays optional.
  Do after every other feature.
  Dependencies: Blocked by NightCommand decision + injector toolchain (tickets 11/12
  proven) + Effect/Sound.wz story. Last in queue.

- [ ] **Ticket 14 — Kaentake client smoke (EXE/DLL/Custom.wz)** — Owner: unassigned
  Scope: Smoke staged Windows EXE/DLL/Custom.wz trial (Kaentake opt-in profile
  `0af7a62`+`35099e0` normally hosted); record pass/fail incl. Windows/Wine
  status; no behavior changes. Compat GO already recorded; this is the
  runtime proof the injector-based clients (tickets 11–13) build on.
  Dependencies: None (parallel). Blocks: ticket 11, ticket 12-client, ticket 13-client.

- [ ] **Ticket 15 — R2 uploads (NX/community pack)** — Owner: unassigned
  Scope: Inventory-then-fit TengaMS 4.9G / Community IMG 6.3G against WZ
  symlink + manifest + launcher hosting; upload settled NX set to R2;
  record hashes. Do not schedule content fit until WZ story settled.
  Dependencies: Blocked by ticket 2 (NX coverage baseline) + ticket 4 (Evan manifest
  answer); needs WZ symlink gap closed (no `/opt/cosmicms/wz` locally).

- [ ] **Ticket 16 — Linux/Wine spike** — Owner: unassigned
  Scope: Time-boxed spike: stock EXE and Kaentake EXE under Wine on Linux;
  record what runs (login/move/chat baseline), failures, and version pins;
  no fixes in this ticket — findings feed ticket 14 and client-work estimates.
  Parallel investigation, no build/deploy.
  Dependencies: None (parallel). Informs: ticket 14, tickets 11–13 estimates.

## Dependency graph (summary)

- 1 → 2 → (3 ship, 10 testing, 15).
- 4 parallel filler → informs 15.
- 5 → 6 → 7 → 8 → 9 (ranked server-only waves; 9 also needs WZ checks).
- Step-0 injector decision → 3 window, 10 window, 11 → 12 → 13 (last).
- 14 smoke → 11/12-client/13-client. 16 informs 14.
- 15 after 2 + 4 + WZ story settled.
