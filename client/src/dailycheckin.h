// Daily check-in window (spec §3.1): from the dailycheckin.zip bundle,
// rewired onto the single dispatcher (no private ProcessPacket hook).
//
// The window is server-push opened (login auto-open / @daily reply); the
// server is the source of truth. Opcodes 0x11A (C2S) / 0x17C (S2C): stock
// Send HIT_SNOWBALL shares 0x11A numerically in the opposite direction —
// not a collision, do not renumber.

#pragma once

// Install entry — registers the 0x17C route with the single dispatcher.
// Call from AttachSystemHooks() (spec §2.3 order).
bool AttachDailyCheckinMod();

// Per-frame: invalidate the open window so the claimable-blink animates.
// Main thread only.
void DailyCheckin_Tick();
