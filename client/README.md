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
│   └── dailycheckin / cashshop / prism / damagelong / weather / lamps
├── kaentake/            # pinned upstream runtime + ordered integration patches
└── tools/
    └── check_opcodes.py # opcode drift gate (runs in client.yml)
```

## Status (slices)

- Source integration: check-in, cash shop, prism, long damage, weather and lamps
  share the sole dispatcher/frame/reset owners. Kaentake retains inlink/UOL,
  native window updates, item effects and its resolution hooks.
- Windows run `38895009865`, source `ccbfed1`: check-in/cash/prism/long companion
  `/W4 /WX`, paired Kaentake, exact companion/prism exports, CRT and opcode gates
  passed. Weather was integrated last after that toolchain result.
- Full UI/gameplay acceptance remains **pending**; these build/ABI observations
  are not proof of login/world, purchases, tint, long combat, weather or reconnect.

## Build (Windows host + VS2022 + CMake)

```bat
cmake --preset release-win32
cmake --build --preset release-win32
```

`build/Release/BunsMS.dll` and its matching `.pdb` are published together.
Optimized Release keeps `/OPT:REF`, `/OPT:ICF` and `/INCREMENTAL:NO`, adds `/Zi`
debug information and links `/DEBUG:FULL`. CI inspects exact case-sensitive
export names and DUMPBIN `/PDBPATH` correspondence. Use the pair from the same
build; new symbols do not retroactively match an older pinned runtime.
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

Fresh Windows folders also require the `MSVC-x86-runtime` artifact. Its
collection step accepts only genuine Microsoft-signed PE32 VC143 app-local
redistributable DLLs and records their exact versions, sizes and SHA256 pins.
Ship that payload beside the client, with its provenance JSON in the complete
file manifest. Do not rely on the developer/CI machine's installed runtime.
The build retains its existing dynamic CRT ABI; it does not change engine
allocator or COM ownership. Windows 10 or later supplies the system UCRT/API
sets. No fake runtime shim, system DLL replacement or registry install is used.

The native default host is `buns.asslorde.com`. A single Winsock
`connect`/`getpeername`/`closesocket` owner is installed at the post-unpack seam,
not in DllMain; provider-SPI interception is not used. Only the original Nexon
destinations are redirected. Configured hostnames resolve to IPv4 once on the
actual ready socket path; numeric QA overrides take the literal fast path.
Failure returns a Winsock error without Nexon/LAN fallback. Peer identity is
remembered per redirected socket and removed on close; other channel targets
remain unchanged. Stored host text and configuration precedence are retained.

Actual Windows startup capture is an **explicit manual** `client.yml`
dispatch with `native_smoke=true`, `native_baseline_url` pointing to an
unpromoted complete native provenance JSON (`files`: `name`, `sha256`, `size`),
its exact `native_baseline_sha256`, and `native_baseline_files_url` containing
those pinned bytes. Ordinary push/PR builds do not download that baseline.
The smoke job verifies every native file and canonical executable / renderer
pins, overlays the built Kaentake pair, Custom.wz, BunsMS.dll and pinned app-local CRT,
then launches the real Kaentake path under passive process/module and DBWIN
OutputDebugString capture, without attaching a debugger. It records child PIDs,
native initialization/ACK messages, natural exit codes, HWND/child text, actual client-area screenshots,
and explicitly labeled controller cleanup. A black window or DLL load alone
is not a pass; an ACK absent before credentials is recorded as absent, not
invented. Public port activation is intentionally deferred; these captures do
not re-probe unchanged public ports or substitute a LAN/VPN default.
Hardware/desktop/DX8 failures remain failed captures with their real
artifacts; compilation is never substituted for UI or feature proof.

The isolated QA helper starts only its owned Java/MySQL processes with normal
Windows hidden-window startup, retaining stdout/stderr, PID identities and
concurrent listener observations. This prevents their consoles from competing
with ordinary game input; it does not hide, elevate or force-focus the game.
Run `38979821934` reached the real native character chooser after normal
login, Terms, gender and channel input. It remains an internal control, not
full-content world/gameplay acceptance or a Windows backend deployment plan.
The opt-in `exercise_login` path reserves ten minutes for ordinary
account menus; this does not extend the startup-only A/B controls or turn an
unfinished character/world flow into a pass.

The testing launcher's packaged release metadata pins the complete Kaentake
cohort separately from the existing Stock patch API. Stock updates require an
already installed game client; their managed patch list is not a complete-client
certificate or a second full-client delivery. Both paths capture the profile,
directory and authoritative file snapshot in a one-use install lease before
asynchronous transfer. Existing user INI host/resolution sections are preserved;
Kaentake still requires its full dependency manifest and pinned provenance.

## Paired release (§5)

Client runtime and assets must be qualified against the matching server.
Capability contract v1 uses C2S `0x373A` (DLL version and offered mask) and
reply-only S2C `0x373B` (negotiation version and accepted mask). Each new
connection starts legacy/zero; custom wire behavior requires the accepted
intersection, never just a compiled version or successful DLL initialization.
The client defers its offer until real hook/data prerequisites are ready without
blocking ordinary stock packets. Full-feature qualification still requires the
actual offer/ACK and feature paths; the published zero-mask control is not a
release fallback.
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

### Full-content Windows testing launcher

The `1.1.0-rc.6` Electron launcher uses a separate `com.bunsms.launcher.rc`
application identity and is visibly labeled **TESTING**, not a production
server/database rollout. Its packaged `release-config.json` pins the immutable
RC complete-client manifest; workflow operator inputs are written into this
packaged file, not incorrectly assumed to survive as build-time environment.
The canonical game host remains `buns.asslorde.com`; approved explicit test
overrides and existing valid INI host/port/resolution choices are preserved.

#### Current manual Windows LAN test

[Download the Windows TESTING RC 1.1.0-rc.6 installer](https://buns.asslorde.com/rc-assets/client/r/8c224127defe00ec87f4d1c9bfd04c41e9af6dd5ef03b8b9821176b5fc6c7c40/windows/BunsMS-Testing-RC-1.1.0-rc.6.exe)
(83,844,007 bytes, **unsigned**; SHA256
`8c224127defe00ec87f4d1c9bfd04c41e9af6dd5ef03b8b9821176b5fc6c7c40`).
The matching persistent Linux development server is `192.168.0.164`; this
explicit LAN override is not a failover or a change to the canonical default.
Its backed-up existing accounts/characters were preserved.

1. Install/open **BunsMS Testing RC** and select **Kaentake TESTING RC**.
2. Use the folder button to select a dedicated RC folder, not an existing Stock
   folder. Let all 65 managed files download and verify as version `1.1.0-rc.6`.
3. On the same LAN, set **Server Address** to `192.168.0.164`, then press **PLAY**.
   Allow only the game's ordinary Windows UAC prompt; do not disable security
   software or elevate the whole launcher as a workaround.
4. Log in with an existing Cosmic account, select a character/channel, and use
   the normal on-screen mouse keypad for PIC entry.
5. Check world rendering, walk/jump, send a chat message, then reconnect. Report
   the last successful screen and exact error; do not share passwords or PICs.

Observed CI covers the actual installed full65 transfer/OS launch and native
account/default-character/world entry, ordinary walk/jump and rendered general
chat on the matching loopback pair. Native addon UI/gameplay/reconnect and
all-family acceptance remain separate checks, not a fully qualified release
claim. Daily's current one-meso donor table is diagnostic only: real reward
policy and failure-safe reward delivery are still required for finished Daily.
Windows 10/11 compatibility has not been exercised; the observed CI OS is
Server 2022.
Players do not install Java, MySQL or Docker. The development server retains an
open optional AdminAPI rate/message-persistence warning; live YAML rates remain
active, and it is not evidence of a native login/world failure.


A complete manifest plus its SHA256-pinned provenance must authorize every
required managed game/engine/runtime file. Check results carry a one-use,
profile/folder/manifest lease: changing profiles or install paths during a
transfer cannot redirect that transfer. Renderer URLs/hashes are never download
authority. Transfers and hashes stream; size and SHA256 are verified on a
temporary file before atomic replacement, preserving old usable bytes on failure.
The mutable profile-owned INI is verified by schema, not forcibly restored to
publisher defaults. Windows launch reports actual OS creation/error through
the game's ordinary UAC flow; no blanket launcher elevation or AV-disable advice.

`npm test` in `launcher/` exercises manifest policy and real local HTTP/file
transfer regressions. The standalone installer workflow additionally installs
and captures the real Windows Electron UI. These are launcher checks, not native
playability acceptance. Java/MySQL are used only by the isolated same-runner CI
backend helper; players retain the existing Linux-hosted server deployment and
never install a backend with the launcher.

The opt-in native `exercise_login` check additionally requires the owned fresh
schema's QA account to be absent before ordinary credential input, then observes
that expected account authenticated through the real server's read-only state.
Submitted keys alone are not a pass. Account `loggedin = 2` is authentication,
not character/world entry; inspect the actual native UI and exercise world,
movement/chat and feature paths separately. Startup-only mode remains explicitly
limited to startup. A legitimate existing-character login is an independent
consumer path, not a substitute for the fresh native creation case.

News `type` and `text` are untrusted plaintext: the renderer creates DOM elements
and assigns `textContent`, never interpolates those fields as markup. The
installer workflow's `news_security_smoke` mode consumes a pinned, canonical
HTTPS news fixture through the real installed preload/renderer and checks literal
text plus an inert benign execution marker. Run `38941281591` reproduced marker
execution before the repair; `38941631111` verified literal rendering, zero
executable news elements and no marker execution after it. This was observed on
Windows Server 2022 build 20348, not a Windows 10/11 compatibility claim.

Mutable INI reads and writes honor section ownership: Kaentake routing belongs
to `[config]`; stock routing/display settings belong to `[general]`, and stock
sleep timing to `[debug]`. Same-named keys in auxiliary sections neither satisfy
configuration preflight nor get rewritten. Regression tests cover auxiliary
bytes, mixed-case sections, CRLF, resolution and explicit QA-port preservation.
The corrected installer and final full matched asset cohort still require the
complete download/launch and native gameplay qualification described above.

### Native feature readiness

Successful hook/route/ABI installation permits a main-thread prerequisite probe,
not an unconditional feature offer. The probe waits for the real mounted WZ
namespace, validates check-in/cash/prism art and native geometry, and resolves the
lamp/glow resources directly from the consumer's lamp table. Only ready features
are announced; ACKs are bounded by that connection's actual offer, and reconnect
clears all accepted state. Missing authored art must be fixed, not replaced by
primitives or hidden behind a permanent zero offer. A full matched RC must
demonstrate all accepted bits and their real gameplay paths, including legacy
and reconnect behavior; a compiler, login screen, or zero-mask ACK is not that proof.

## License notes

- `external/Detours` (Microsoft, MIT) + `external/WzLib` (iw2d) are
  **submodules, not vendored code** — their own license terms apply.
- `kaentake/` records the user-approved pinned upstream patch build used for
  this private client; upstream credit remains with the Kaentake artifact.
- Suite/GPLv3 components are untouched by this tree.
