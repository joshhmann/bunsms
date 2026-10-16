#include "pch.h"
#include "caps.h"
#include "hook.h"
#include "addresses.h"
#include "dispatcher.h"
#include "wvs/packet.h"
#include "dailycheckin.h"
#include "cashshopwnd.h"
#include "weapontint.h"
#include "damagelong.h"
#include "weather.h"
#include "coloringprism.h"
#include "lamps.h"
#include "wvs/util.h"
#include <atomic>

#ifndef CLIENT_DLL_VERSION
#define CLIENT_DLL_VERSION 0
#endif

namespace {

// Single-word accepted mask for THIS connection. Written by the ack route
// (receive thread), read by send gates. Reset on ClearSendReceiveCtx —
// a new socket means a new negotiation (contract §3, no carryover).
std::atomic<int> g_acceptedMask{0};
std::atomic<int> g_readyMask{0};
std::atomic<DWORD> g_readyThread{0};
std::atomic<bool> g_readyKnown{false};
std::atomic<int> g_connectionOffer{0};

// Once-per-connection announce flag. Set when the announce goes out,
// cleared by the ClearCtx hook on every (re)connect. Send-thread only.
std::atomic<bool> g_announced{false};

// Reentrancy guard: the announce itself goes through the ORIGINAL
// SendPacket trampoline, which must not re-enter the hook.
std::atomic<bool> g_sendingAnnounce{false};

using ClearCtx_t = void(__thiscall*)(void*);
ClearCtx_t g_ClearCtxOrig = reinterpret_cast<ClearCtx_t>(addr::kClientSocket_ClearSendReceiveCtx);

using SendPacket_t = void(__thiscall*)(void*, const COutPacket&);
SendPacket_t g_SendPacketOrig = reinterpret_cast<SendPacket_t>(addr::kClientSocket_SendPacketFn);

void* ClientSocketInstance() {
    return *reinterpret_cast<void**>(addr::dailycheckin::kClientSocketInstance);
}

void ResetFeatures() {
    DailyCheckin_Reset();
    CashShopWnd_Reset();
    WeaponTint_Reset();
    DamageLong_Reset();
    Weather_Reset();
}

void __fastcall ClearCtx_hook(void* pThis, void* /*edx*/) {
    // New connection starting: drop the old negotiation. The next outgoing
    // packet re-announces (once-flag cleared here).
    g_acceptedMask = 0;
    g_announced = false;
    g_connectionOffer = 0;
    ResetFeatures();
    g_ClearCtxOrig(pThis);
}

void SendAnnounceThroughOrig(void* sock) {
    COutPacket o(caps::kAnnounceOpcode);
    o.Encode4(static_cast<unsigned int>(CLIENT_DLL_VERSION));
    const int offered = CapsOfferedMask();
    o.Encode4(static_cast<unsigned int>(offered));
    g_connectionOffer = offered;
    g_sendingAnnounce = true;
    g_announced = true; // Publish before a fast server ACK can arrive.
    try {
        g_SendPacketOrig(sock, o);
    } catch (...) {
        g_connectionOffer = 0;
        g_announced = false;
        g_sendingAnnounce = false;
        throw;
    }
    g_sendingAnnounce = false;
}

void __fastcall SendPacket_hook(void* pThis, void* /*edx*/, const COutPacket& o) {
    // First genuine outgoing packet on this connection carries the announce
    // ahead of it through the ORIGINAL (same seq/crypto treatment, in order).
    // Hook fires only when the engine itself sends, so crypto is already up —
    // no hello/IV race. Reentrant announce send is guarded above.
    CapsPrepareReadiness();
    if (g_readyKnown && !g_announced && !g_sendingAnnounce) {
        SendAnnounceThroughOrig(pThis);
    }
    g_SendPacketOrig(pThis, o);
}

// Ack route: server replies ONLY to an announce (never unsolicited, never
// to unflagged sessions). Payload: int serverVersion + int acceptedMask.
// Unknown server version => treat mask as 0 (fail closed, stay vanilla).
bool CapsAck_Route(unsigned short opcode, CInPacket* pPacket) {
    if (opcode != caps::kAckOpcode)
        return false;
    if (!pPacket->SkipOpcode())
        return true;
    if (!g_announced) return true; // No ACK may activate an unannounced connection.
    int serverVersion = 0;
    int acceptedMask = 0;
    if (!pPacket->Decode4(serverVersion))
        return true;
    if (!pPacket->Decode4(acceptedMask))
        return true;
    const int nextMask = serverVersion == caps::kNegotiationVersion
        ? acceptedMask & g_connectionOffer.load() : 0;
    const int previousMask = g_acceptedMask.exchange(nextMask);
    if ((previousMask & ~nextMask) != 0)
        ResetFeatures();
    {
        char buf[96];
        _snprintf_s(buf, sizeof(buf), _TRUNCATE,
                    "BUNS_RUNTIME caps-ack version=%d accepted=0x%X\n",
                    serverVersion, static_cast<unsigned int>(nextMask));
        buf[sizeof(buf) - 1] = 0;
        OutputDebugStringA(buf);
    }
    return true;
}

} // namespace

