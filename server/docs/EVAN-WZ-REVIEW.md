# Ticket 4 — Evan merge review and playable prerequisites

**Accepted scope completed: review and prerequisites, not a playable class or asset merge.** No Evan Character/Skill/String/UI assets are included by the roadmap WZ builder. No Java, database, bot, balance, class-creation or packet behavior was changed for this review.

## Lineage and reproducible evidence

- User payload: `/root/maplestory_dump/Evan.zip`, SHA256 **`961e0cbf826aca48efa619afec51fd12c2472a82e654e6e73542b5bf65a0e5ce`**; 45 `.img.xml` members / 86,655,224 uncompressed bytes. It supplies XML with embedded PNG `basedata`, not a complete executable/client. No upstream repository, author or version pin is supplied; attribution must not be invented.
- XML reference: `/root/workspace/cosmicms/wz`, distinct from the clean GMS installer and from a deployed-content assertion. Every existing comparison target's exact SHA256, each source member's full SHA256/size, source-only/reference-only paths, changed shared metadata and skill IDs are recorded in [`evan-review-manifest.json`](../../tools/wz_release/evan-review-manifest.json).
- Server-code reference: `solobots` **`b8bfc931d5c62524ff6168d66c7076747fa23f34`**. The local worktree `server/wz` points to `/opt/cosmicms/wz` and is not a populated local data tree. Read-only SSH confirmed deployed `/opt/buns/server/wz` resolves to `/opt/cosmicms/wz` on `.164`; this does not make the local XML reference byte-identical to deployed files.
- Native stock lineage is separately pinned by the installer SHA256 `1a1128ac97e11c7845aacec1a5484e650558a67da94b94147d72292e1568366d` in the [native WZ pipeline](../../tools/wz_release/README.md). The older `/tmp/mw-wz/full` was incomplete, and loose sibling WZ files must not be assumed stock.
- This durable review supersedes `/tmp/evan-wz-review.md`: the old note's totals mixed `Basic` between categories and its UIWindow top-level delta is stale against the now-hashed XML reference. Current disjoint verdicts are **29 safe additions, 13 collisions, 3 do-not-wholesale-merge shared files**.

Reproduce without extracting or merging Evan assets:

```sh
python3 tools/wz_release/review_evan.py \
  --archive /root/maplestory_dump/Evan.zip \
  --xml-root /root/workspace/cosmicms/wz \
  --manifest tools/wz_release/evan-review-manifest.json
```

## Per-file verdict

`SAFE` means no same-path target in the recorded XML reference, **not** runtime compatibility or permission to flatten directories. `COLLISION` requires exact-node review and retention of existing metadata. `DO NOT MERGE WHOLE` forbids wholesale shared-file replacement. Full hashes are in the linked manifest; short hashes below identify the exact source rows.

