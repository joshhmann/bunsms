// Deferred attach bootstrap (native-runtime-review blockers, 2026-10-16).
//
// Blocker 2 (unpack timing): the staged stock PE is packed — import-time
// bytes at hook sites are ciphertext until the unpacker runs. Kaentake
// solves this by delaying client attach to the SetUnhandledExceptionFilter
// call whose return address is 0x796FDD (post-unpack, post-alloc-init;
// system.cpp:18-23). This file takes the SAME read-only tripwire: hooking
// a shared system call is Detours-composed (both hooks chain), not an
// ownership conflict — neither DLL owns SetUnhandledExceptionFilter.
// On fire (once): unhook self, run AttachSystemHooks.
//
// Blocker 1 (load path) is solved by the dinput8 proxy (see proxy/):
// the stock exe auto-loads dinput8.dll from the exe dir, which forwards
// to system and LoadLibrary()s BunsMS.dll. DllMain here does the MINIMUM
// (tripwire install only); real attach happens post-unpack via this file.

#pragma once

// Install the post-unpack tripwire. Called from DllMain (import time —
// safe: only hooks the system call, touches no game bytes).
void InstallDeferredAttach();