int CapsAcceptedMask() {
    return g_acceptedMask.load();
}

int CapsOfferedMask() {
    return g_readyMask.load();
}

void CapsSetReadyMask(int mask) {
    g_readyMask.store(mask);
}

void CapsHooksReady() {
    // Called only after every required attach/ABI bridge/codec route succeeded.
    g_readyThread.store(GetCurrentThreadId());
}

void CapsPrepareReadiness() {
    if (g_readyKnown || g_readyThread.load() != GetCurrentThreadId()) return;
    try {
        if (!get_rm()) return;
        Ztl_variant_t value = get_rm()->GetObjectA(const_cast<wchar_t*>(L"UI/Basic.img/BtOK2/normal/0"));
        IWzCanvasPtr sentinel = get_unknown(value);
        if (!sentinel) return; // Root WZ namespace is not mounted yet.
    } catch (...) { return; }

    const bool checkin = DailyCheckin_ResourcesReady();
    const bool cash = CashShopWnd_ResourcesReady();
    const bool prism = ColorPrism_ResourcesReady();
    const bool lamps = Lamps_ResourcesReady();
    int mask = caps::kLongDamageLines; // Validated patch sites and both attack codecs attached.
    if (checkin) mask |= caps::kCheckinWindow;
    if (cash) mask |= caps::kCashshopWindow;
    if (prism) mask |= caps::kPrismSync;
    if (lamps) mask |= caps::kWeatherSync | caps::kLampPreview;
    CapsSetReadyMask(mask);
    g_readyKnown = true;
    char event[160];
    _snprintf_s(event, sizeof(event), _TRUNCATE,
        "BUNS_RUNTIME caps-ready offered=0x%X checkin=%d cash=%d prism=%d lamps=%d\n",
        mask, checkin, cash, prism, lamps);
    OutputDebugStringA(event);
}

void CapsSendAnnounce() {
    CapsPrepareReadiness();
    if (!g_readyKnown) return;
    // Manual send (diagnostic / fallback). The hook path above is primary;
    // this also resets first so a failed send can't leave a stale mask.
    g_acceptedMask = 0;
    g_announced = false;
    g_connectionOffer = 0;
    ResetFeatures();
    void* sock = ClientSocketInstance();
    if (sock)
        SendAnnounceThroughOrig(sock);
}

bool AttachCapsMod() {
    if (!RegisterPacketRoute(caps::kAckOpcode, &CapsAck_Route))
        return false;
    if (!ATTACH_HOOK(g_ClearCtxOrig, ClearCtx_hook))
        return false;
    return ATTACH_HOOK(g_SendPacketOrig, SendPacket_hook);
}
