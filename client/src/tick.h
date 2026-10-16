// Single per-frame driver (spec §3.0): the ONE CWvsApp::CallUpdate hook
// (0x009F84D0). Calls, in order: feature tick fns first, then the original.
// Documents the receive-thread vs main-thread split once: packet handlers
// fill state under mutex + raise flags; ticks do UI/layer work on the
// main thread (CWnd creation is main-thread-only).

#pragma once

// Install the single CallUpdate hook. Called from AttachSystemHooks(),
// after InstallDispatcher().
void InstallTick();

// Per-frame work for the daily check-in window: invalidates the open window
// so the claimable-blink animates (main thread; no packet work here).
void DailyCheckin_Tick();
