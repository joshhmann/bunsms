#pragma once
#include <cstdint>
class CInPacket;
struct PrismTint {
    int16_t hue = 0;
    int8_t chroma = 0;
    int8_t bright = 0;
    bool Identity() const { return hue == 0 && chroma == 0 && bright == 0; }
    bool operator==(const PrismTint& other) const {
        return hue == other.hue && chroma == other.chroma && bright == other.bright;
    }
    bool operator!=(const PrismTint& other) const { return !(*this == other); }
};
int normalizeTintHue(int hue);
bool AttachWeaponTintMod();
void WeaponTint_Tick();
// Receive/reset are thread-safe; all COM, cache, layer and preview work is main-thread.
void WeaponTint_Reset();
bool WeaponTint_HandleSync(CInPacket* packet);
PrismTint WeaponTint_Get(int characterId, int key);
uint64_t WeaponTint_Revision(int characterId);
bool WeaponTint_ItemHasEffectArt(int itemId);
void WeaponTint_SetPreview(void* avatar, int characterId, int key, PrismTint tint);
void WeaponTint_ClearPreview(void* avatar);
// Native itemeff.cpp owns its hooks. Always pair, even when Begin returns false.
// ItemEff is deliberately non-reentrant. Use WeaponTint_ItemEffRevision() as a
// fourth cache key beside item/action/facing in that owner (see integration).
extern "C" __declspec(dllexport) bool WeaponTint_BeginItemEffSwap(void* avatar, int itemId) noexcept(false);
extern "C" __declspec(dllexport) void WeaponTint_EndItemEffSwap();
extern "C" __declspec(dllexport) uint64_t WeaponTint_ItemEffRevision(void* avatar);
// Attack owners bracket the whole cast, not just ShowSkillEffect: missile and
// hit properties are captured later in the same attack. This pair nests safely.
bool WeaponTint_BeginSkillSwap(void* avatar, int skillId);
// Detached preview cash art uses the same cached plans as the native builders.
bool WeaponTint_BeginCashPreview(void* avatar, int itemId);
void WeaponTint_EndCashPreview();
// ballUol is the ADDRESS of the callee-owned one-word Ztl_bstr_t. The sole
// CreateBullet owner passes a private moved wrapper, never a caller's string.
void WeaponTint_NoteBulletFlight(void* ballUol, int bulletItemId, int arrivalFrameTime);
void WeaponTint_EndSkillSwap();
