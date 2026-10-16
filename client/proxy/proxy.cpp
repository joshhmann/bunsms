// dinput8 proxy loader (load-path fix; see proxy/CMakeLists.txt).
//
// Forwards the DirectInput8 entry points the game imports to the real system
// dinput8.dll, and loads BunsMS.dll from the same directory on attach.
// Only DirectInput8Create is forwarded explicitly — it is the single import
// the v83 client resolves from dinput8 (verified against the stock import
// table expectation; if a future build imports more, add forwarders here
// rather than broadening to ordinal passthrough).

#include <windows.h>

EXTERN_C IMAGE_DOS_HEADER __ImageBase;

namespace {

HMODULE g_systemDinput = nullptr;
HMODULE g_bunsDll = nullptr;

using DICreate_t = HRESULT(WINAPI*)(HINSTANCE, DWORD, REFIID, LPVOID*, LPUNKNOWN);
DICreate_t g_realCreate = nullptr;

void LoadChain() {
    wchar_t sysDir[MAX_PATH];
    GetSystemDirectoryW(sysDir, MAX_PATH);
    wchar_t sysDll[MAX_PATH];
    wsprintfW(sysDll, L"%s\\dinput8.dll", sysDir);
    g_systemDinput = LoadLibraryW(sysDll);
    if (g_systemDinput) {
        g_realCreate = reinterpret_cast<DICreate_t>(
            GetProcAddress(g_systemDinput, "DirectInput8Create"));
    }
    // BunsMS.dll from the SAME dir as this proxy (the game dir).
    wchar_t self[MAX_PATH];
    GetModuleFileNameW(reinterpret_cast<HMODULE>(&__ImageBase), self, MAX_PATH);
    wchar_t* slash = self;
    for (wchar_t* p = self; *p; ++p) {
        if (*p == L'\\' || *p == L'/')
            slash = p + 1;
    }
    *slash = 0;
    wchar_t buns[MAX_PATH];
    wsprintfW(buns, L"%sBunsMS.dll", self);
    g_bunsDll = LoadLibraryW(buns);
}

} // namespace

extern "C" __declspec(dllexport) HRESULT WINAPI DirectInput8Create(
    HINSTANCE hinst, DWORD dwVersion, REFIID riidltf, LPVOID* ppvOut, LPUNKNOWN punkOuter) {
    if (!g_realCreate)
        return E_FAIL;
    return g_realCreate(hinst, dwVersion, riidltf, ppvOut, punkOuter);
}

extern "C" BOOL WINAPI DllMain(HINSTANCE hModule, DWORD fdwReason, LPVOID /*reserved*/) {
    if (fdwReason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        LoadChain();
    }
    return TRUE;
}
