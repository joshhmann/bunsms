# CURRENT-STATE — release-integration (server vertical)
Date: 2026-10-16. Branch: release-integration @ c8e89b8. Base: solobots b8bfc93.
Prod .164 Java/DB untouched; all proof on isolated DB/ports (buns_iso @ 127.0.0.1:43307, login 8484, channels 7575-77).

## What is true right now (exercised, not claimed)
- Capability contract v1 LIVE in code: C2S 0x373A announce / S2C 0x373B ack (0991452); per-connection caps, default legacy byte-exact. LoginSmoke2 proves BOTH handlers resolve on the login processor + opcode values.
- Damage path hardened (1cebd24): caps-gated C2S, strict null-reject, restored magnitude guard, saturating sums, bot-crit fix, per-recipient S2C. Tests 11/11 + 6/6 green.
- Push gates LIVE (5c72653): prism/checkin/weather/lamp send only to flagged sessions. Legacy gets zero custom bytes.
- Economy hardened (5c72653, E-slice): conditional claim + lock-held redeem, honest history errors, casino parity, 6 tint cols end-to-end (030), HyperTP guards, Maker luck REMOVED (c8e89b8 — new-to-Buns RNG deleted, stock behavior preserved).
- Migrations 026/028/030 rewritten (never-executed proc form → guarded ALTERs). DB proof: fresh buns_iso green 26→30 + 172 + 173 (91/3/18 + 37 rows verified, rerun no-op). Seeded-upgrade leg BLOCKED: pre-slice 026/028 in their landed form fail on any Liquibase run (pre-existing — prod must already carry these columns or prod migrations never ran clean; needs prod-DBA read-only check, no prod writes).
- Ticket-5 at 318: 112 + 169 + 37 (173), 0 conflicts; NPC scripts open stocked shops in non-quest branches (numbered scripts confirmed dispatch winners over WZ redirects).
- Isolated server BOOTS CLEAN: login 8484 + 3 channels + admin 8585 listening, "Cosmic is now online", zero channel errors (after scripts symlink + bots-off + eventSM null-guard 14dada9). TCP hello valid (16 bytes, version 0xe). CashShop catalog empty in iso-boot (catalog.tsv not copied — expected, not a failure).
- Full suite 2012 green, 0 failures.

## What is NOT done (true blockers, owners)
- Seeded-upgrade (26/28 old-form) needs prod-DBA read-only column check. Owner: whoever can read prod DB.
- Long-HP core: damagecap-server branched from c8e89b8, owns Monster HP internals (getHpLong/getMaxHpLong next). No simultaneous HP edits from me.
- Kaentake smoke / R2 publish / Wine / ticket-2 browser / Evan playable: other owners, pending.
- External native reachability UNVERIFIED (LAN probes only). LAN/VPN baseline stands.
- 55e5f18 selfhost NOT merged (publication review: atomic publish/rollback broken). Staged-publisher fixes with hosting owner.

## Ticket status (evidence-gated)
1 pointer-proof DONE (no fix was necessary). 2 open (browser). 3/10/11 server halves gated, DLL/client halves pending. 4 REVIEW-ONLY done (WZ owner doc server/docs/EVAN-WZ-REVIEW.md — link when merged). 5 data 318 done, reachability provisional. 6 pure extraction restored. 7 hardened, dormant (MAX=0). 8 quicksell landed+gated pending boot walk; search open. 9 Wave-0 only (FULL scope remains). 12 wire done, HP core with damagecap-server. 13 packets+gameplay gated; gameplay flag default-off NOT yet added (weather scalars still unconditional — next commit). 14/15/16 other owners.

## Cross-client gates (parent)
- NX delta sent to NxBaselineDelta (machine-readable contract, entry/visibility policy). Prism 5782000 NOT world-visible (no award path) — NX deferred until obtainability lands. Native UI caps != asset coverage.
- WZ: candidate-4 intake validated; portal gaps recorded (271030010/out00 fallback-safe, 541020800/ps00 null-safe); NPC dispatch = numbered scripts (WZ redirects inert); 0400.img.xml lineage change NOT mine.
