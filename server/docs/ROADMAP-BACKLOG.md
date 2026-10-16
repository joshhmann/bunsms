# Roadmap backlog — PlayerBots+Augur fusion on `solobots`

Date: 2026-10-15. Base: `solobots`. Completed: opcode registry `f868346`,
launcher profiles `0af7a62`+`35099e0`, Kaentake compat GO, NX coverage.
In flight: press-mapping fix (`press-debug-lead`), daily check-in
(`daily-checkin-lead`). Cross-cutting blocker (decision, not a ticket):
Kaentake-style injector adopt-or-not gates ALL DLL-shaped client work
(prism, damage-cap, weather clients, daily check-in DLL window).
(GitHub Issues are OFF for this repo; this file is the tracker.)

- [x] **Ticket 1 — Browser pointer input proven; false press-mapping bug closed (no fix was necessary)** — Owner: press-debug-lead (done)
  Evidence: durable `/tmp/shared/pointer-proof/browser-pointer-proof.json` (parent-viewed world-select + char-select images; trusted Login→Go transitions). Scope: viewport, DPR 1.25; native viewport tests only, no inventory/parity claim. Served bytes pre-b8bfc93 (31f9ca8a/090715ad); b8bfc93 hardening reverted separately (cleanup-press-mapping-noop 46dfd6c). The alleged CSS→logical Y-leg defect was a false diagnosis — backlog records proof, not a mapping fix.

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

- [x] **Ticket 4 — Evan WZ merge review + playable prerequisites (REVIEW ONLY)** — Owner: WZ integration
  Evidence: [durable per-file review](EVAN-WZ-REVIEW.md) and its linked full SHA256 manifest.
  All 45 XML reviewed: 29 safe additions, 13 collisions, 3 shared files forbidden
  from wholesale replacement. Keep `Skill/Dragon/` separate; flattening would overwrite
  same-numbered skill books. Creation/packet/skill/action/dragon prerequisites recorded.
  No Evan assets merged, no playable class claimed. Informs ticket 15 asset manifest only.

- [ ] **Ticket 5 — MapleRoot wave 1: shopupdate SQL** — Owner: unassigned — server-half [x] (landed)
  Scope: Port `3-db_shopupdate.sql` (INSERT IGNORE, 3 shops + 318 rows) as
  Liquibase change; near-zero risk, no rates/packets/infra. First ranked
  MapleRoot slice; never bulk-port (rates, `USE_MTS`, multiclient/PIC,
  packet/exploit hunks, jedis/jackson, hardcoded Discord/admin SQL).
  Dependencies: None (needs prod-commit pin recorded before porting).

- [ ] **Ticket 6 — MapleRoot wave 2: Maker extraction** — Owner: unassigned — server-half [x] (landed)
  Scope: Port `MakerService` + delegation delta; pure Java, no WZ/DB/client.
  Follows wave 1 in rank order; same never-bulk-port exclusions as ticket 5.
  Dependencies: None (ranked after ticket 5; unblocked server-only).

- [ ] **Ticket 7 — MapleRoot wave 3: buyback ledger** — Owner: unassigned — server-half [x] (landed)
  Scope: +1 Liquibase table + `MAXIMUM_TRANSACTIONS_FOR_BUYBACK` port;
  server-only, no client/WZ. Ranked after Maker; same exclusions as ticket 5.
  Dependencies: None (ranked after ticket 6).

- [ ] **Ticket 8 — MapleRoot wave 4: QoL scripts (quicksell + search first)** — Owner: unassigned — server-half [partial] (quicksell landed per `2b1d966`; search pending — search.js skipped, NPC 1032009 taken, needs own ticket or explicit WONTFIX)
  Scope: Port quicksell + search-first NPC scripts (buns already has
  WhatDrops/WhoDrops; skip duplicates); script-only, no Java/WZ/DB.
  Ranked after buyback; same exclusions as ticket 5.
  Dependencies: None (ranked after ticket 7).

- [ ] **Ticket 9 — MapleRoot wave 5: boss-pack expeditions (FULL scope: all accepted families, not Wave 0 alone)** — Owner: expedition-content-waves — server-half [partial, NOT runtime accepted] (existing DKBONUS1/YOSHIJQ + genuine Castellan retained; source-backed BossLog/leaderboard persistence and migration 032, Krexel ordinary transport/registrar/event/exit, and three Alcaster/Rulax consumer fixes implemented on the isolated content branch; Maven packaging only, no booted lifecycle proof yet; all remaining accepted-family scripts, guarded drop/card migration 033 and full player progression remain unfinished; unused MAGNUS/LOTUS enum ladders remain unimplemented)
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
  The staged first-family asset contract is not runtime acceptance. Do not mark
  this ticket complete before normal GM0 entry, genuine phases/kill callbacks,
  rewards, stored results after relog and failure cleanup are actually exercised.
  Dependencies: Blocked on map/mob WZ checks (NX coverage); ranked after ticket 8.

