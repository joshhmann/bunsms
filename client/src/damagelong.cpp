#include "pch.h"
#include "damagelong.h"
#include "addresses.h"
#include "caps.h"
#include "hook.h"
#include "weapontint.h"
#include "wvs/packet.h"

#include <atomic>
#include <climits>
#include <cstring>
#include <limits>
#include <detours.h>

// Source contract: damage-cap IMPLEMENTATION.md, including Appendix B;
// displaced-instruction evidence: /root/Maplestory/Angel.idb (stock v83).
// Only the two final line funnels are widened. The global cap and every
// intermediate RNG/skill-percent ftol/cdq/idiv remain native.
namespace {
constexpr long long kIntMax = INT_MAX;
constexpr long long kExactLimit = 9007199254740992LL; // 2^53, inclusive
constexpr unsigned int kCrit = 0x80000000u;
constexpr unsigned int kMagnitude = 0x7fffffffu;
constexpr unsigned int kMaxAttackLines = 15 * 15; // both counts are nibbles
constexpr unsigned int kSlotCount = 512; // open-address table, <=225 occupied
constexpr unsigned int kMaxTargetLines = 32;
constexpr DWORD kDisplayLifetime = 5000;

struct PacketLine {
    long long real;
    bool consumed;
};
struct Slot {
    int* pointer;
    unsigned int generation;
    unsigned int packetIndex;
};
struct Overflow {
    long long real;
    DWORD created;
};

SRWLOCK g_lock = SRWLOCK_INIT;
struct StateLock {
    StateLock() { AcquireSRWLockExclusive(&g_lock); }
    ~StateLock() { ReleaseSRWLockExclusive(&g_lock); }
    StateLock(const StateLock&) = delete;
    StateLock& operator=(const StateLock&) = delete;
};
Slot g_slots[kSlotCount]{};
PacketLine g_packetLines[kMaxAttackLines]{};
Overflow g_overflow[kMaxAttackLines]{};
unsigned int g_generation = 1;
unsigned int g_packetCount = 0;
unsigned int g_packetRead = 0;
unsigned int g_overflowRead = 0;
unsigned int g_overflowCount = 0;
DWORD g_attackTime = 0;
std::atomic<unsigned int> g_socketGeneration{1};
std::atomic<DamageLongUnitFormatter> g_unitFormatter{nullptr};

// Ftol -> store and physical-SP lookup belong to the calculation thread.
// A socket reset invalidates TLS even when the reset runs on another thread.
struct TargetLines {
    long long lastReal = 0;
    long long reals[kMaxTargetLines]{};
    unsigned int count = 0;
    unsigned int socketGeneration = 0;
};
thread_local TargetLines g_target;

void SyncTarget() {
    const unsigned int current = g_socketGeneration.load(std::memory_order_acquire);
    if (g_target.socketGeneration != current) {
        g_target.socketGeneration = current;
        g_target.lastReal = 0;
        g_target.count = 0;
    }
}
void ClearSlots() {
    if (++g_generation == 0) {
        // Once per 2^32 attacks, not per frame/hit.
        std::memset(g_slots, 0, sizeof(g_slots));
        g_generation = 1;
    }
    g_packetCount = 0;
    g_packetRead = 0;
}
void ClearOverflow() {
    g_overflowRead = 0;
    g_overflowCount = 0;
}
void PushOverflow(long long real) {
    if (g_overflowCount == kMaxAttackLines) {
        // Never evict one entry and shift all subsequent sentinels onto the
        // wrong numbers. This cannot occur in one valid nibble-count attack.
        ClearOverflow();
        return;
    }
    const unsigned int index = (g_overflowRead + g_overflowCount) % kMaxAttackLines;
    g_overflow[index] = {real, g_attackTime};
    ++g_overflowCount;
}
unsigned int SlotHash(int* slot) {
    return static_cast<unsigned int>((reinterpret_cast<uintptr_t>(slot) >> 2) * 2654435761u)
        & (kSlotCount - 1);
}
Slot* FindSlot(int* slot, bool insert) {
    if (!slot)
        return nullptr;
    unsigned int index = SlotHash(slot);
    for (unsigned int probes = 0; probes != kSlotCount; ++probes) {
        Slot& entry = g_slots[index];
        if (entry.generation != g_generation)
            return insert ? &entry : nullptr;
        if (entry.pointer == slot)
            return &entry;
        index = (index + 1) & (kSlotCount - 1);
    }
    return nullptr;
}
void RecordSlot(int* slot, long long real) {
    if (!slot || g_packetCount == kMaxAttackLines)
        return;
    Slot* entry = FindSlot(slot, true);
    if (!entry)
        return;
    // A rewritten slot must not leave its obsolete fallback line queued.
    if (entry->generation == g_generation)
        g_packetLines[entry->packetIndex].consumed = true;
    entry->pointer = slot;
    entry->generation = g_generation;
    entry->packetIndex = g_packetCount;
    g_packetLines[g_packetCount++] = {real, false};
}
bool PeekSlot(int* slot, long long* real) {
    const Slot* entry = FindSlot(slot, false);
    if (!entry)
        return false;
    *real = g_packetLines[entry->packetIndex].real;
    return true;
}
long long ResolveSource(int srcInt, int* src, int index) {
    SyncTarget();
    long long real = 0;
    {
        StateLock lock;
        if (PeekSlot(src, &real))
            return real;
    }
    if (index >= 0 && static_cast<unsigned int>(index) < g_target.count)
        return g_target.reals[index];
    return static_cast<unsigned int>(srcInt) & kMagnitude;
}

using Encode4 = void(__thiscall*)(void*, unsigned int);
using Decode4 = unsigned int(__thiscall*)(CInPacket*);
using NativeFormat = void*(__cdecl*)(void*, const char*, ...);
using NativeAssign = void(__thiscall*)(void*, const char*, int);
using RemoteAttack = void(__thiscall*)(void*, int, CInPacket&);
const auto g_encode4 = reinterpret_cast<Encode4>(addr::kCOutPacket_Encode4);
const auto g_decode4 = reinterpret_cast<Decode4>(addr::kCInPacket_Decode4);
const auto g_format = reinterpret_cast<NativeFormat>(addr::damagelong::kDamageFormat);
const auto g_assign = reinterpret_cast<NativeAssign>(addr::damagelong::kStringAssign);
RemoteAttack g_remoteAttack = reinterpret_cast<RemoteAttack>(addr::damagelong::kRemoteAttack);
void* g_pDamage = reinterpret_cast<void*>(addr::damagelong::kPDamage);

// Address-bearing assembler operands are variables, not literal engine VAs.
const uintptr_t g_nativeFtol = addr::damagelong::kNativeFtol;
const uintptr_t g_capAddress = addr::damagelong::kVanillaLineCap;
const uintptr_t g_pFtolSite = addr::damagelong::kPDamageFtol;
const uintptr_t g_mFtolSite = addr::damagelong::kMDamageFtol;
const uintptr_t g_pStoreReturn = addr::damagelong::kPDamageStoreReturn;
const uintptr_t g_mStoreReturn = addr::damagelong::kMDamageStoreReturn;
const uintptr_t g_mInitReturn = addr::damagelong::kMDamageInitReturn;
const uintptr_t g_partnerReturn = addr::damagelong::kPartnerReturn;
const uintptr_t g_partnerAltReturn = addr::damagelong::kPartnerAltReturn;

bool Skip(CInPacket* packet, size_t count) {
    if (packet->GetOffset() > (std::numeric_limits<size_t>::max)() - count ||
        !packet->CanRead(count))
        return false;
    packet->SetOffset(packet->GetOffset() + count);
    return true;
}
struct RestoreOffset {
    CInPacket* packet;
    size_t offset;
    ~RestoreOffset() { packet->SetOffset(offset); }
};
bool ReadRemoteHeader(CInPacket* packet, unsigned char* counts, int* skill) {
    unsigned char stance = 0;
    unsigned char level = 0;
    *skill = 0;
    return packet->Decode1(*counts) && packet->Decode1(stance) &&
        packet->Decode1(level) && (level == 0 || packet->Decode4(*skill));
}
bool InspectRemote(CInPacket* packet, int opcode, int* skill) {
    RestoreOffset restore{packet, packet->GetOffset()};
    unsigned char counts = 0;
    if (!ReadRemoteHeader(packet, &counts, skill))
        return false;
    // PacketCreator.addAttackBody: display, direction, stance, speed,
    // mastery (0x0A), projectile. Native reads direction/stance as a short.
    if (!Skip(packet, 9))
        return false;
    const unsigned int targets = counts >> 4;
    const unsigned int lines = counts & 15;
    for (unsigned int target = 0; target != targets; ++target) {
        unsigned int oid = 0;
        if (!packet->Decode4(oid))
            return false;
        // Match native OnAttack's zero-OID branch (it consumes no hit byte).
        if (oid == 0)
            continue;
        if (!Skip(packet, 1))
            return false;
        unsigned int targetLines = lines;
        if (*skill == 4211006) {
            unsigned char mesoLines = 0;
            if (!packet->Decode1(mesoLines) || mesoLines > 15)
                return false;
            targetLines = mesoLines;
        }
        if (!Skip(packet, targetLines * 12))
            return false;
    }
    // These fields are still consumed by native OnAttack after the lines.
    if (opcode == 0xbb && !Skip(packet, 4))
        return false;
    switch (*skill) {
    case 2121001: case 2221001: case 2321001: case 22121000: case 22151001:
        if (!Skip(packet, 4))
            return false;
        break;
    default:
        break;
    }
    return true;
}

void* __cdecl DamageFormatHook(void* text, const char* format, int damage) {
    // ZXString::Format is a vararg member: MSVC passes this on the stack,
    // not in ECX. Preserve the engine return value and original call first.
    void* result = g_format(text, format, damage);
    if (!CapsAccepted(caps::kLongDamageLines))
        return result;
    long long real = static_cast<unsigned int>(damage) & kMagnitude;
    const bool overflow = DamageLong_TakeOverflow(damage, &real);
    char digits[32];
    const auto formatter = g_unitFormatter.load(std::memory_order_acquire);
    const int unitLength = formatter ? formatter(real, digits, sizeof(digits)) : -1;
    if (unitLength >= 0 && static_cast<size_t>(unitLength) < sizeof(digits)) {
        digits[unitLength] = '\0';
        g_assign(text, digits, unitLength);
    } else if (overflow) {
        // Real decimal can exceed the original Format buffer. Assign uses
        // the engine string allocator/COW contract; never overwrite in place.
        char* end = digits + sizeof(digits);
        char* cursor = end;
        *--cursor = '\0';
        unsigned long long value = static_cast<unsigned long long>(real);
        do {
            *--cursor = static_cast<char>('0' + value % 10);
            value /= 10;
        } while (value != 0);
        g_assign(text, cursor, static_cast<int>(end - cursor - 1));
    }
    return result;
}

struct SkillSwap {
    SkillSwap(void* user, int skill) {
        WeaponTint_BeginSkillSwap(static_cast<unsigned char*>(user) + 0x88, skill);
    }
    ~SkillSwap() { WeaponTint_EndSkillSwap(); }
};
void __fastcall RemoteAttackHook(void* user, void*, int opcode, CInPacket& packet) {
    int skill = 0;
    if (!DamageLong_BeginRemoteAttack(opcode, &packet, &skill))
        return;
    SkillSwap swap(user, skill); // sole remote attack scope, shared with prism
    g_remoteAttack(user, opcode, packet);
}
} // namespace

