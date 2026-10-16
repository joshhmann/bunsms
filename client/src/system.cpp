// Attach ordering (spec §2.3). Dispatcher FIRST (0x004965F1, once), tick
// second (CallUpdate, once), then features in dependency order:
// damage-long before QoL/SP at shared sites; weather attach before first
// stage construction. This slice: dispatcher + tick + daily check-in only;
// later slices append their Attach*Mod() calls in the order below.

#include "pch.h"
#include "hook.h"
#include "dispatcher.h"
#include "tick.h"
#include "caps.h"

void AttachSystemHooks() {
    InstallDispatcher(); // 0x004965F1, once — before everything routing through it
    InstallTick();       // RedrawInvalidatedWindows, once (both-profiles seam)
    AttachCapsMod();       // 0x373B ack route (announce sent per-connection, see caps.h)
    AttachDailyCheckinMod();
    // Future slices (spec §2.3), in order:
    // AttachCashShopWndMod();
    // AttachColoringPrismMod() + AttachWeaponTintMod();
    // AttachDamageLongMod();   // BEFORE any QoL/SP hook at shared sites
    // AttachWeatherMod();      // AFTER dispatcher; before first stage construction
}
