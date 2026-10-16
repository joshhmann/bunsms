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

// --- Cash-shop window: native calls only, no feature detours ----------------
namespace cashshop {
inline constexpr uintptr_t kClientSocketInstance = 0x00BE7914;
inline constexpr uintptr_t kClientSocketSendPacket = 0x0049637B;
inline constexpr uintptr_t kPlayUiSound = 0x00989588;
inline constexpr uintptr_t kSetFont = 0x0046341A;
inline constexpr uintptr_t kProcessBasicUIKey = 0x00A07431;
inline constexpr uintptr_t kWvsContextInstance = 0x00BE7918;
inline constexpr uintptr_t kCurrentStage = 0x00BEDED4;
inline constexpr uintptr_t kInputSystem = 0x00BEC33C;
inline constexpr uintptr_t kGetCursorPos = 0x0059A388;
inline constexpr uintptr_t kZRefAvatarAlloc = 0x00428967;
inline constexpr uintptr_t kZRefAvatarRelease = 0x00428C15;
inline constexpr uintptr_t kAvatarLookConstructor = 0x004283FE;
inline constexpr uintptr_t kAvatarInit = 0x0045149F;
inline constexpr uintptr_t kMakeMoveAction = 0x00426626;
inline constexpr uintptr_t kAvatarSetMoveAction = 0x004520F1;
inline constexpr uintptr_t kAvatarSetActionCode = 0x004571AB;
inline constexpr uintptr_t kGetActionNameFromCode = 0x004A8CE6;
inline constexpr uintptr_t kAvatarUpdate = 0x004522A6;
inline constexpr uintptr_t kAvatarSetEmotion = 0x00451CF6;
inline constexpr uintptr_t kCurrentField = 0x00BEBF6C;
inline constexpr uintptr_t kCreateAnimLayer = 0x0043EA3E;
inline constexpr uintptr_t kFuncKeyMappedMan = 0x00BED5A0;
inline constexpr uintptr_t kWndManInstance = 0x00BEC20C;
inline constexpr uintptr_t kWndManSetFocus = 0x009E3264;
}

// --- Prism: verified static Angel image ABI; live byte guards remain required.
namespace prism {
inline constexpr uintptr_t kWvsContext = 0x00BE7918;
inline constexpr uintptr_t kClientSocket = 0x00BE7914;
inline constexpr uintptr_t kSendPacket = 0x0049637B;
inline constexpr uintptr_t kUserLocal = 0x00BEBF98;
inline constexpr uintptr_t kUserPool = 0x00BEBFA8;
inline constexpr uintptr_t kGetUser = 0x009716ED;
inline constexpr uintptr_t kActionMan = 0x00BE78D4;
inline constexpr uintptr_t kSkillInfo = 0x00BE78DC;
inline constexpr uintptr_t kFuncKeyMapped = 0x00BED5A0;
inline constexpr uintptr_t kCurrentField = 0x00BEBF6C;
inline constexpr uintptr_t kUserAvatarVtable = 0x00B3CE7C;
inline constexpr uintptr_t kLocalAvatarVtable = 0x00B3D1CC;
inline constexpr uintptr_t kRemoteAvatarVtable = 0x00B3D858;
inline constexpr uintptr_t kCharacterGetItem = 0x004282F7;
inline constexpr uintptr_t kSecureIntGet = 0x0042873D;
inline constexpr uintptr_t kItemRefDestroy = 0x00428A50;
inline constexpr uintptr_t kEquipDataPath = 0x005C94A1;
inline constexpr uintptr_t kAvatarRefAlloc = 0x00428967;
inline constexpr uintptr_t kAvatarRefRelease = 0x00428C15;
inline constexpr uintptr_t kAvatarLookCtor = 0x004283FE;
inline constexpr uintptr_t kAvatarInit = 0x0045149F;
inline constexpr uintptr_t kAvatarUpdate = 0x004522A6;
inline constexpr uintptr_t kAvatarSetMoveAction = 0x004520F1;
inline constexpr uintptr_t kAvatarSetActionCode = 0x004571AB;
inline constexpr uintptr_t kClearActionLayer = 0x00453A29;
inline constexpr uintptr_t kGetCurrentAction = 0x00451E4C;
inline constexpr uintptr_t kActionNameFromCode = 0x004A8CE6;
inline constexpr uintptr_t kCreateAnimLayer = 0x0043EA3E;
inline constexpr uintptr_t kGetSkillLevel = 0x007616F6;
inline constexpr uintptr_t kSetActiveEffectItem = 0x0093B6A7;
inline constexpr uintptr_t kPrepareActionLayer = 0x00453AD1;
inline constexpr uintptr_t kPrepareFaceLayer = 0x00453696;
inline constexpr uintptr_t kShowEffectItem = 0x0093BEB9;
inline constexpr uintptr_t kShowFollowEffectItem = 0x0093C218;
inline constexpr uintptr_t kShowSkillEffect = 0x00933990;
inline constexpr uintptr_t kShowSkillPrepare = 0x0093640B;
inline constexpr uintptr_t kShowSkillSpecialEffect = 0x00936528;
inline constexpr uintptr_t kMobOnHit = 0x00668B83;
inline constexpr uintptr_t kTryMeleeAttack = 0x00950921;
inline constexpr uintptr_t kTryShootAttack = 0x009537D5;
inline constexpr uintptr_t kTryMagicAttack = 0x0095571F;
inline constexpr uintptr_t kCreateBullet = 0x00435DF3;
inline constexpr uintptr_t kSkillOnDropped = 0x004FAA22;
// Sole central cash-use/item-drop owner: prismdispatch.cpp.
inline constexpr uintptr_t kConsumeCashItemType = 0x004863D5;
inline constexpr uintptr_t kConsumeCashItemUse = 0x00A0A63F;
inline constexpr uintptr_t kEtcCashItemUse = 0x00A1DC5B;
inline constexpr uintptr_t kItemOnDropped = 0x004EF140;
// Angel constructors: CUIItem 81C4A6, CUIEquip 7FDF0D write handler vptrs.
inline constexpr uintptr_t kInventoryHandlerVtable = 0x00B390BC;
inline constexpr uintptr_t kEquipHandlerVtable = 0x00B3899C;
}