| Archive member below `Evan/` | Verdict | Source SHA256 prefix |
|---|---|---|
| `Character/00002000.img.xml` | COLLISION | `e4db7b3d4701` |
| `Character/Dragon/01942000.img.xml` | COLLISION | `55d4607495e5` |
| `Character/Dragon/01942001.img.xml` | COLLISION | `925b756a99b5` |
| `Character/Dragon/01942002.img.xml` | COLLISION | `3baa47229db1` |
| `Character/Dragon/01942003.img.xml` | SAFE | `15780edea0d9` |
| `Character/Dragon/01942004.img.xml` | SAFE | `930c201265d0` |
| `Character/Dragon/01952000.img.xml` | COLLISION | `f22f3e577cec` |
| `Character/Dragon/01952001.img.xml` | COLLISION | `b72ca0a93526` |
| `Character/Dragon/01952002.img.xml` | COLLISION | `c12abd986661` |
| `Character/Dragon/01952003.img.xml` | SAFE | `8ab82a0fdc0c` |
| `Character/Dragon/01952004.img.xml` | SAFE | `71032eaee2fd` |
| `Character/Dragon/01962000.img.xml` | COLLISION | `acf55dfb71b2` |
| `Character/Dragon/01962001.img.xml` | COLLISION | `cfe8fd769d68` |
| `Character/Dragon/01962002.img.xml` | COLLISION | `ba5f503e8c4b` |
| `Character/Dragon/01962003.img.xml` | SAFE | `fab885da12c8` |
| `Character/Dragon/01962004.img.xml` | SAFE | `7eec6cb7b347` |
| `Character/Dragon/01972000.img.xml` | COLLISION | `5972398980fd` |
| `Character/Dragon/01972001.img.xml` | COLLISION | `f307c2714392` |
| `Character/Dragon/01972002.img.xml` | COLLISION | `08928e51c390` |
| `Character/Dragon/01972003.img.xml` | SAFE | `adafe1081655` |
| `Character/Dragon/01972004.img.xml` | SAFE | `728db28d52b1` |
| `Skill/2001.img.xml` | SAFE | `12679eaf99e5` |
| `Skill/2200.img.xml` | SAFE | `8ddabccd352c` |
| `Skill/2210.img.xml` | SAFE | `b7a878585867` |
| `Skill/2211.img.xml` | SAFE | `00daae202a89` |
| `Skill/2212.img.xml` | SAFE | `c3a672b3becb` |
| `Skill/2213.img.xml` | SAFE | `672b35f7440a` |
| `Skill/2214.img.xml` | SAFE | `82fa80506394` |
| `Skill/2215.img.xml` | SAFE | `87b81c8da2ba` |
| `Skill/2216.img.xml` | SAFE | `91165b57d649` |
| `Skill/2217.img.xml` | SAFE | `081b5f7bcb8c` |
| `Skill/2218.img.xml` | SAFE | `dd11ca463790` |
| `Skill/Dragon/2200.img.xml` | SAFE; keep hierarchy | `4424a1440d0a` |
| `Skill/Dragon/2210.img.xml` | SAFE; keep hierarchy | `d52dd387c31d` |
| `Skill/Dragon/2211.img.xml` | SAFE; keep hierarchy | `aaf3846a64cb` |
| `Skill/Dragon/2212.img.xml` | SAFE; keep hierarchy | `4164f9d85974` |
| `Skill/Dragon/2213.img.xml` | SAFE; keep hierarchy | `fe9377692280` |
| `Skill/Dragon/2214.img.xml` | SAFE; keep hierarchy | `a3611b3f851f` |
| `Skill/Dragon/2215.img.xml` | SAFE; keep hierarchy | `e14ac1ff5e2a` |
| `Skill/Dragon/2216.img.xml` | SAFE; keep hierarchy | `4da151db551d` |
| `Skill/Dragon/2217.img.xml` | SAFE; keep hierarchy | `0a4ac251ab8e` |
| `Skill/Dragon/2218.img.xml` | SAFE; keep hierarchy | `ef62d5ff53a5` |
| `String/Skill.img.xml` | DO NOT MERGE WHOLE | `a025a90aed55` |
| `UI/Basic.img.xml` | DO NOT MERGE WHOLE | `38e90c8d4ac6` |
| `UI/UIWindow.img.xml` | DO NOT MERGE WHOLE | `ad64b165eb27` |

## Exact collision rules

1. **Character body actions:** `00002000` adds 17 top-level actions (`Awakening`, `Earthquake`, `OnixBlessing`, `blaze`, `darkFog`, `dragonThrust`, `fireCircle`, `flameWheel`, `ghostLettering`, `killingWing`, `lightingBolt`, `magicRegistance`, `magicShield`, `mapleHero`, `recoveryAura`, `slow`, `soulStone`). Preserve every existing action and every shared frame; a name-set superset does not prove shared pixel/alias equivalence. Keep source spellings until action dispatch is proven.
2. **Twelve existing Dragon equipment images:** source icon art lacks the reference `info/level/info/*/exp` tree. Keep that server growth metadata. The eight `*003/*004` additions have no reference collision; neither category proves the native companion renderer consumes these files.
3. **Skill books vs Dragon animations:** 11 top-level books contain a `skill` node; 10 `Skill/Dragon` images contain animation states instead. **Flattening the Dragon files into `Skill/` overwrites books with the same filename.** Preserve both namespaces. `SkillFactory.loadAllSkills` iterates only top-level files and their `skill` children ([SkillFactory.java:96–115](../src/main/java/client/SkillFactory.java)); it does not load `Skill/Dragon` as player skills.
4. **Shared String:** preserve `0000100`, `10000100`, `20000100` Chair Mastery nodes and descendants. Source adds 43 top-level names/books; do not replace other strings, including existing custom skills.
5. **Shared Basic:** consider only the new `Tab8` subtree, retaining every shared control and existing tint/check-in/cash-shop controls. An apparent top-level superset is not evidence of unchanged canvas bytes.
6. **Shared UIWindow:** against the current hashed reference only `SkillEx` and `SkillMacroEx` are absent top-level nodes; the old nine-top-node claim is not current evidence. Additional source-only nested nodes are in the manifest. Preserve all reference-only MobGage canvases and every DailyCheckin/ColorPrism/Bag subtree added by the native roadmap build. The 16,935,905-byte source is never a drop-in replacement.
7. **Both asset representations:** client IMG/WZ pixels and server XML semantics must be built and validated separately. Embedded `basedata` in XML is not proof that a native WZ was created, the engine follows its links, or a server DOM canvas carries working game art.

