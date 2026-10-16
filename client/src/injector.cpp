// DllMain → AttachSystemHooks (spec §2.3 ordering).
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

extern "C" __declspec(dllexport) VOID DummyExport() {}

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
        DisableThreadLibraryCalls(hModule);
        AttachSystemHooks();
        break;
    case DLL_PROCESS_DETACH:
    case DLL_THREAD_ATTACH:
    case DLL_THREAD_DETACH:
        break;
    }
    return TRUE;
}