extern "C" int __stdcall DamageLong_Enabled() {
    return CapsAccepted(caps::kLongDamageLines) ? 1 : 0;
}
extern "C" int __stdcall DamageLong_ConsumeFtol(double damage) {
    SyncTarget();
    if (!(damage > 0.0)) // also consumes NaN, without undefined float->int conversion
        damage = 0.0;
    if (damage > static_cast<double>(kExactLimit))
        damage = static_cast<double>(kExactLimit);
    g_target.lastReal = static_cast<long long>(damage);
    if (g_target.lastReal >= kIntMax) {
        StateLock lock;
        PushOverflow(g_target.lastReal);
        return INT_MAX;
    }
    return static_cast<int>(g_target.lastReal);
}
extern "C" void __stdcall DamageLong_StoreSlot(int /*saturated*/, int* slot) {
    if (!CapsAccepted(caps::kLongDamageLines))
        return;
    SyncTarget();
    {
        StateLock lock;
        RecordSlot(slot, g_target.lastReal);
    }
    if (g_target.count != kMaxTargetLines)
        g_target.reals[g_target.count++] = g_target.lastReal;
}
extern "C" void __stdcall DamageLong_ResetLineReals() {
    SyncTarget();
    g_target.lastReal = 0;
    g_target.count = 0;
}
extern "C" double __stdcall DamageLong_PartnerPercent(
    int srcInt, int* src, int percent, int firstHalfIndex) {
    const long long source = ResolveSource(srcInt, src, firstHalfIndex);
    if (source <= 0 || percent <= 0)
        return 0.0;
    // Avoid src*pct overflow even for a malformed large skill percentage.
    // 2^53*100 fits int64; the actual multiply is only reached below it.
    if (source > kExactLimit * 100 / percent)
        return static_cast<double>(kExactLimit);
    return static_cast<double>(source * percent / 100);
}

