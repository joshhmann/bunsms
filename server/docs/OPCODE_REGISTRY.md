# Custom Opcode Registry

Reserved-by-convention ranges for non-stock opcodes. Stock v83 opcodes top out at
Recv `USE_HAMMER (0x104)` and Send `VEGA_SCROLL (0x166)`. Everything below lives
outside stock space so dump features never collide. **No opcode values change here;
this file plus the reservation comments in the enums are the reservation mechanism.**

## Reserved block: `0x372E-0x373F` (custom feature range)

| Opcode(s) | Direction | Owner / feature | Status |
|---|---|---|---|
| `0x372E` / `0x372F` | Recv / Send | Coloring prism (`WEAPON_TINT_ACTION` / `WEAPON_TINT_SYNC` per dump INTEGRATION docs; prism C2S/S2C per kaentake guide; item 5782000) | RESERVED, not yet in enums |
| `0x3730` / `0x3731` | Recv / Send | Cash-shop window (`CASHSHOP_WINDOW_ACTION` / `CASHSHOP_WINDOW_SYNC`, per cashshop-window INTEGRATION.md) | RESERVED, not yet in enums |
| `0x373C` / `0x373E` | Recv (request twins) | Weather/lamp system, unused request side | RESERVED |
| `0x373D` | Send | Weather sync (`WEATHER_SYNC` / `LP_WeatherSync`) | RESERVED, not yet in enums |
| `0x373F` | Send | Lamp preview (`LAMP_PREVIEW` / `LP_LampPreview`) | RESERVED, not yet in enums |
| rest of `0x372E-0x373F` | — | Unassigned | FREE — claim here before use |

## Direction-split claims (outside the block)

| Opcode | Direction | Owner / feature | Status |
|---|---|---|---|
| `0x11A` | Recv | Daily check-in C2S (`DAILY_CHECKIN`, server half canonical; window DLL-side) | CLAIMED in RecvOpcode. CAUTION: stock Send `HIT_SNOWBALL(0x11A)` shares the numeric value in the opposite direction — not a wire collision, do not "fix" by renumbering |
| `0x17C` | Send | Daily check-in S2C (`DAILY_CHECKIN`, snapshot consumed by DLL window) | CLAIMED in SendOpcode |

## Pre-existing custom opcodes (grandfathered)

| Opcode | Direction | Name / owner |
|---|---|---|
| `0x3713` | Recv | `CUSTOM_PACKET` (legacy OdinMS GM echo, RecvOpcode.java:25) — unrelated to dump features |

## Stock ranges that look custom but are NOT

| Range | Direction | Name |
|---|---|---|
| `0x145-0x14D` | Send | Stock `CASHSHOP_*` family (SendOpcode.java:334-342). The new cash-shop *window* feature uses `0x3730/0x3731`, not this range. |
| `0x8E` | Send | Stock `BLOW_WEATHER` — unrelated to the weather/time system (`0x373D`). |

## How to claim a new opcode

1. Pick a FREE value (check both enums + this file).
2. Add a row here with owner/feature first.
3. Then add the enum entry + reservation comment.
4. Never reuse a value across two features in the same direction.
