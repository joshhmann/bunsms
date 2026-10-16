# BunsMS client DLL (`BunsMS.dll`)

Win32 injector DLL for stock v83 GMS (`ImageBase 0x400000`), built with
VS2022 / CMake (Win32). This tree is the **client half** of five features
whose **server halves already landed** on `solobots` (tickets #10–#13 +
daily check-in). Nothing here builds or runs on Linux by design — all
addresses, Detours, and WZ COM wrappers are Win32-only. **Windows CI is the
compile gate**; keep this tree review-clean and CI-shaped.

## Layout

```
client/
├── CMakeLists.txt       # root: C++17, CLIENT_DLL_VERSION, BUNS_DLL_NAME
├── CMakePresets.json    # debug-win32 / release-win32 (VS 17 2022, Win32)
├── README.md            # this file
├── OPCODE_TABLE.md      # MIRROR of server OPCODE_REGISTRY.md — lockstep (§5)
├── XREF.md              # canonical-exe address table with evidence
├── external/            # Detours + WzLib submodules (checkout: recursive)
├── src/                 # injector + spine + feature modules
│   ├── pch, injector, system, hook, debug
│   ├── dispatcher / tick (single ProcessPacket hook / single CallUpdate hook)
│   ├── addresses.h      # single address table — no raw VAs elsewhere
│   ├── wvs/ + ztl/      # minimal engine layouts the features need
│   └── dailycheckin.*   # §3.1 (more modules land per slice)
└── tools/
    └── check_opcodes.py # opcode drift gate (runs in client.yml)
```

## Status (slices)

- [x] Spine: dispatcher + tick + addresses + hook/debug/pch
- [x] §3.1 daily check-in (dispatcher route, no private ProcessPacket hook)
- [ ] §3.2 cash-shop window (from bundle)
- [ ] §3.3 coloring prism + weapon tint (authored from INTEGRATION.md)
- [ ] §3.4 damage-cap hooks (authored from IMPLEMENTATION.md)
- [ ] §3.5 weather + lamps + wind (from bundle)

## Build (Windows host + VS2022 + CMake)

```bat
cmake --preset release-win32
cmake --build --preset release-win32
```

`build/Release/BunsMS.dll` (+ `.pdb`) is the artifact CI publishes.
Checkout requires `submodules: recursive` (Detours + WzLib).

## Paired release (§5)

Client and server ship together; an old DLL against a new server (or
reverse) fails silently. `CLIENT_DLL_VERSION` (root CMakeLists) matches the
server's `MIN_DLL_VERSION`; the DLL stamps its version into the handshake
(handshake field pending — parent open question; until it lands the version
is compiled in via `GetClientDllVersion()`, never silently downgraded).
Claiming a new opcode = one commit touching registry + both enums + client
table together. Rollback = revert manifest pin + server deploy together.

## Shipping

`BunsMS.dll` rides the launcher manifest like `Kaentake.dll` does today:
new `profiles: ["kaentake"]` entries, `experimental: true` until the smoke
gate passes, no `attribution` (own code). `KAENTAKE_EXCLUSIVE` gains the new
DLL name so folder separation keeps working. Manifest `version` bump +
hash/size per release. WZ art ships as profile-tagged `.wz` entries through
the existing `publish_client.sh` flow (never regenerate `UI.nx` from v83
`UI.wz`).

## License notes

- `external/Detours` (Microsoft, MIT) + `external/WzLib` (iw2d) are
  **submodules, not vendored code** — their own license terms apply.
- Kaentake declares **no license**: reference + runtime shape only. No
  Kaentake lines are vendored in this tree (`hook.*` is clean-room,
  Kaentake-shaped; `wvs/`/`ztl/` layouts are engine facts, not creative
  expression — minimal headers only, grown on demand).
- Suite/GPLv3 components are untouched by this tree.
