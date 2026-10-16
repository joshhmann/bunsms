# CURRENT-STATE — release-integration (server vertical)
Date: 2026-10-16. Branch: release-integration @ d75a923 (post long-HP merge cef413b). Base: solobots b8bfc93.
Prod .164 Java/DB untouched; all proof on isolated DB/ports (buns_iso @ 127.0.0.1:43307, login 8484, channels 7575-77) or compiled-but-undeployed code (stated explicitly per item).

## What is true right now (exercised, not claimed)
- Capability contract v1 COMPILED + unit-proven (0991452, 2e8a321): C2S 0x373A announce / S2C 0x373B ack; per-connection caps, default legacy byte-exact. LoginSmoke2 + ack-bytes test prove handler resolution + wire bytes. NOT deployed to any public server.
- Damage path hardened + long-HP merged (1cebd24, 2e8a321, cef413b): caps-gated C2S, strict null-reject, 2^53-explicit autoban bound, saturating sums, exact crit decode, per-recipient S2C under chrRLock, long core with ratio-normalized encoders. Tests 10/11 + 4/4 + 15/15 green; suite 2019 green at merge.
- Push gates COMPILED (5c72653): prism/checkin/weather/lamp send only to flagged sessions; weather gameplay default-off (6410f99). Legacy gets zero custom bytes. Isolated-boot exercised; not deployed.
- Economy: sole-lead repair branch owns the accepted contract (stored quote, atomic ledger, exact preflight). Earlier E-slice commit 5c72653 superseded — see sole lead. Quicksell still BROKEN (range/guard gap, reported, not waived).
- Migrations 026/028/030 rewritten (never-executed proc form → guarded ALTERs). DB proof: fresh buns_iso green 26→30 + 172 + 173 (91/3/18 + 37 rows verified, rerun no-op). Seeded-upgrade leg: PROD-READ DONE (read-only, no writes) — prod changelog tops at 171, 26-29 ABSENT, no checkin/tint cols, no ledger tables, bosslog ENUM stock-5. Consequence: my rewrite is safe for fresh deploys; prod needs its OWN migration plan (changeset IDs 26-30 would collide-or-skip against prod's recorded checksums — DO NOT rerun blindly; DBA path with the recorded MD5SUMs).
- Ticket-5 at 318: 112 + 169 + 37 (173), 0 conflicts; NPC scripts open stocked shops in non-quest branches (9110002 completed-branch fixed too). Catalog 1843 rows boot-green + packaged in both images (b739878). WZ-owner catalog gate (per-item icon/info/name vs FINAL native7) still open.
- Isolated server BOOTS CLEAN: login 8484 + 3 channels + admin 8585 listening, "Cosmic is now online", zero channel errors. TCP hello = 16 bytes: length-field 0x000e, then version + IVs (0x0e is the LENGTH, not v83 version — do not misreport). CashShop catalog loads 1843 rows when the TSV is present.
- Full suite 2019 green at merge (cef413b).

## What is NOT done (true blockers, owners)
- Prod migration plan for 26-30/172-173 (fresh-safe proven; prod path needs DBA with recorded checksums). Prod Java/DB otherwise untouched.
- Economy sole-lead repair (own branch :43308, pre-fix repro + accepted contract). Quicksell player-loss bug OPEN.
- Bots-ON boot + full event lifecycle vs FINAL corpus (/tmp/buns-wz-candidate-7/server-wz-complete).
- Native ACK/game proof (Wine owner vs 127.0.0.1:8484; ACK proof pending).
- Ticket-2 browser persistence (press + inventory-QA on corrected :18081 proxy, dev 31f9/0907).
- Ticket-4: REVIEW-ONLY DONE (not a playable-blocker; WZ-owner doc + manifest carry it).
- External native reachability UNVERIFIED; user decision: public LATER on same domains, no Tailscale; local override stands. LAN default + HOST fix with asset repair lead.
- Selfhost: faa818c frozen FAILED; sole SOURCE repair lead owns coherent fix (55e5f18/de4d851 obsolete threads).

## Ticket status (evidence-gated)
1 pointer-proof DONE (no fix was necessary). 2 open (browser persistence). 3/10/11 server halves gated, DLL/client halves pending. 4 REVIEW-ONLY DONE. 5 data 318 done + catalog packaged; per-item WZ gate open; reachability provisional. 6 pure extraction restored. 7 with sole lead (dormant MAX=0). 8 quicksell BROKEN (reported); search open. 9 Wave-0 only (FULL scope remains). 12 wire + long-HP core merged (cef413b). 13 packets + gameplay gated (default-off). 14/15/16 other owners.

## Cross-client gates (parent)
- NX delta sent to NxBaselineDelta (machine-readable contract, entry/visibility policy; deployed-NX inventory confirms missing boss maps/mobs/NPC — gate browser entry until FINAL NX accepted). Prism 5782000 NOT world-visible (no award path) — NX deferred until obtainability lands. Native UI caps != asset coverage.
- WZ: FINAL corpus path /tmp/buns-wz-candidate-7/server-wz-complete (54527 files BYTEIDENTICAL + 78 merged XML); portal gaps recorded (271030010/out00 + 541020800/ps00 absent, portal-0 fallback needs lifecycle exercise); NPC dispatch = numbered scripts; 0400.img.xml lineage change NOT mine.
