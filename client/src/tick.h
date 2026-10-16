// Single per-frame driver: the ONE CWndMan::RedrawInvalidatedWindows hook
// (0x009E4547). Calls, in order: feature tick fns first, then the original.
// Documents the receive-thread vs main-thread split once: packet handlers
// fill state under mutex + raise flags; ticks do UI/layer work on the
// main thread (CWnd creation is main-thread-only).
//
// SEAM (not CallUpdate): Kaentake Detours CWvsApp::Run and its reimpl calls
// its own plain CallUpdate_hook, never native 0x009F84D0 — a tick Detour at
// CallUpdate would never execute under co-load. Both Run implementations
// call RedrawInvalidatedWindows every frame; Kaentake installs no hook
// there. One site, both profiles, zero overlap.

#pragma once

// Install the single Redraw hook. Called from AttachSystemHooks(),
// after InstallDispatcher().
void InstallTick();

// Per-frame work for the daily check-in window: invalidates the open window
// so the claimable-blink animates (main thread; no packet work here).
void DailyCheckin_Tick();
