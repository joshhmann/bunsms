#include "pch.h"
#include "caps.h"
#include "hook.h"
#include "addresses.h"
#include "dispatcher.h"
#include "wvs/packet.h"

#ifndef CLIENT_DLL_VERSION
#define CLIENT_DLL_VERSION 0
#endif

namespace {

// Single-word accepted mask for THIS connection. Written by the ack route
// (receive thread), read by send gates. Reset on ClearSendReceiveCtx —
// a new socket means a new negotiation (contract §3, no carryover).
volatile int g_acceptedMask = 0;

// Once-per-connection announce flag. Set when the announce goes out,
// cleared by the ClearCtx hook on every (re)connect. Send-thread only.
volatile bool g_announced = false;

// Reentrancy guard: the announce itself goes through the ORIGINAL
// SendPacket trampoline, which must not re-enter the hook.
volatile bool g_sendingAnnounce = false;

using ClearCtx_t = void(__thiscall*)(void*);
ClearCtx_t g_ClearCtxOrig = reinterpret_cast<ClearCtx_t>(addr::kClientSocket_ClearSendReceiveCtx);

using SendPacket_t = void(__thiscall*)(void*, const COutPacket&);
SendPacket_t g_SendPacketOrig = reinterpret_cast<SendPacket_t>(addr::kClientSocket_SendPacketFn);

void* ClientSocketInstance() {
    return *reinterpret_cast<void**>(addr::dailycheckin::kClientSocketInstance);
}

void __fastcall ClearCtx_hook(void* pThis, void* /*edx*/) {
    // New connection starting: drop the old negotiation. The next outgoing
    // packet re-announces (once-flag cleared here).
    g_acceptedMask = 0;
    g_announced = false;
    g_ClearCtxOrig(pThis);
}

void SendAnnounceThroughOrig(void* sock) {
    COutPacket o(caps::kAnnounceOpcode);
    o.Encode4(static_cast<unsigned int>(CLIENT_DLL_VERSION));
    o.Encode4(static_cast<unsigned int>(CapsOfferedMask()));
    g_sendingAnnounce = true;
    g_SendPacketOrig(sock, o);
    g_sendingAnnounce = false;
    g_announced = true;
}

void __fastcall SendPacket_hook(void* pThis, void* /*edx*/, const COutPacket& o) {
    // First genuine outgoing packet on this connection carries the announce
    // ahead of it through the ORIGINAL (same seq/crypto treatment, in order).
    // Hook fires only when the engine itself sends, so crypto is already up —
    // no hello/IV race. Reentrant announce send is guarded above.
    if (!g_announced && !g_sendingAnnounce) {
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
    int serverVersion = 0;
    int acceptedMask = 0;
    if (!pPacket->Decode4(serverVersion))
        return true;
    if (!pPacket->Decode4(acceptedMask))
        return true;
    if (serverVersion != caps::kNegotiationVersion) {
        g_acceptedMask = 0;
        return true;
    }
    // Accept only bits we actually offered (server must AND, but belt-and-
    // braces: never enable a feature whose module is absent).
    g_acceptedMask = acceptedMask & CapsOfferedMask();
    return true;
}

} // namespace

int CapsAcceptedMask() {
    return g_acceptedMask;
}

int CapsOfferedMask() {
    // ONLY bits whose modules are present. Today: the check-in window alone.
    // Append bits here exactly when their module + server support both land.
    return caps::kCheckinWindow;
}

void CapsSendAnnounce() {
    // Manual send (diagnostic / fallback). The hook path above is primary;
    // this also resets first so a failed send can't leave a stale mask.
    g_acceptedMask = 0;
    g_announced = false;
    void* sock = ClientSocketInstance();
    if (sock)
        SendAnnounceThroughOrig(sock);
}

void AttachCapsMod() {
    RegisterPacketRoute(caps::kAckOpcode, &CapsAck_Route);
    ATTACH_HOOK(g_ClearCtxOrig, ClearCtx_hook);
    ATTACH_HOOK(g_SendPacketOrig, SendPacket_hook);
}
