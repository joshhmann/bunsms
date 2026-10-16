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
// The offer is published only after all paired hook/bridge prerequisites attach.
// Each custom send/render path still requires the ACK for this connection.

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

// Features whose hooks, paired content and codec prerequisites are ready.
int CapsOfferedMask();
void CapsSetReadyMask(int mask);

// Publish successful hook/codec installation, then probe actual WZ data only on
// the original main thread. An unavailable resource manager defers negotiation.
void CapsHooksReady();
void CapsPrepareReadiness();

// Manual announce send (diagnostic / fallback). The SendPacket-hook path
// (caps.cpp) is primary: first genuine outgoing packet per connection
// carries the announce ahead of it. This entry resets + sends immediately;
// prefer the hook path (ordering + reentrancy guards built in).
void CapsSendAnnounce();

// Install the ACK route and the sole native send/connection-reset hooks.
bool AttachCapsMod();
