// Single packet dispatcher (spec §3.0): the ONE CClientSocket::ProcessPacket
// hook (0x004965F1). Every feature registers an opcode route; no feature
// touches the ProcessPacket site directly.
//
// Packet is handed to handlers with offset STILL AT the opcode: handlers
// skip it themselves (cashshop Reader::Skip2(), weather
// SetOffset(GetOffset()+2)). Route adapters normalise per-module quirks —
// see dailycheckin.cpp, whose bundled hook consumed the opcode before
// HandleSnapshot.
//
// Carries the weather bundle's stage guard: opcodes 0x1D..0x7C arriving on
// login/char-select stages (CWvsContext+0x20B8 null) must fall through to
// the original, never into feature handlers.

#pragma once
#include <cstdint>

class CInPacket;

using PacketRouteFn = bool (*)(unsigned short opcode, CInPacket* packet);

// Register an opcode route. Returns false if the opcode is already claimed
// by another module (double-claim = bug; the second registration loses).
bool RegisterPacketRoute(unsigned short opcode, PacketRouteFn fn);

// Install the single ProcessPacket hook. Called FIRST from
// AttachSystemHooks(), before any feature attach.
bool InstallDispatcher();
