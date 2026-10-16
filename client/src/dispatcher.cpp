#include "pch.h"
#include "dispatcher.h"
#include "hook.h"
#include "addresses.h"
#include "wvs/packet.h"

namespace {

constexpr int kMaxRoutes = 16;

struct Route {
    unsigned short opcode;
    PacketRouteFn fn;
};

Route g_routes[kMaxRoutes];
int g_routeCount = 0;

using ProcessPacket_t = void(__fastcall*)(void*, void*, CInPacket*);
ProcessPacket_t g_ProcessPacketOrig = reinterpret_cast<ProcessPacket_t>(addr::kClientSocket_ProcessPacket);

// Stage guard: CWvsContext+0x20B8 null means login/char-select stage.
// Opcodes 0x1D..0x7C in that state fall through to the original.
bool StageGuardBlocks(unsigned short opcode) {
    if (opcode < 0x1D || opcode > 0x7C)
        return false;
    void* ctx = *reinterpret_cast<void**>(addr::dailycheckin::kWvsContextInstance);
    if (!ctx)
        return true;
    return *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(ctx) + 0x20B8) == nullptr;
}

void __fastcall ProcessPacket_hook(void* pThis, void* edx, CInPacket* pPacket) {
    CInPacket& pkt = *pPacket;
    if (pkt.CanRead(2)) {
        unsigned short opcode = pkt.Peek2();
        if (!StageGuardBlocks(opcode)) {
            for (int i = 0; i < g_routeCount; ++i) {
                if (g_routes[i].opcode == opcode) {
                    // Offset still at the opcode (spec §3.0); the route
                    // consumes from there.
                    if (g_routes[i].fn(opcode, pPacket))
                        return; // claimed — consume, do not fall through
                    break; // handler declined — fall through to original
                }
            }
        }
    }
    g_ProcessPacketOrig(pThis, edx, pPacket);
}

} // namespace

bool RegisterPacketRoute(unsigned short opcode, PacketRouteFn fn) {
    for (int i = 0; i < g_routeCount; ++i) {
        if (g_routes[i].opcode == opcode)
            return false; // double-claim: second registration loses
    }
    if (g_routeCount >= kMaxRoutes)
        return false;
    g_routes[g_routeCount++] = Route{ opcode, fn };
    return true;
}

void InstallDispatcher() {
    ATTACH_HOOK(g_ProcessPacketOrig, ProcessPacket_hook);
}
