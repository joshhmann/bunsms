#include "pch.h"
#include "tick.h"
#include "hook.h"
#include "addresses.h"
#include "dailycheckin.h"
#include "cashshopwnd.h"
#include "weapontint.h"
#include "damagelong.h"
#include "weather.h"

namespace {

using Redraw_t = void(__cdecl*)(void);
Redraw_t g_RedrawOrig = reinterpret_cast<Redraw_t>(addr::kWndMan_RedrawInvalidatedWindows);

void __cdecl Redraw_hook() {
    // UI windows retain their sole native CWndMan::Update driver.
    DailyCheckin_Tick();
    CashShopWnd_Tick();
    WeaponTint_Tick();
    DamageLong_Frame();
    Weather_Frame();
    g_RedrawOrig();
}

} // namespace

bool InstallTick() {
    return ATTACH_HOOK(g_RedrawOrig, Redraw_hook);
}
