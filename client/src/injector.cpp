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

extern "C" __declspec(dllexport) BOOL __cdecl BunsMS_Initialize(void) {
    static volatile LONG s_done = 0;
    // One-shot: first caller runs the attach; later calls report success
    // without re-attaching. Set AFTER AttachSystemHooks returns (not before),
    // so a repeat call after a completed init is the only TRUE-without-work
    // path. NOTE (honest): AttachSystemHooks and friends return void — TRUE
    // means "init reached/completed without exception", NOT per-hook verified
    // success. The Kaentake side must treat TRUE as reached-init; per-site
    // verification is the co-load smoke pass, not this return value.
    // Contract still says main thread; the Interlocked only guards against
    // accidental double-call, not a concurrency design.
    if (InterlockedCompareExchange(&s_done, 1, 0) != 0)
        return TRUE;
    AttachSystemHooks();
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
