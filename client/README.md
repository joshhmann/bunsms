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
│   ├── dispatcher / tick (single ProcessPacket / redraw hooks)
│   ├── addresses.h      # single address table — no raw VAs elsewhere
│   ├── wvs/ + ztl/      # minimal engine layouts the features need
│   └── dailycheckin.*   # §3.1 (more modules land per slice)
├── kaentake/            # pinned upstream runtime + ordered integration patches
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

The required Kaentake runtime has a separate build tree to preserve upstream's
target names and exact dependency revisions:

```bat
cmake -S kaentake -B build-kaentake -G "Visual Studio 17 2022" -A Win32
cmake --build build-kaentake --config Release --target injector launcher
```

`kaentake/CMakeLists.txt` fetches upstream commit
`2a43a01e7f4cdd75cda08ab533049230760d7cfa` with its pinned submodules, checks
and applies the repository-owned ordered patches, then builds every upstream
module unchanged except those patches. The separate `Kaentake-runtime`
CI artifact contains only `Kaentake.exe`, `Kaentake.dll`, `Custom.wz`, and
the source/patch provenance JSON. Renderer build side-outputs are not runtime
replacements and must not overwrite the verified stock engine DLLs.

Actual Windows startup capture is an **explicit manual** `client.yml`
dispatch with `native_smoke=true`, `native_baseline_url` pointing to an
unpromoted complete native provenance JSON (`files`: `name`, `sha256`, `size`),
its exact `native_baseline_sha256`, and `native_baseline_files_url` containing
those pinned bytes. Ordinary push/PR builds do not download that baseline.
The smoke job verifies every native file and canonical executable / renderer
pins, overlays only the built Kaentake pair, Custom.wz and BunsMS.dll,
then launches the real Kaentake path under passive process/module and DBWIN
OutputDebugString capture, without attaching a debugger. It records child PIDs,
native initialization/ACK messages, natural exit codes, HWND/child text, actual client-area screenshots,
and explicitly labeled controller cleanup. A black window or DLL load alone
is not a pass; an ACK absent before credentials is recorded as absent, not
invented. The same runner makes read-only public TCP/greeting measurements
for `buns.asslorde.com:8484,7575-7577` without credentials or port changes.
Hardware/desktop/DX8 failures remain failed captures with their real
artifacts; compilation is never substituted for UI or feature proof.

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

Kaentake remains the launcher and primary runtime; placing `BunsMS.dll` beside
an unmodified upstream launcher is not a load mechanism. The patched Kaentake
DLL first completes all upstream client hooks at its post-unpack
`SetUnhandledExceptionFilter` signal (`0x00796FDD`), then loads the companion
from MapleStory.exe's directory and calls the exact exported ABI
`BOOL __cdecl BunsMS_Initialize(void)`. The companion's DllMain must not install
client hooks or its own competing bootstrap. Initialization is one-shot on
the game thread, after allocator initialization and outside DllMain; the
module stays loaded for the process lifetime. Missing/failed companion
initialization is an explicit launch failure, never a silent vanilla fallback.
Ship the patched Kaentake DLL and compatible BunsMS DLL in the same pinned
release; no dinput8 proxy is required for this path.

## License notes

- `external/Detours` (Microsoft, MIT) + `external/WzLib` (iw2d) are
  **submodules, not vendored code** — their own license terms apply.
- `kaentake/` records the user-approved pinned upstream patch build used for
  this private client; upstream credit remains with the Kaentake artifact.
- Suite/GPLv3 components are untouched by this tree.