void DamageLong_BeginLocalAttack() {
    StateLock lock;
    ClearSlots();
    ClearOverflow();
    g_attackTime = GetTickCount();
    DamageLong_ResetLineReals();
}
bool DamageLong_BeginRemoteAttack(int opcode, CInPacket* packet, int* skillId) {
    if (!packet || !skillId)
        return false;
    if (CapsAccepted(caps::kLongDamageLines)) {
        {
            StateLock lock;
            // Even a rejected attack is a boundary: discard its predecessor's
            // unconsumed display entries before any subsequent HP popup.
            ClearOverflow();
            g_attackTime = GetTickCount();
        }
        if (!InspectRemote(packet, opcode, skillId))
            return false;
    } else {
        // Only peek the skill for prism. Never validate or modify vanilla
        // packet layout/semantics when long lines were not accepted.
        RestoreOffset restore{packet, packet->GetOffset()};
        unsigned char counts = 0;
        ReadRemoteHeader(packet, &counts, skillId);
    }
    return true;
}
void DamageLong_Reset() {
    StateLock lock;
    ClearSlots();
    ClearOverflow();
    g_socketGeneration.fetch_add(1, std::memory_order_release);
}
void DamageLong_Frame() {
    if (!CapsAccepted(caps::kLongDamageLines)) {
        StateLock lock;
        if (g_packetCount || g_overflowCount) {
            ClearSlots();
            ClearOverflow();
            g_socketGeneration.fetch_add(1, std::memory_order_release);
        }
        return;
    }
    StateLock lock;
    if (g_overflowCount && GetTickCount() - g_overflow[g_overflowRead].created >= kDisplayLifetime)
        ClearOverflow();
}
long long DamageLong_PeekSlot(int* slot) {
    if (!CapsAccepted(caps::kLongDamageLines))
        return 0;
    StateLock lock;
    long long real = 0;
    PeekSlot(slot, &real);
    return real;
}
bool DamageLong_TakeOverflow(int displayedInt, long long* out) {
    if (!out || !CapsAccepted(caps::kLongDamageLines) ||
        (static_cast<unsigned int>(displayedInt) & kMagnitude) != kIntMax)
        return false;
    StateLock lock;
    if (!g_overflowCount)
        return false;
    *out = g_overflow[g_overflowRead].real;
    g_overflowRead = (g_overflowRead + 1) % kMaxAttackLines;
    --g_overflowCount;
    return true;
}
void DamageLong_SetUnitFormatter(DamageLongUnitFormatter formatter) {
    g_unitFormatter.store(formatter, std::memory_order_release);
}

