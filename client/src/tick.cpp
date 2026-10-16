#include "pch.h"
#include "tick.h"
#include "hook.h"
#include "addresses.h"
#include "dailycheckin.h"

namespace {

using Redraw_t = void(__cdecl*)(void);
Redraw_t g_RedrawOrig = reinterpret_cast<Redraw_t>(addr::kWndMan_RedrawInvalidatedWindows);

void __cdecl Redraw_hook() {
    // Feature ticks BEFORE the redraw (same §2.3 order the CallUpdate
    // hook used: daily check-in first; later slices append here).
    DailyCheckin_Tick();
    g_RedrawOrig();
}

} // namespace

void InstallTick() {
    ATTACH_HOOK(g_RedrawOrig, Redraw_hook);
}
