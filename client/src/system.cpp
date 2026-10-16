// One dispatcher, one main-thread frame driver, one connection reset owner.
// Attach failures propagate to BunsMS_Initialize; no partially active runtime.

#include "pch.h"
#include "hook.h"
#include "dispatcher.h"
#include "tick.h"
#include "caps.h"
#include "dailycheckin.h"
#include "cashshopwnd.h"
#include "coloringprism.h"
#include "prismdispatch.h"
#include "weapontint.h"
#include "damagelong.h"
#include "weather.h"
#include "screen.h"

// Fail-closed: false if ANY attach fails (later attaches skipped — no
// half-hooked client pretends active).
bool AttachSystemHooks() {
    if (!InstallDispatcher()) // 0x004965F1, once — before everything routing through it
        return false;
    if (!InstallTick())       // RedrawInvalidatedWindows, once (both-profiles seam)
        return false;
    if (!AttachCapsMod())     // 0x373B ack route + per-connection hooks (see caps.h)
        return false;
    if (!AttachDailyCheckinMod())
        return false;
    if (!AttachCashShopWndMod())
        return false;
    if (!AttachWeaponTintMod() || !AttachColoringPrismMod() || !AttachPrismDispatch())
        return false;
    if (!AttachDamageLongMod())
        return false;
    if (!BindWeatherViewport(GetModuleHandleW(L"Kaentake.dll")) ||
        !AttachWeatherMod() || !AttachWeatherWindMod())
        return false;
    return true;
}