extern "C" void __stdcall DamageLong_EncodeLine(void* packet, unsigned int raw, int* slot) {
    if (!CapsAccepted(caps::kLongDamageLines)) {
        // In particular: no critical-bit rewrite and no appended bytes.
        g_encode4(packet, raw);
        return;
    }
    if (slot && slot[15])
        raw |= kCrit;
    long long real = raw & kMagnitude;
    {
        StateLock lock;
        Slot* entry = FindSlot(slot, false);
        if (entry) {
            PacketLine& line = g_packetLines[entry->packetIndex];
            real = line.real;
            line.consumed = true;
        } else {
            while (g_packetRead != g_packetCount && g_packetLines[g_packetRead].consumed)
                ++g_packetRead;
            if (g_packetRead != g_packetCount) {
                PacketLine& line = g_packetLines[g_packetRead++];
                real = line.real;
                line.consumed = true;
            }
        }
    }
    g_encode4(packet, raw);
    g_encode4(packet, static_cast<unsigned int>(real));
    g_encode4(packet, static_cast<unsigned int>(static_cast<unsigned long long>(real) >> 32));
}
extern "C" unsigned int __stdcall DamageLong_DecodeLine(CInPacket* packet) {
    if (!CapsAccepted(caps::kLongDamageLines))
        return g_decode4(packet); // one native Decode4, including its vanilla error behavior
    // The outer OnAttack preflight checked the entire body before native
    // allocation/mutation. Keep the custom reader bounded even independently.
    if (!packet->CanRead(12))
        return 0;
    unsigned int raw = 0;
    unsigned int lo = 0;
    unsigned int hi = 0;
    packet->Decode4(raw);
    packet->Decode4(lo);
    packet->Decode4(hi);
    const unsigned long long encoded = static_cast<unsigned long long>(lo) |
        (static_cast<unsigned long long>(hi) << 32);
    const long long real = encoded > static_cast<unsigned long long>(kExactLimit)
        ? kExactLimit : static_cast<long long>(encoded);
    if ((raw & kMagnitude) == kIntMax && real >= kIntMax) {
        StateLock lock;
        PushOverflow(real);
    }
    return raw; // normal OnAttack extracts this sign bit into abCritical
}

