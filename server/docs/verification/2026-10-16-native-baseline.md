# Native baseline receipt — 2026-10-16

Source: uninstrumented paired build, tested commit
`5e07f9cab0aa9c66ed05f3921c1b83308b81d242` (branch
`native-kaentake-compat`, final `ea0316d` removes only the unused
diagnostic patch). Upstream pinned `2a43a01e7f4cdd75cda08ab533049230760d7cfa`
with own pinned Detours/WzLib. Full report:
`/tmp/native-kaentake-integration-report.md`.

Windows run: https://github.com/joshhmann/bunsms/actions/runs/38876760186
— code build + pinned Kaentake build + opcode gate PASSED; full UI smoke
FAILED, correctly (login-server-unreachable error UI, no TCP contact).
Game PID 4848 emitted BUNS_RUNTIME initialize-enter + initialize-success;
modules Kaentake `0x75450000`, stock GR2D `0x50400000`, BunsMS
`0x74BF0000` observed. Staged artifacts: Kaentake.exe
`081b9542…`, Kaentake.dll `29a33d18…`, Custom.wz `79180961…`, BunsMS.dll
`f2f78ca0…`; stock exe `ed5a6994…` (4,286,088 B), stock renderer
`ab1c9422…`. Baseline manifest `a23ed491…` (51 files, candidate-6 dir).

Unobserved (NOT proved): ACK, login, world entry, D3D rendering, feature
behavior, announce send, successful server connection, remote socket
destination. Public game-port activation deferred by user; unchanged
public ports not re-probed. No production Java/DB/assets/Caddy changed.

Wine (from `/tmp/linux-compat-plan.md` + native report §Wine):
Wine 9.0~repack-4build3, isolated win32 prefix, Xvfb :99,
LIBGL_ALWAYS_SOFTWARE=1; 32-bit notepad renders (screenshot on file).
Stock exe: Win32 GDI window + START GAME button ONLY (not login/world/D3D).
Kaentake: pre-graphics failure (pattern-scan context; live bytes at
base+0x2E1B exact, scan-context/timing not bytes). Valid socket
destination, login, move, chat NOT observed (isol8/9 traces invalid;
+relay may miss raw syscalls — unobserved, not proof of zero).
