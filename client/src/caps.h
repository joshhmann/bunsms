// Capability negotiation sender (delivery-audit contract v1, server-owned).
//
// Opcodes: C2S CLIENT_CAPS_ANNOUNCE (0x373A, Recv), S2C CLIENT_CAPS_ACK
// (0x373B, Send). Announce = int dllVersion (== CLIENT_DLL_VERSION) +
// int featureMask; ack = int serverNegotiationVersion (=1) + int
// acceptedMask (announced AND server-enabled).
//
// Timing (per-connection, no persistence): the DLL sends the announce as
// the FIRST packet on EVERY new game socket (login connect + each channel
// connect/reconnect). Server default per-session is EMPTY (byte-exact v83)
// until it sees the announce; no cross-connection carryover.
//
// DLL C2S rule (hard): vanilla exact-default widths until the ack on THAT
// connection confirms the bit. No 12-byte lines, no custom packets before
// ack. The mask is the offer; the ack is the permission.
//
// This slice advertises ONLY CHECKIN_WINDOW (0x04): the one feature module
// actually present. All other bits stay 0 until their modules land AND the
// server enables them. Advertising an unimplemented bit would invite the
// server to send packets nobody handles — hence conservative-by-construction.

#pragma once

#include <cstdint>

// Feature bits (contract §2; mirror of server mask).
namespace caps {
inline constexpr int kLongDamageLines = 0x01;
inline constexpr int kPrismSync       = 0x02;
inline constexpr int kCheckinWindow   = 0x04;
inline constexpr int kWeatherSync     = 0x08;
inline constexpr int kLampPreview     = 0x10;
inline constexpr int kCashshopWindow  = 0x20;

// Opcodes (contract §1; OPCODE_TABLE.md rows).
inline constexpr unsigned short kAnnounceOpcode = 0x373A; // C2S CLIENT_CAPS_ANNOUNCE
inline constexpr unsigned short kAckOpcode      = 0x373B; // S2C CLIENT_CAPS_ACK

// Server negotiation version we understand (contract §2).
inline constexpr int kNegotiationVersion = 1;
} // namespace caps

// Accepted mask from the latest ack on THIS connection (receive thread
// writes, packet senders read; int-sized, single-word).
// Zero until acked. Per-connection: reset on every new socket.
int CapsAcceptedMask();

// Was feature bit accepted on this connection? Gate every non-vanilla
// send AND every unsolicited-custom-packet expectation on this.
inline bool CapsAccepted(int bit) { return (CapsAcceptedMask() & bit) != 0; }

// Feature mask this DLL offers (contract §2). ONLY bits whose modules are
// present AND enabled. Today: CHECKIN_WINDOW alone.
int CapsOfferedMask();

// Send the announce as the first packet on a new game socket.
// Call AFTER the socket is connected and SendPacket works, BEFORE any
// login/check-password packet. Resets the accepted mask first.
void CapsSendAnnounce();

// Install entry: registers the 0x373B ack route with the dispatcher.
// No Detours beyond the dispatcher route.
void AttachCapsMod();