// Every naked helper preserves the stack/register state of its displaced
// instruction(s). Helpers called by asm are extern C + stdcall; doubles are
// returned in ST(0), never reinterpreted through EAX/EDX.
__declspec(naked) void DamageLong_FtolDamageLine() {
    __asm {
        pushfd
        push ecx
        push edx
        call DamageLong_Enabled
        test eax, eax
        jz vanilla
        sub esp, 8
        fstp qword ptr [esp]
        call DamageLong_ConsumeFtol
        pop edx
        pop ecx
        popfd
        ret
    vanilla:
        pop edx
        pop ecx
        popfd
        jmp dword ptr [g_nativeFtol]
    }
}
__declspec(naked) void DamageLong_PGate() {
    __asm {
        pushfd
        pushad
        call DamageLong_Enabled
        test eax, eax
        jnz accepted
        popad
        popfd
        jb original_below
        fstp st(0)
        push edx
        mov edx, dword ptr [g_capAddress]
        fld qword ptr [edx]
        pop edx
    original_below:
        jmp dword ptr [g_pFtolSite]
    accepted:
        popad
        popfd
        jmp dword ptr [g_pFtolSite]
    }
}
__declspec(naked) void DamageLong_MGate() {
    __asm {
        pushfd
        pushad
        call DamageLong_Enabled
        test eax, eax
        jnz accepted
        popad
        popfd
        jb original_below
        fstp st(0)
        push edx
        mov edx, dword ptr [g_capAddress]
        fld qword ptr [edx]
        pop edx
    original_below:
        jmp dword ptr [g_mFtolSite]
    accepted:
        popad
        popfd
        jmp dword ptr [g_mFtolSite]
    }
}
__declspec(naked) void DamageLong_PStore() {
    __asm {
        mov ecx, dword ptr [ebp - 0x48]
        pushfd
        pushad
        push ecx
        push eax
        call DamageLong_StoreSlot
        popad
        popfd
        mov dword ptr [ecx], eax
        jmp dword ptr [g_pStoreReturn]
    }
}
__declspec(naked) void DamageLong_MStore() {
    __asm {
        mov ecx, dword ptr [ebp + 0x40]
        pushfd
        pushad
        push ecx
        push eax
        call DamageLong_StoreSlot
        popad
        popfd
        mov dword ptr [ecx], eax
        jmp dword ptr [g_mStoreReturn]
    }
}
__declspec(naked) void DamageLong_PDamageEntry() {
    __asm {
        pushfd
        pushad
        call DamageLong_ResetLineReals
        popad
        popfd
        jmp dword ptr [g_pDamage]
    }
}
__declspec(naked) void DamageLong_MInit() {
    __asm {
        // Replay native total/remaining bookkeeping, with no magic SP mod:
        // no count doubling, no second-half copy, no stride/crit-array change.
        mov dword ptr [ebp + 0x34], eax
        mov dword ptr [ebp - 0x34], ecx
        pushfd
        pushad
        call DamageLong_ResetLineReals
        popad
        popfd
        jmp dword ptr [g_mInitReturn]
    }
}
__declspec(naked) void DamageLong_EncodeMelee() {
    __asm {
        push eax                       // slot: EAX, NOT EDI at the melee site
        push dword ptr [esp + 8]        // original Encode4 argument
        push ecx                       // packet this
        call DamageLong_EncodeLine     // stdcall pops exactly 12
        ret 4                          // native Encode4 popped its int argument
    }
}
__declspec(naked) void DamageLong_EncodeEdi() {
    __asm {
        push edi                       // slot: EDI for shoot and magic
        push dword ptr [esp + 8]
        push ecx
        call DamageLong_EncodeLine
        ret 4
    }
}
__declspec(naked) void DamageLong_DecodeRemote() {
    __asm {
        push ecx
        call DamageLong_DecodeLine      // stdcall pops only the packet this
        ret                            // native Decode4 has no stack arguments
    }
}
__declspec(naked) void DamageLong_Partner() {
    __asm {
        pushfd
        pushad
        call DamageLong_Enabled
        test eax, eax
        jz vanilla
        popad
        popfd
        pushfd
        pushad                         // ECX byte offset survives the C++ helper
        mov eax, dword ptr [ebp + 0x40]
        add eax, ecx
        push ecx
        shr dword ptr [esp], 2          // firstHalfIndex
        push edx                       // skill percentage
        push eax                       // original slot
        push dword ptr [eax]
        call DamageLong_PartnerPercent // double in ST(0), stdcall ret16
        popad
        popfd
        jmp dword ptr [g_partnerReturn]
    vanilla:
        popad
        popfd
        imul eax, edx
        push 100
        cdq
        pop edi
        idiv edi
        mov dword ptr [ebp - 8], eax
        fild dword ptr [ebp - 8]
        jmp dword ptr [g_partnerReturn]
    }
}
__declspec(naked) void DamageLong_PartnerAlt() {
    __asm {
        pushfd
        pushad
        call DamageLong_Enabled
        test eax, eax
        jz vanilla
        popad
        popfd
        pushfd
        pushad
        mov eax, dword ptr [ebp + 0x40]
        add eax, ecx
        push ecx
        shr dword ptr [esp], 2
        push edx
        push eax
        push dword ptr [eax]
        call DamageLong_PartnerPercent
        popad
        popfd
        jmp dword ptr [g_partnerAltReturn]
    vanilla:
        popad
        popfd
        imul eax, edx
        push 100
        cdq
        pop edi
        idiv edi
        mov dword ptr [ebp - 8], eax
        fild dword ptr [ebp - 8]
        jmp dword ptr [g_partnerAltReturn]
    }
}