## Playable prerequisites — not implemented by Ticket 4

| Seam | Observed implementation | Still required for a playable release |
|---|---|---|
| Job IDs | `Job.java:59–63` declares 2001 and 2200/2210–2218. | Declaration is not selectable creation or advancement. Do not add duplicate enum IDs. |
| Character creation | `CreateCharHandler.java:50–63` accepts only Cygnus/Adventurer/Aran; default rejects. `MakeCharInfoValidator.java:16–37` has only existing three creation families, defaults to null/reject. | A paired native creation UI/packet contract, validated Evan recipe/start map/items, login/tutorial and advancement flow. No creation opcode/field guess from WZ names. |
| Skill/SP state | Data-driven loader exists; `GameConstants.getSkillBook:494–499` indexes 2210–2218; `Character` already uses the skillbook index. `SkillFactory` has explicit Evan buff/attack cases. | Paired skill books, descriptions, action lookup, keydown/charge casts, SP/book save/relog/advancement validation. A successfully parsed XML does not prove correct effects or formula behavior. |
| Dragon lifecycle | `Character.java:1307–1328` tears down/recreates a dragon on relevant job change; `Dragon.java:29–57` and `MoveDragonHandler.java:34–54` exist. | Native growth-stage selection, movement, map entry/re-entry, owner/remote rendering and animation binding to `Skill/Dragon` must be exercised; existing code is partial support, not evidence of absence or completeness. |
| Packet widths | Existing `MOVE_DRAGON` receive `0xB5`, spawn/move/remove send `0xB5/0xB6/0xB7` are declared; `PacketProcessor.java:451` registers movement. `PacketCreator.java:7369–7399` writes the dragon structures. | Verify exact native decoder/encoder compatibility for this EXE, dragon identity, skill charges, attack and buff payloads. Keep negotiated roadmap damage widths independent of class-data review. No blind v84+ packet port. |
| Character actions/client UI | Archive has new body/dragon animation states and skill UI XML. | Exact-node native WZ conversion, alias/pixel preservation, action-enum/animation dispatch support, creation/skill UI interaction and rendering. The stock executable being v83-compatible does not prove it can select/use Evan. |
| World/progression | Existing scripts and job constants are leads only. | An isolated playable test must cover creation → login → advancement/growth → representative skills → damage/EXP → map/channel changes → relog with saved SP/skills/dragon. Not exercised here. |

Future implementation must retain **Java 21**, the existing Liquibase root/extension convention, SoloMapling shared-headless-client behavior, bot/custom-content fields, tuned rates, and the current shared UI/String trees. No DB migration or runtime/framework change is warranted by this review alone. Source evidence: `server/pom.xml:47–49,69,104–107`; `src/main/resources/db/changelog-root.xml:8–13`; the exact-node preservation policy in the native builder.

**Acceptance boundary:** ZIP/XML parsing, per-file hashes/collisions, precise shared-node retention rules and code-backed playable prerequisites are established. Asset merge, skill-loader runtime boot, native class creation, companion/cast rendering and playable Evan acceptance are intentionally **not achieved and not claimed** by Ticket 4.
