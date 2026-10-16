# Client opcode table — MIRROR of `server/docs/OPCODE_REGISTRY.md`

Updated in **lockstep** with the registry + both enums (`RecvOpcode.java` /
`SendOpcode.java`); `tools/check_opcodes.py` fails CI on any disagreement.
Claiming a new opcode = one commit touching registry + both enums + this
table together. **No opcode values change here.**

## Reserved block `0x372E–0x373F` (custom feature range)

| Opcode(s) | Direction | Owner / feature | Status |
|---|---|---|---|
| `0x372E` / `0x372F` | Recv / Send | Coloring prism (`COLORING_PRISM_ACTION` / `COLORING_PRISM_SYNC`; dump-side alias `WEAPON_TINT_ACTION` / `WEAPON_TINT_SYNC`; item 5782000) | CLAIMED (ticket #11) |
| `0x3730` / `0x3731` | Recv / Send | Cash-shop window (`CASHSHOP_WINDOW_ACTION` / `CASHSHOP_WINDOW_SYNC`) | CLAIMED (ticket #10) |
| `0x373C` / `0x373E` | Recv (request twins) | Weather/lamp system, unused request side | RESERVED |
| `0x373D` | Send | Weather sync (`WEATHER_SYNC` / `LP_WeatherSync`) | CLAIMED (ticket #13) |
| `0x373F` | Send | Lamp preview (`LAMP_PREVIEW` / `LP_LampPreview`) | CLAIMED (ticket #13) |
| rest of `0x372E-0x373F` | — | Unassigned | FREE |

## Direction-split claims (outside the block)

| Opcode | Direction | Owner / feature | Status |
|---|---|---|---|
| `0x11A` | Recv (C2S) | Daily check-in (`DAILY_CHECKIN`) | CLAIMED — wired this slice (`dailycheckin.cpp` route) |
| `0x17C` | Send (S2C) | Daily check-in (`DAILY_CHECKIN` snapshot) | CLAIMED — wired this slice (`dailycheckin.cpp` route) |

## Grandfathered (NOT OURS — do not "fix")

| Opcode | Direction | Name / owner |
|---|---|---|
| `0x3713` | Recv | `CUSTOM_PACKET` (legacy OdinMS GM echo) |

## Stock ranges that look custom but are NOT

| Range | Direction | Name |
|---|---|---|
| `0x145-0x14D` | Send | Stock `CASHSHOP_*` family. The cash-shop *window* feature uses `0x3730/0x3731`, not this range. |
| `0x8E` | Send | Stock `BLOW_WEATHER` — unrelated to the weather/time system (`0x373D`). |
| `0x11A` | Send | Stock `HIT_SNOWBALL` shares the numeric value in the opposite direction — not a wire collision, do not renumber. |
