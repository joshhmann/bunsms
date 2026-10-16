# XREF — canonical-exe address table with evidence

Canonical exe: stock v83 GMS, `ImageBase 0x400000`. Every absolute address
below is void on any other build. A different exe build invalidates the
whole table at once; re-find xrefs, never guess single addresses.

**Evidence rule:** every row carries evidence + the bundle section it was
transcribed from. No address lands here without both.

Evidence key: `SEH` = SEH-prologue match · `XREF` = CALL cross-reference ·
`RETN` = `ret n` arity match · `BUNDLE` = bundle source asserts the VA
directly (lowest grade — re-verify on a Windows host before trusting).

Owner key: the single module that may hook/patch the site. `0x004965F1`
(dispatcher) and `0x009F84D0` (tick) are hooked **exactly once**;
`0x00453AD1` (weapontint) and `0x00791FA8`-family sites have single-owner
rules noted per row.

## Live this slice (spine + daily check-in)

| Address | Owner | Use | Evidence | Transcribed from |
|---|---|---|---|---|
| `0x004965F1` | dispatcher | `CClientSocket::ProcessPacket` — hooked exactly once | SEH | spec §2.2; dailycheckin bundle `kAddr_ClientSocket_ProcessPkt` agrees |
| `0x009F84D0` | tick | `CWvsApp::CallUpdate` — hooked exactly once | SEH | spec §2.2 (Kaentake `CallUpdate` MEMBER_HOOK agrees) |
| `0x004065A6` | shared | `COutPacket::Encode4` | XREF | spec §2.2 |
| `0x00406629` | shared | `CInPacket::Decode4` | XREF | spec §2.2 |
| `0x00989588` | dailycheckin | `play_ui_sound` | BUNDLE | dailycheckin.zip `kAddr_play_ui_sound` |
| `0x00A07431` | dailycheckin | `CWvsContext::ProcessBasicUIKey` | BUNDLE | dailycheckin.zip `kAddr_ProcessBasicUIKey` |
| `0x00BE7918` | dailycheckin | `CWvsContext` singleton instance | BUNDLE | dailycheckin.zip `kAddr_CWvsContext_Instance`; also dispatcher stage guard |
| `0x00BE7914` | dailycheckin | `CClientSocket` singleton instance | BUNDLE | dailycheckin.zip `kAddr_ClientSocket_Instance` |
| `0x0049637B` | dailycheckin | `CClientSocket::SendPacket` | BUNDLE | dailycheckin.zip `kAddr_ClientSocket_SendPacket` |
| `0x009929DD` | dailycheckin | `CUtilDlg::Notice` | BUNDLE | dailycheckin.zip `kAddr_CUtilDlg_Notice` |
| `0x0098A707` | dailycheckin | `get_basic_font` | BUNDLE | dailycheckin.zip `kAddr_get_basic_font` |
| `0x0046341A` | dailycheckin | `IWzFont::SetFont` | BUNDLE | dailycheckin.zip `kAddr_SetFont` |

Stage-guard constant (not a hook site): `CWvsContext+0x20B8` null ⇒
login/char-select stage (weather bundle; dispatcher falls through for
opcodes `0x1D..0x7C`).

## Reserved (later slices — transcribed, re-verify on Windows host)

| Address(es) | Owner | Use | Evidence | Transcribed from |
|---|---|---|---|---|
| `0x00453AD1` | weapontint | `CAvatar::PrepareActionLayer` Detour (recolour swap; single owner — a second Detour silently wins/loses) | spec table | spec §2.2 (prism INTEGRATION §§4.2–4.8) |
| `0x0093BEB9`, `0x0093C218` | weapontint | cash-effect (`Item/Cash/0501.img`) Detours | spec table | spec §2.2 |
| `0x00A0A63F`, `0x00A1DC5B`, `0x004863D5` | coloringprism | cash-item-use dispatch (call in, never second-Detour) | spec table | spec §2.2 |
| `0x004EF140` | coloringprism | `CDraggableItem::OnDropped` dispatch (same rule) | spec table | spec §2.2 |
| `0x0079058F`, `0x00791F94` | damagelong | `jb`→`jmp(0xEB)` AFE8A0-skip rewrites (`Patch1` ×2) | spec table | spec §2.2 (IMPLEMENTATION §§4–6) |
| `0x00790599`, `0x00791F9E` | damagelong | `call __ftol` → `FtolDamageLine` (`PatchCall` ×2) | spec table | spec §2.2 |
| `0x0079059E`, `0x00791FA3` | damagelong | line-store `PatchJmp` (return `0x007905A3` / `0x00791FA8`) | spec table | spec §2.2 |
| `0x00952B28`, `0x00955428`, `0x0095705E` | damagelong | C2S Encode4 sites (melee eax / shoot edi / magic edi) | spec table | spec §2.2 |
| `0x00980574`, `0x00980619` | damagelong | S2C `Decode4` sites (meso-explosion 4211006 vs normal) | spec table | spec §2.2 |
| `0x0079023C`, `0x00790274` | damagelong | physical Shadow Partner % caves (owned by damagelong; QoL MUST NOT recave) | spec table | spec §2.2 |
| `0x00437DFB` | damagelong | Effect_HP `ZXString::Format` (unit-skin hook site) | spec table | spec §2.2 |
| `0x0078DF87`, `0x00791864`, `0x00791FA8` | damagelong | PDamage / MDamage-loop refs | spec table | spec §2.2 |
| `0x006406F3` | weatherwind | wind cave | spec table | spec §2.2 |
| ~two-dozen | weather/lamps | per weather IMPLEMENTATION.md appendix | — | transcribed when the weather slice lands |

Do-not-touches (damage-cap): `0x0078E543` (`fld AFE8A0`/`fsub` is not a
line funnel), `dbl_AFE8A0 (0x00AFE8A0)` global rewrite, patching every
`cdq`/`idiv` in CalcDamage (only line-store `__ftol` sites).

## Drift call: prism schema 12 vs 18 columns (locked)

The two dump docs disagree on the `coloring-prism.xml` schema (12 vs 18
columns + `skilltints`). **Newest doc wins: the 18-column variant.**
Record of truth checked on `solobots` 2026-10-15:
`server/src/main/resources/db/tables/028-coloring-prism.sql` creates **6**
`inventoryequipment` tint cols + **9** `characters` tint cols + **3**
`inventoryitems` `efftint*` cols (= 18) plus the `skilltints`
`(characterid, skillid)` table. The DLL leans on the Liquibase state, not
either dump doc, when the prism slice lands.
