#include "pch.h"
#include "bootstrap.h"
#include "hook.h"
#include <windows.h>
#include <detours.h>

namespace {

// Post-unpack tripwire site (same signal Kaentake uses; see header for why
// sharing it is safe). Return address 0x796FDD = ZExceptionHandler ctor,
// after dynamic initializers for ZAllocEx<T>::_s_alloc and after unpack.
inline constexpr uintptr_t kUnpackTripReturn = 0x796FDD;

using SEF_t = LPTOP_LEVEL_EXCEPTION_FILTER(WINAPI*)(LPTOP_LEVEL_EXCEPTION_FILTER);
SEF_t g_SEFOrig = reinterpret_cast<SEF_t>(GetAddress("KERNEL32", "SetUnhandledExceptionFilter"));

volatile bool g_attached = false;

LPTOP_LEVEL_EXCEPTION_FILTER WINAPI SEF_hook(LPTOP_LEVEL_EXCEPTION_FILTER lpFilter) {
    // _ReturnAddress is MSVC-intrinsic (intrin.h via pch.h).
    if (!g_attached && reinterpret_cast<uintptr_t>(_ReturnAddress()) == kUnpackTripReturn) {
        g_attached = true;
        // One-shot: restore the system call first, then attach to unpacked bytes.
        DetourTransactionBegin();
        DetourUpdateThread(GetCurrentThread());
        DetourDetach(reinterpret_cast<void**>(&g_SEFOrig), CastHook(&SEF_hook));
        DetourTransactionCommit();
        AttachSystemHooks();
    }
    return g_SEFOrig(lpFilter);
}

} // namespace

void InstallDeferredAttach() {
    ATTACH_HOOK(g_SEFOrig, SEF_hook);
}