namespace {
// PatchMemory in this SDK returns void and ignores VirtualProtect failures.
// Feature-owned fixed patches therefore check protection, flush and rollback
// themselves. There is no hot-path allocation and no global patch helper edit.
struct DamagePatch {
    uintptr_t address;
    unsigned char expected[15];
    size_t size;
    void* destination;
    unsigned char opcode;
    unsigned char original[15];
};
DamagePatch g_patches[] = {
    {addr::damagelong::kPDamageGate, {0x72,0x08,0xdd,0xd8,0xdd,0x05,0xa0,0xe8,0xaf,0x00}, 10, CastHook(&DamageLong_PGate), 0xe9, {}},
    {addr::damagelong::kMDamageGate, {0x72,0x08,0xdd,0xd8,0xdd,0x05,0xa0,0xe8,0xaf,0x00}, 10, CastHook(&DamageLong_MGate), 0xe9, {}},
    {addr::damagelong::kPDamageFtol, {0xe8,0x7a,0x1a,0x2d,0x00}, 5, CastHook(&DamageLong_FtolDamageLine), 0xe8, {}},
    {addr::damagelong::kMDamageFtol, {0xe8,0x75,0x00,0x2d,0x00}, 5, CastHook(&DamageLong_FtolDamageLine), 0xe8, {}},
    {addr::damagelong::kPDamageStore, {0x8b,0x4d,0xb8,0x89,0x01}, 5, CastHook(&DamageLong_PStore), 0xe9, {}},
    {addr::damagelong::kMDamageStore, {0x8b,0x4d,0x40,0x89,0x01}, 5, CastHook(&DamageLong_MStore), 0xe9, {}},
    {addr::damagelong::kMeleeEncode, {0xe8,0x79,0x3a,0xab,0xff}, 5, CastHook(&DamageLong_EncodeMelee), 0xe8, {}},
    {addr::damagelong::kShootEncode, {0xe8,0x79,0x11,0xab,0xff}, 5, CastHook(&DamageLong_EncodeEdi), 0xe8, {}},
    {addr::damagelong::kMagicEncode, {0xe8,0x43,0xf5,0xaa,0xff}, 5, CastHook(&DamageLong_EncodeEdi), 0xe8, {}},
    {addr::damagelong::kMesoDecode, {0xe8,0xb0,0x60,0xa8,0xff}, 5, CastHook(&DamageLong_DecodeRemote), 0xe8, {}},
    {addr::damagelong::kNormalDecode, {0xe8,0x0b,0x60,0xa8,0xff}, 5, CastHook(&DamageLong_DecodeRemote), 0xe8, {}},
    {addr::damagelong::kPartnerPercent, {0x0f,0xaf,0xc2,0x6a,0x64,0x99,0x5f,0xf7,0xff,0x89,0x45,0xf8,0xdb,0x45,0xf8}, 15, CastHook(&DamageLong_Partner), 0xe9, {}},
    {addr::damagelong::kPartnerPercentAlt, {0x0f,0xaf,0xc2,0x6a,0x64,0x99,0x5f,0xf7,0xff,0x89,0x45,0xf8,0xdb,0x45,0xf8}, 15, CastHook(&DamageLong_PartnerAlt), 0xe9, {}},
    {addr::damagelong::kMDamageInit, {0x89,0x45,0x34,0x89,0x4d,0xcc}, 6, CastHook(&DamageLong_MInit), 0xe9, {}},
    {addr::damagelong::kDamageFormatCall, {0xe8,0x4b,0xdd,0x00,0x00}, 5, CastHook(&DamageFormatHook), 0xe8, {}}
};
bool WriteCode(uintptr_t address, const void* bytes, size_t size) {
    DWORD oldProtect = 0;
    void* location = reinterpret_cast<void*>(address);
    if (!VirtualProtect(location, size, PAGE_EXECUTE_READWRITE, &oldProtect))
        return false;
    std::memcpy(location, bytes, size);
    const BOOL flushed = FlushInstructionCache(GetCurrentProcess(), location, size);
    DWORD ignored = 0;
    const BOOL restored = VirtualProtect(location, size, oldProtect, &ignored);
    return flushed && restored;
}
void UndoPatches(size_t count) {
    while (count != 0) {
        DamagePatch& patch = g_patches[--count];
        WriteCode(patch.address, patch.original, patch.size);
    }
}
} // namespace