- [ ] **Ticket 10 — Cash-shop window** — Owner: unassigned — server-half [x] (landed; WZ merge + client window pending)
  Scope: New `server/cashshop/` classes + handler + `CASHSHOP_*`
  (0x145–0x14D exist), catalog tooling, `UI/CashShop.img` merge, client
  window (injector or browser UI per decision). Server half standalone.
  Dependencies: Blocked by ticket 1 + ticket 2 baseline and injector-or-browser-UI decision.

- [ ] **Ticket 11 — Coloring prism** — Owner: unassigned — server-half [x] (landed; injector hooks pending)
  Scope: DB xml (12 cols) → server → opcodes `0x372E`/`0x372F` + item
  5782000 → `weapontint.cpp` hooks (`CAvatar::PrepareActionLayer 0x00453AD1`);
  merge (don't stack) with ImGui color-picker work. Registry reserved `f868346`.
  Dependencies: Blocked on injector-YES decision + ticket 14 smoke. Blocks: ticket 12.

- [ ] **Ticket 12 — Damage cap to long** — Owner: unassigned — server-half [x] (landed; paired client release pending)
  Scope: Client + server ship together (mob HP already `long`); SP hooks +
  Patch helpers, 2^53 saturation; desync risk if halves mismatch, so paired
  release only. Needs injector toolchain proven by ticket 11.
  Dependencies: Blocked by ticket 11 (hooks + injector proven).

- [ ] **Ticket 13 — Weather/time (LAST, highest cost)** — Owner: unassigned — server-half [x] (landed; NightCommand decision + injector client pending)
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

- [ ] **Ticket 15 — Verified selfhost content intake (NX/community pack)** — Owner: unassigned
  Scope: Inventory-then-fit TengaMS 4.9G / Community IMG 6.3G against WZ
  symlink + manifest + launcher hosting; settled NX set stages to the
  self-hosted asset dir (ticket 17 replaced R2); record hashes. Do not
  schedule content fit until WZ story settled. STAYS OPEN until full native
  requirements + final triple/DLL decisions land (hosting ready, content
  pending — no 'all tickets complete' claim from cutover).
  Dependencies: Blocked by ticket 2 (NX coverage baseline) + ticket 4 (Evan manifest
  answer); needs WZ symlink gap closed (no `/opt/cosmicms/wz` locally).

- [ ] **Ticket 16 — Linux/Wine spike** — Owner: unassigned
  Scope: Time-boxed spike: stock EXE and Kaentake EXE under Wine on Linux;
  record what runs (login/move/chat baseline), failures, and version pins;
  no fixes in this ticket — findings feed ticket 14 and client-work estimates.
  Parallel investigation, no build/deploy.
  Dependencies: None (parallel). Informs: ticket 14, tickets 11–13 estimates.

- [ ] **Ticket 17 — Self-hosted asset serving and atomic publication** — Owner: selfhost-publication-review (source); selfhost-assets-spec (operations)
  Source repair branch: `selfhost-assets-repair`, based on frozen `faa818c`.
  The accepted `de4d851` fixed review remains changes-requested; old throwaway
  cycle counts and manual byte-copy rollback do not close its findings.
  Repair implements one verified immutable object/retained-manifest boundary,
  stock-default/private-complete profiles, authenticated streaming upload/CLI,
  all art/GM/raw-WZ/four publisher callers, actual pinned WZ→NX I/O and a
  committed complete NX authority, server tar/marker/baseline application, and
  exact retained overlay rollback with persistent pending recovery.
  Source-compose/systemd/CI/runbook parity is part of the repair, not a manual
  substitute for a missing API. Isolated actual-handler/SQL/byte-service,
  CLI/GM, real converter/cohort, and actual-entrypoint checks are permanent.
  Final fixed-commit independent review and gated service/content activation
  are distinct from the previous live read-serving receipt.
  Network contract is final: existing domains/ports, canonical advertised
  production client host `buns.asslorde.com`, explicit LAN/loopback overrides,
  no Tailscale/NAT changes. Public native activation deferred by owner.
  Internal Docker `server` is health only, never a client endpoint.
  Original R2 objects are retained but never used as runtime/rollback fallback.
  See [SELFHOST-ASSETS.md](SELFHOST-ASSETS.md) for the protocol and evidence
  boundaries. Ticket 15/content and native/browser activation retain their
  separate owner gates; this ticket does not claim all roadmap work complete.

## Dependency graph (summary)

- 1 → 2 → (3 ship, 10 testing, 15).
- 4 parallel filler → informs 15.
- 5 → 6 → 7 → 8 → 9 (ranked server-only waves; 9 also needs WZ checks).
- Step-0 injector decision → 3 window, 10 window, 11 → 12 → 13 (last).
- 14 smoke → 11/12-client/13-client. 16 informs 14.
- 15 after 2 + 4 + WZ story settled.
- 17 source/activation gates precede downstream publication for 3/4/9/11–13; all use the verified selfhost authority, never direct-live/R2 paths.
