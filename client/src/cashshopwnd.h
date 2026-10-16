#pragma once

// Paired with CASHSHOP_WINDOW_ACTION / CASHSHOP_WINDOW_SYNC on the server.
inline constexpr unsigned short kCashShopActionOpcode = 0x3730;
inline constexpr unsigned short kCashShopSyncOpcode = 0x3731;

// Installs only the route in the shared dispatcher; false is fatal to attach.
bool AttachCashShopWndMod();

// Main-thread driver, called by the single RedrawInvalidatedWindows tick owner.
// Native CWndMan::Update drives the registered window's Update/preview once;
// this function only consumes the receive mailbox and opens/closes UI.
void CashShopWnd_Tick();

// Called by the sole connection-reset owner after clearing accepted caps.
// Receive-safe: publishes teardown; UI destruction is deferred to Tick.
void CashShopWnd_Reset();

bool CashShopWnd_ResourcesReady();
