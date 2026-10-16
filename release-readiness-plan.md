# Historical Release Readiness Plan v2 — superseded working plan
Owner: release-integration lead. Worktree: /tmp/buns-release-validation (branch release-integration @ b8bfc93). Shared tree /tmp/browser-modernization NEVER touched. Published early per parent request; all roadmap completion stays evidence-gated.
Constraints: prod .164 Java/DB unchanged; isolated DB/containers/ports only; no new prod opcodes without client contract (contract v1 ESTABLISHED with DLL lead — see §3). Own: server Java/SQL/scripts/tests/server-docs. NOT: launcher/dashboard/assets/client-DLL/web-viewport (other owners).

**Historical only:** this plan's b8bfc93 scout findings and proposed repair
queue are retained for provenance, not current source instructions or release
scope. The authoritative full accepted Windows/Linux RC state is
`server/docs/CURRENT-STATE.md` and `server/docs/ROADMAP-BACKLOG.md`. In particular,
long mob HP is integrated (not descaled), economy operations are atomic, shop172
uses per-pair guards without a global unique constraint, Maker public behavior
has passed, and no accepted full-content family is USERDEFERRED. Old DLL/suite
pins below do not qualify newer artifacts. Production remains unchanged.

## §1 File ownership (this workstream)
- net/server/channel/handlers/AbstractDealDamageHandler.java (+ CloseRange/Ranged/Magic/Touch, TakeDamageHandler), tools/PacketCreator.java (attack bodies), server/life/Monster.java (HP path), soloMapling BotAttack* (bot damage integration only — no bot behavior changes)
- server/transactions/*, server/Shop.java, BuyBackCommand; client/Character.java (sellAllItemsFromPosition/standaloneSell only)
- WeaponTint/DailyCheckin/CashShopWindow/HyperTP/EnterCashShop handlers; server/{colorprism,cashshop,lamp,weather}/*; DailyCheckinRewards; client/inventory/MakerService.java (verify-only + comment)
- server/resources/db/{changelog-*.xml, tables/026..029 + NEW 030/031, data/172}; scripts (9000041.js, boss portals/events/quests/reactors — script edits only, no WZ)
- net/opcodes/*, net/PacketProcessor.java, client/Client.java (caps fields only), NEW ClientCapsHandler
- server/docs/ROADMAP-BACKLOG.md + NEW durable CURRENT-STATE/ARCHITECTURE/ROADMAP docs; server/src/test/java/** (server seams only)

## §2 Scout verdicts (all three in, static inspection, b8bfc93)
- DAMAGE-CAP: BREAKING. S2C addAttackBody unconditional int+long (PacketCreator.java:2428-2429) on vanilla opcodes, no per-recipient gate. C2S length heuristic (AbstractDealDamageHandler.java:822-826), no reject on mismatch. Magnitude DAMAGE_HACK removed (:933-936); counts kept (:949-956). Mob HP AtomicInteger int (Monster.java:94) — no end-to-end long HP. NEW: bot-crit inflation (1k crit → 2.1B via BotAttackData old-encoding widened + abs() in BotAttackEffects.java:125-129); long sums unchecked (:329-334); legacy crit re-encode mixes representations (:942-946).
- PUSH/WEATHER: prism 0x372F pushed at login (PlayerLoggedinHandler.java:365), equip change (Character.java:2905-2912), map entry (MapleMap.java:2711-2713) — all ungated. Checkin 0x17C auto-open (:415, :488-495) ungated. Weather 60s broadcast ungated (World.java:263-264, WeatherTask.java:48, WeatherPackets.java:135-162) + night scalars active globally (damage ×1.10/÷1.10, EXP ×1.15, spawn ×1.35, blizzard slow via private item 5120994) with NO flag anywhere. Elemental bonus: not implemented (SAFE, stale refs only). Stock-client disposition of unknown opcodes: OPEN (not proven harmless).
- ECONOMY/SCRIPTS: buyback UNSAFE when enabled (non-atomic sell→meso→ledger on separate connections Shop.java:198-225 + TransactionService.java:255-276; fail-open ledger Shop.java:240-249; fail-as-empty-history TransactionService.java:354-356; non-atomic redeem mark→grant→charge :131-140; no conditional claim :466; equip tints lost — TransactionEquip has no tint fields); shop172 UNSAFE rerun (shopitems PK-only on shopitemid, no UNIQUE — every rerun appends; 102 has zero rows for those shops so dedupe-by-keep-min is safe); quicksell UNSAFE (range start→slot-limit incl. unseen >96 slots, 9000041.js displays 0-96; zero-price items removed before price check Character.java:9562-9566; no cash/pet/quest guard; stale selection unvalidated; cancel is no-op OK); maker luck delta CONFIRMED flag-independent (MakerService.java:221-239, crystal IDs 4250000-4252000, up to +2 — need source-fidelity check vs MapleRoot); hyperTP UNSAFE (short-packet 1-3B reads :51-59; no source-map/event check; check→warp→put race :65-70,96-101; ConcurrentHashMap only); boss scripts: ALL APIs resolve, no missing functions, syntax plausible (GraalJS), data/WZ OPEN (relayed to WZ owner with exact ID lists).

## §3 Capability contract v1 (SENT to dll-tree-build, acknowledged pattern)
- C2S CLIENT_CAPS_ANNOUNCE 0x373A (DLL-only sender; stock never emits → legacy C2S untouched). Payload: int dllVersion + int featureMask. Bits: 0x01 LONG_DAMAGE_LINES, 0x02 PRISM_SYNC, 0x04 CHECKIN_WINDOW, 0x08 WEATHER_SYNC, 0x10 LAMP_PREVIEW, 0x20 CASHSHOP_WINDOW.
- S2C CLIENT_CAPS_ACK 0x373B, sent ONLY as direct reply to announce. Payload: int serverNegotiationVersion(=1) + int acceptedMask (announced ∧ server-enabled).
- Timing: DLL sends announce FIRST on EVERY new game socket (login + each channel connect/reconnect). Server stores per-Client (per-connection), default EMPTY = byte-exact v83. No carryover. DLL stays vanilla-default until ack on that connection.
- Server strictness: C2S long-parse only from flagged senders; unflagged = legacy-exact; flagged-but-neither-form = drop+log, never reinterpret. S2C per-recipient encode (shared prebuilt attack packet is DEAD — build legacy + long, selective send). No unsolicited 0x372F/0x17C/0x373D/0x373F/0x3731 to unflagged sessions. Magnitude validator restored long-aware; counts preserved. Mob HP stays int this release (transport-only; backlog ticket-12 descaled).
- DLL lead: green CI 38864427389, no width changes until schema, BunsMS.dll OUT of kaentake profile until co-load audit. Announce wiring on their side pending — selective-encode verification waits on it.

## §4 Historical repair proposals (not the current implementation or work queue)
R1 caps infra: Client caps fields + ClientCapsHandler (validateState=true pre-login) + PacketCreator.clientCapsAck + PacketProcessor reg + Recv/Send enum + registry rows + client/OPCODE_TABLE.md mirror (contract surface; check_opcodes.py must stay green). ACCEPT: announce→ack roundtrip unit; unflagged session zero behavior change.
R2 damage C2S: caps-gated longLines; strict both-forms check, null-return on mismatch + null guards at 4 call sites; long-aware magnitude validator restored (from 35bd41a diff), counts untouched; saturating sums; bot-crit single-point fix (normalize at BotAttackDriver widen OR decode in BotAttackEffects — one place); meso-explosion stays int-only. ACCEPT: legacy-exact bytes test, neither-form drop test, flagged-long test, no-new-opcode test.
R3 damage S2C: addAttackBody(boolean longLines) overload; factory overloads; per-recipient selective send at all broadcast sites (MapleMap paths); legacy default bytes-exact. ACCEPT: byte-compare legacy packet vs pre-change golden.
R4 push gates: prism (syncWeaponTint + broadcastMapTable per-recipient skip + zero-tint skip), checkin auto-open caps check, weather sendTo/broadcast per-recipient skip, lamp/cashshop-window sends caps check. New config USE_WEATHER_GAMEPLAY_EFFECTS default false gating WeatherCombat scalars/spawn/exp/debuff/nocturnal. ACCEPT: unflagged session receives zero custom bytes across login+map-entry+tick; gameplay off by default.
R5 buyback: conditional claim UPDATE..WHERE buyback_used=0; redeem order claim→validate→grant(all-or-abort on addFromDrop false)→charge with best-effort unmark on failure; record path keeps fail-open-sell but throws nothing silent (logged); getLastTransactions no fake-empty (propagate or explicit error carrier — narrowest: throw IllegalStateException→callers map to error string); NEW 030 migration for 6 equip tint cols + POJO/mappers/SQL. ACCEPT: double-redeem race test (conditional claim), tint round-trip test.
R6 shop 031: delete exact-dupe rows for 3 shops keeping MIN(shopitemid); ADD UNIQUE KEY (shopid,itemid) after verifying global safety in 101/102/171/172; header documents INSERT IGNORE now effective. ACCEPT: fresh + rerun idempotency on isolated DB.
R7 quicksell: sellAllItemsFromPosition overload with endSlot clamp (script passes 96); price/cash/pet/quest pre-checks BEFORE removal; slot-range validation; zero-price skip (no removal). ACCEPT: unseen-slot, zero-price, cash-item cases.
R8 maker: source-fidelity check vs MapleRoot (search /tmp repack sources read-only); outcome: if source has luck → comment + backlog note (faithful); if not → gate behind USE_MAKER_* or remove. ACCEPT: documented verdict + behavior pinned by test.
R9 hyperTP: available()<4 guard; source-map CANNOTVIPROCK/event-instance check; in-flight atomic guard (putIfAbsent + finally-remove). ACCEPT: short-packet, restricted-source, concurrent-double-warp cases.
R10 tests hygiene: DELETE ExpeditionWave0Test (enum-count, per instructions — do not repin); audit DamageLongHandlerTest/others — keep only real-seam tests, delete POJO/source-string ones; ADD contract tests (caps, legacy-exact, strict-reject, conditional-claim, idempotency markers).
R11 migrations verify: isolated MariaDB (fresh + seeded-025-upgrade), backup/rollback drill, checksums green. R12 boot smoke: isolated server boot, login→world bootstrap, NPC/shop/checkin/buyback representative paths; record failures honestly. R13 docs: backlog reconcile + CURRENT-STATE/ARCHITECTURE/ROADMAP durable docs.

## §5 Ticket status (server-half lens, evidence-gated — nothing relabeled done)
1 press-mapping: other owner (b8bfc93 landed; theirs to prove). 2 WASM: other owner. 3 checkin: LANDED→needs R4+R12. 4 Evan: REVIEW ONLY (not widened). 5 shops: LANDED→needs R6+R11. 6 maker: LANDED→needs R8. 7 buyback: LANDED dormant (MAX=0)→needs R5+R11. 8 QoL: quicksell LANDED→needs R7; search OPEN (own ticket/WONTFIX). 9 boss wa0: LANDED (+93fa6fd Castellan)→needs WZ-owner validation + R12; MAGNUS/LOTUS ladders dead-until-scripted. 10 cashshop: LANDED opt-in (false)→needs R4 + catalog-path boot check. 11 prism: LANDED→needs R4 + 5782000obtainability (no shop/drop row — follow-up). 12 damage: LANDED→R1/R2/R3 BLOCKING + HP-int descope note. 13 weather: LANDED→needs R4 (packets + gameplay flag). 14 Kaentake smoke: dll-tree-build. 15 R2: selfhost-assets-spec (publishes WZ-owner bytes only). 16 Wine: parallel/other.
Known gaps carried: 31125/31145 absent (graceful degrade), rock 5590001 unobtainable, search.js skipped (1032009 taken), WZ toolchain absent locally, Kaentake/R2 smoke pending. Protected (no touch): bots, FM, casino, tuned rates.

## §6 Network baseline decision (parent, 2026-10-16 — recorded, not implemented here)
- Launcher default host: replace stale Fly .103 with LAN 192.168.0.164 (measured OPEN); preserve user override. Launcher owner implements.
- Native current release = LAN/VPN baseline. LAN login 8484 + channels 7575-77 OPEN; public buns/maplestory:8484 CLOSED (Caddy HTTP-only, no TCP stream proxy).
- Website/downloads = public HTTP only. /api/server 'running' = in-compose server:8484 TCP check, NOT public-reachability proof. Do NOT derive client host from Docker DNS 'server'.
- No automatic NAT/L4 changes, no prod Java/DB restart. LAN/VPN requirement documented explicitly for external friends. External native-TCP cutover = separate validated network change, never sneaky port opening. Public native friend reachability NOT proven/marked.

## §8 Proxy baseline correction (2026-10-16)
- First private proxy mistakenly served PROD /opt/buns/web-client (98ff/9a09). Killed.
- Correct proxy LIVE http://192.168.0.164:18081 with EXACT dev pair 31f9/0907 (JS 00dc057b 238616B / WASM 0cb3e707 5426595B, curl-verified) from owned STATIC_ROOT /opt/buns-iso-priv (real dir, owned copies; no symlink write-through to live roots). No live files mutated.
- Network final (user): public ports LATER on same domains (buns.asslorde.com canonical), NO Tailscale, no router/NAT now; HOST/LANHOST fix rides safe release; local override stands for tests.

## §9 Inventory incident RESOLVED (2026-10-16, controlled fresh-login capture)
- Live Character (char4/acct5, map 10000, caps 0) in-memory EXACTLY matches offline DB (USE 2000000x5 s2, ETC 4161001x1 s1, 4 equips).
- Wire: channel HELLO → 32 S2C packets / 3682 bytes, all headers valid; SET_FIELD 0x7D 638 bytes, inventory at offset 130 parses EXACT under legacy parse (USE[479,501), ETC[502,524), quantities intact).
- Conclusion: server load/send path EXONERATED (no tint-serialization patch needed, no storage bug). Prior "empty tabs" = client render/selection artifact (ORANGE SET-UP selected, verified USE/ETC frames pending). No source bug established.
- Standing authorization: press captures verified USE+ETC full pixels only; all others frozen; window stays stable.
