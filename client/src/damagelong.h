#pragma once

#include <cstddef>

class CInPacket;

// All protocol/appearance changes remain disabled until the current socket
// accepts caps::kLongDamageLines. No capability offer is made by this module.
bool AttachDamageLongMod();
void DamageLong_Frame();
void DamageLong_Reset();

// Called by the sole melee/shoot/magic attack-scope owner, before calculation.
// This is an attack boundary, NOT a per-target CalcDamage boundary.
void DamageLong_BeginLocalAttack();

// Called by the sole CUserRemote::OnAttack owner, with offset at its body
// (the character id has already been consumed). Does not change the offset.
// False means a malformed negotiated attack must not enter native OnAttack.
bool DamageLong_BeginRemoteAttack(int opcode, CInPacket* packet, int* skillId);

// Per-target first-half lookup. The module owns PDamage entry / MDamage init.
extern "C" void __stdcall DamageLong_ResetLineReals();
extern "C" double __stdcall DamageLong_PartnerPercent(
    int srcInt, int* src, int percent, int firstHalfIndex);
long long DamageLong_PeekSlot(int* slot);
bool DamageLong_TakeOverflow(int displayedInt, long long* out);

// A damage-skin owner registers its existing active-wrapper formatter here,
// rather than installing a second patch at Effect_HP's Format call. Return
// the digit count, or -1 when its unit wrapper is inactive. The callback must
// write only within capacity (including its terminator), and must not allocate.
// Registration and the callback run on the main thread. No skin is invented.
using DamageLongUnitFormatter = int(__cdecl*)(
    long long damage, char* digits, std::size_t capacity);
void DamageLong_SetUnitFormatter(DamageLongUnitFormatter formatter);