// --- Long damage: sole width/store/remote/SP/format owner -------------------
namespace damagelong {
inline constexpr uintptr_t kPDamageGate = 0x0079058F;
inline constexpr uintptr_t kMDamageGate = 0x00791F94;
inline constexpr uintptr_t kPDamageFtol = 0x00790599;
inline constexpr uintptr_t kMDamageFtol = 0x00791F9E;
inline constexpr uintptr_t kPDamageStore = 0x0079059E;
inline constexpr uintptr_t kMDamageStore = 0x00791FA3;
inline constexpr uintptr_t kPDamageStoreReturn = 0x007905A3;
inline constexpr uintptr_t kMDamageStoreReturn = 0x00791FA8;
inline constexpr uintptr_t kMeleeEncode = 0x00952B28;
inline constexpr uintptr_t kShootEncode = 0x00955428;
inline constexpr uintptr_t kMagicEncode = 0x0095705E;
inline constexpr uintptr_t kMesoDecode = 0x00980574;
inline constexpr uintptr_t kNormalDecode = 0x00980619;
inline constexpr uintptr_t kPartnerPercent = 0x0079023C;
inline constexpr uintptr_t kPartnerPercentAlt = 0x00790274;
inline constexpr uintptr_t kPartnerReturn = 0x0079024B;
inline constexpr uintptr_t kPartnerAltReturn = 0x00790283;
inline constexpr uintptr_t kPDamage = 0x0078DF87;
inline constexpr uintptr_t kMDamageInit = 0x00791864;
inline constexpr uintptr_t kMDamageInitReturn = 0x0079186A;
inline constexpr uintptr_t kRemoteAttack = 0x009803AB;
inline constexpr uintptr_t kDamageFormatCall = 0x00437DFB;
inline constexpr uintptr_t kDamageFormat = 0x00445B4B;
inline constexpr uintptr_t kStringAssign = 0x00414617;
inline constexpr uintptr_t kNativeFtol = 0x00A62018;
inline constexpr uintptr_t kVanillaLineCap = 0x00AFE8A0;
}

// --- Weather/lamp calls and sole native hook sites -------------------------
namespace weather {
inline constexpr uintptr_t CreateLayer = 0x00426C7E;
inline constexpr uintptr_t LoadMap = 0x00639B3D;
inline constexpr uintptr_t Update = 0x006399EF;
inline constexpr uintptr_t RestoreTile = 0x0063A100;
inline constexpr uintptr_t RestoreObj = 0x0063AA7E;
inline constexpr uintptr_t RestoreBack = 0x0063CBBA;
inline constexpr uintptr_t MakeBack = 0x0063CD4E;
inline constexpr uintptr_t MakeObj = 0x0063AD16;
inline constexpr uintptr_t OnNpcEnterField = 0x006D9993;
inline constexpr uintptr_t CurrentFieldId = 0x00A1238B;
inline constexpr uintptr_t UserLocal = 0x00BEBF98;
inline constexpr uintptr_t PhysicalSpace = 0x00BEBFA0;
inline constexpr uintptr_t GetFootholdUnderneath = 0x00A45585;
inline constexpr uintptr_t CreateAnimLayer = 0x0043EA3E;
inline constexpr uintptr_t BlowWeather = 0x00534A35;
inline constexpr uintptr_t RemoveWeather = 0x00641AEB;
inline constexpr uintptr_t PlaySE = 0x0043FB25;
inline constexpr uintptr_t StopSE = 0x00773156;
inline constexpr uintptr_t SoundMan = 0x00BEBF94;
inline constexpr uintptr_t WindSite = 0x006406F3;
inline constexpr uintptr_t FallDistanceImmediate = 0x006406FC;
inline constexpr uintptr_t FieldRtti = 0x00BED758;
}

} // namespace addr
