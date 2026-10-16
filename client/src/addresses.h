// Single address table (spec §2.2). All absolute VAs live HERE, grouped by
// feature, each with its evidence note. No module hard-codes a raw address
// anywhere else. Canonical exe: stock v83 GMS, ImageBase 0x400000.
// A different exe build invalidates the whole table at once; re-find xrefs,
// never guess single addresses.
//
// Evidence key: SEH = SEH-prologue match, XREF = CALL cross-reference,
// RETN = `ret n` arity match. Sourced from each bundle's address table;
// see XREF.md for the per-address evidence record.

#pragma once
#include <cstdint>

namespace addr {

// --- Shared ---------------------------------------------------------------
inline constexpr uintptr_t kImageBase = 0x400000;

inline constexpr uintptr_t kCOutPacket_Encode4 = 0x004065A6; // shared: COutPacket::Encode4 (XREF)
inline constexpr uintptr_t kCInPacket_Decode4  = 0x00406629; // shared: CInPacket::Decode4 (XREF)

// NOTE (Kaentake-primary): get_unknown (0x00414ADA) + Ztl_variant_t::GetUnknown
// (0x004032B2) are owned SOLELY by Kaentake.dll's inlink. This tree installs
// NO hooks there — see wvs/util.h (direct engine call) and XREF co-load table.

// --- Engine allocators (owned here; ZALLOCEX in injector.cpp) --------------
inline constexpr uintptr_t kZAllocAnon      = 0x00BF0B00; // ZAllocAnonSelector (Kaentake constants)
inline constexpr uintptr_t kZAllocStrChar   = 0x00BF0A90; // ZAllocStrSelector<char>
inline constexpr uintptr_t kZAllocStrWChar  = 0x00BF0BA8; // ZAllocStrSelector<wchar_t>

// --- Negotiation hooks (owned by caps.cpp; hooked EXACTLY ONCE each) --------
// Both verified unhooked-by-Kaentake in actual sources (bypass.cpp calls
// ClearSendReceiveCtx directly at :78 and SendPacket directly at :256/:362;
// zero ATTACH_HOOK on either VA). No Kaentake fork, no Connect collision.
// ClearCtx runs pre-connect (reset only, never send — no hello/IV race);
// the SendPacket hook fires only when the engine itself sends (crypto up).
inline constexpr uintptr_t kClientSocket_ClearSendReceiveCtx = 0x004969EE; // XREF
inline constexpr uintptr_t kClientSocket_SendPacketFn = 0x0049637B; // == dailycheckin send site, shared Detour

// --- Dispatcher (owned by dispatcher.cpp; hooked EXACTLY ONCE) -------------
inline constexpr uintptr_t kClientSocket_ProcessPacket = 0x004965F1; // CClientSocket::ProcessPacket (SEH)

// --- Tick (owned by tick.cpp; hooked EXACTLY ONCE) -------------------------
// SEAM (parent-confirmed call-graph): Kaentake Detours CWvsApp::Run and its
// Run_hook calls its OWN plain CallUpdate_hook, never native 0x009F84D0 — a
// tick Detour there would never execute under co-load. BOTH Run
// implementations (native + Kaentake reimpl bypass.cpp:309) call
// CWndMan::RedrawInvalidatedWindows (0x009E4547) every frame on the main
// thread, and Kaentake installs NO hook there (verified: only a direct call).
// One site, both profiles, zero Kaentake overlap. XREF (CallUpdate row) retired.
inline constexpr uintptr_t kWndMan_RedrawInvalidatedWindows = 0x009E4547; // XREF

// --- Daily check-in (§3.1; bundle: dailycheckin.zip README + source) -------
namespace dailycheckin {
inline constexpr uintptr_t kPlayUiSound           = 0x00989588; // play_ui_sound (XREF)
inline constexpr uintptr_t kProcessBasicUIKey     = 0x00A07431; // CWvsContext::ProcessBasicUIKey (XREF)
inline constexpr uintptr_t kWvsContextInstance    = 0x00BE7918; // CWvsContext singleton (XREF)
inline constexpr uintptr_t kClientSocketInstance  = 0x00BE7914; // CClientSocket singleton (XREF)
inline constexpr uintptr_t kClientSocketSendPrint = 0x0049637B; // CClientSocket::SendPacket (XREF)
inline constexpr uintptr_t kUtilDlgNotice         = 0x009929DD; // CUtilDlg::Notice (XREF)
inline constexpr uintptr_t kGetBasicFont          = 0x0098A707; // get_basic_font (XREF)
inline constexpr uintptr_t kWzFontSetFont         = 0x0046341A; // IWzFont::SetFont (XREF)
} // namespace dailycheckin

// --- Placeholders for later slices (spec §§3.2–3.5) ------------------------
// Addresses below are RESERVED slots, not yet live: the owning modules do
// not exist in this slice. Do not hook these sites until the module lands.
// (Values transcribed from the spec §2.2 table so XREF.md stays complete.)

// coloringprism: cash-item-use dispatch — call in, NEVER second-Detour.
//   0x00A0A63F, 0x00A1DC5B, 0x004863D5
// coloringprism: CDraggableItem::OnDropped dispatch — call in, NEVER second-Detour.
//   0x004EF140
// weapontint: owns CAvatar::PrepareActionLayer outright (a second Detour
//   there silently wins/loses the swap).
//   0x00453AD1 ; cash-effect Detours 0x0093BEB9 / 0x0093C218
// damagelong: jb->jmp(0xEB) rewrites 0x0079058F / 0x00791F94 ;
//   call __ftol -> FtolDamageLine 0x00790599 / 0x00791F9E ;
//   line-store PatchJmp 0x0079059E / 0x00791FA3 (return 0x007905A3 / 0x00791FA8) ;
//   C2S Encode4 sites 0x00952B28 / 0x00955428 / 0x0095705E ;
//   S2C Decode4 sites 0x00980574 / 0x00980619 ;
//   SP-% caves 0x0079023C / 0x00790274 (owned by damagelong; QoL MUST NOT recave) ;
//   Effect_HP ZXString::Format 0x00437DFB ;
//   PDamage / MDamage-loop refs 0x0078DF87 / 0x00791864 / 0x00791FA8.
// weatherwind: wind cave 0x006406F3.
// weather/lamps: ~two-dozen table per weather IMPLEMENTATION.md appendix;
//   transcribed when the weather slice lands; re-verify on a Windows host.

} // namespace addr
