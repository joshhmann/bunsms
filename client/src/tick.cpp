#include "pch.h"
#include "tick.h"
#include "hook.h"
#include "addresses.h"
#include "dailycheckin.h"

namespace {

using CallUpdate_t = void(__thiscall*)(void*, int);
CallUpdate_t g_CallUpdateOrig = reinterpret_cast<CallUpdate_t>(addr::kWvsApp_CallUpdate);

void __fastcall CallUpdate_hook(void* pThis, void* /*edx*/, int tCurTime) {
    // Feature ticks BEFORE the stage loop (spec §2.3 order).
    DailyCheckin_Tick();
    g_CallUpdateOrig(pThis, tCurTime);
}

} // namespace

void InstallTick() {
    ATTACH_HOOK(g_CallUpdateOrig, CallUpdate_hook);
}