bool AttachDamageLongMod() {
    static bool attached = false;
    if (attached)
        return true;
    // Reject a different executable or a second owner before altering code.
    // In particular no QoL/SP/skin cave is silently overwritten or chained.
    for (DamagePatch& patch : g_patches) {
        const void* location = reinterpret_cast<const void*>(patch.address);
        if (std::memcmp(location, patch.expected, patch.size) != 0)
            return false;
        std::memcpy(patch.original, location, patch.size);
    }
    const unsigned char pEntry[] = {0x55,0x8b,0xec,0x81,0xec,0xa8,0x01,0x00,0x00};
    const unsigned char remoteEntry[] = {0xb8,0x04,0x09,0xae,0x00};
    if (std::memcmp(reinterpret_cast<const void*>(addr::damagelong::kPDamage), pEntry, sizeof(pEntry)) != 0 ||
        std::memcmp(reinterpret_cast<const void*>(addr::damagelong::kRemoteAttack), remoteEntry, sizeof(remoteEntry)) != 0)
        return false;
    size_t installed = 0;
    for (DamagePatch& patch : g_patches) {
        unsigned char bytes[15];
        std::memset(bytes, 0x90, patch.size);
        bytes[0] = patch.opcode;
        const auto displacement = static_cast<unsigned int>(
            reinterpret_cast<uintptr_t>(patch.destination) - patch.address - 5);
        std::memcpy(bytes + 1, &displacement, sizeof(displacement));
        // Include the current site in rollback: a protect/flush failure can
        // occur after its bytes have already changed.
        ++installed;
        if (!WriteCode(patch.address, bytes, patch.size)) {
            UndoPatches(installed);
            return false;
        }
    }
    // Both Detours commit together; never leave a partial target/remote owner.
    LONG result = DetourTransactionBegin();
    if (result == NO_ERROR) {
        result = DetourUpdateThread(GetCurrentThread());
        if (result == NO_ERROR)
            result = DetourAttach(&g_pDamage, CastHook(&DamageLong_PDamageEntry));
        if (result == NO_ERROR)
            result = DetourAttach(reinterpret_cast<void**>(&g_remoteAttack), CastHook(&RemoteAttackHook));
        if (result == NO_ERROR)
            result = DetourTransactionCommit();
        else
            DetourTransactionAbort();
    }
    if (result != NO_ERROR) {
        UndoPatches(installed);
        return false;
    }
    DamageLong_Reset();
    attached = true;
    return true;
}
