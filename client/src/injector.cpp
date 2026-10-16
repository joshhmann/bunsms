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
#include "bootstrap.h"
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
    // One-shot idempotent: first caller wins, later calls report success
    // without re-attaching (Interlocked keeps it race-safe if ever invoked
    // off the main thread by mistake — contract still says main thread).
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
