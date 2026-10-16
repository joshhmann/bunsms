// Load interface (Kaentake→BunsMS explicit handoff; native-owner integrated).
// Kaentake LoadLibraryW()s this DLL from the game dir and calls
// BunsMS_Initialize() AFTER its AttachClientHooks returns at 0x796FDD
// (post-unpack, main thread). DllMain does NOTHING but
// DisableThreadLibraryCalls — no independent tripwire (bootstrap.* retired
// after cutover). One-shot idempotent: successful init returns TRUE; load or
// entry failure on the Kaentake side fails closed (no pretend-active client).
// Ships as BunsMS.dll (locked name; OUTPUT_NAME in src/CMakeLists.txt).

#include "pch.h"
#include "hook.h"
#include "addresses.h"
#include "dispatcher.h"
#include "tick.h"
#include "dailycheckin.h"
#include "ztl/ztl.h"
#include <windows.h>

ZALLOC_GLOBAL
ZALLOCEX(ZAllocAnonSelector, addr::kZAllocAnon)
ZALLOCEX(ZAllocStrSelector<char>, addr::kZAllocStrChar)
ZALLOCEX(ZAllocStrSelector<wchar_t>, addr::kZAllocStrWChar)

// Init tri-state (load contract): 0 = not run, 1 = success, 2 = failed.
// Failed stays FALSE forever (no retry of partially installed hooks).
// AttachSystemHooks returns bool — every spine attach propagates failure.
static volatile LONG g_initState = 0;
extern "C" __declspec(dllexport) BOOL __cdecl BunsMS_Initialize(void) {
    // Main-thread-only contract; the Interlocked guards accidental double-call.
    LONG prev = InterlockedCompareExchange(&g_initState, 1, 0);
    OutputDebugStringA("BUNS_RUNTIME initialize-enter\n");
    if (prev == 1)
        return TRUE;  // completed init — success without re-attaching (no second marker)
    if (prev == 2) {
        OutputDebugStringA("BUNS_RUNTIME initialize-failure\n");
        return FALSE; // failed init — fail closed, do not retry partial hooks
    }
    if (!AttachSystemHooks()) {
        g_initState = 2;
        OutputDebugStringA("BUNS_RUNTIME initialize-failure\n");
        return FALSE;
    }
    OutputDebugStringA("BUNS_RUNTIME initialize-success\n");
    return TRUE;
}

// Paired-release version stamp (spec §5): CLIENT_DLL_VERSION comes from
// client/CMakeLists.txt (-D). The handshake field that carries it to the
// server is still open (parent question §5); until the server-side receiver
// lands, the version is compiled in and queryable here, never silently
// downgraded.
int GetClientDllVersion() {
#ifdef CLIENT_DLL_VERSION
    return CLIENT_DLL_VERSION;
#else
    return 0;
#endif
}

BOOL WINAPI DllMain(HINSTANCE hModule, DWORD fdwReason, LPVOID /*lpvReserved*/) {
    switch (fdwReason) {
    case DLL_PROCESS_ATTACH:
        // Load interface cutover (native-owner integrated): DllMain does
        // NOTHING but DisableThreadLibraryCalls. Kaentake calls
        // BunsMS_Initialize() post-unpack; the independent SEH tripwire
        // (bootstrap.*) is retired — no dual hooks on the shared syscall.
        DisableThreadLibraryCalls(hModule);
        break;
    case DLL_PROCESS_DETACH:
    case DLL_THREAD_ATTACH:
    case DLL_THREAD_DETACH:
        break;
    }
    return TRUE;
}
