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
// (receive thread), read by send gates. Reset on every announce send —
// a new socket means a new negotiation (contract §3, no carryover).
volatile int g_acceptedMask = 0;

void* ClientSocketInstance() {
    return *reinterpret_cast<void**>(addr::dailycheckin::kClientSocketInstance);
}

void SendPacket(const COutPacket& o) {
    void* sock = ClientSocketInstance();
    if (sock) {
        auto send = reinterpret_cast<void(__thiscall*)(void*, const COutPacket&)>(
            addr::dailycheckin::kClientSocketSendPrint);
        send(sock, o);
    }
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
    // New socket => new negotiation. Reset BEFORE sending so a failed send
    // can't leave a stale mask from the previous connection.
    g_acceptedMask = 0;
    COutPacket o(caps::kAnnounceOpcode);
    o.Encode4(static_cast<unsigned int>(CLIENT_DLL_VERSION));
    o.Encode4(static_cast<unsigned int>(CapsOfferedMask()));
    SendPacket(o);
}

void AttachCapsMod() {
    RegisterPacketRoute(caps::kAckOpcode, &CapsAck_Route);
}
