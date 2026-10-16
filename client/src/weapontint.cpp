#include "pch.h"
#include "weapontint.h"
#include "damagelong.h"
#include "coloringprism.h"
#include "prism_abi.h"
#include "prism_itemeff_abi.h"
#include "caps.h"
#include "dispatcher.h"
#include "hook.h"
#include "wvs/packet.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <map>
#include <memory>
#include <mutex>
#include <exception>
#include <optional>
#include <string>
#include <utility>
#include <vector>

// Four traps: native action caches must be private to a palette; preserve raw
// UOL slot values; never recolour one of our own clones; test canvas BEFORE
// property (a WzCanvas implements both). No shared inlink/unknown detours here.
int normalizeTintHue(int hue) {
    return hue < 0 ? (std::max)(-360, hue) : hue % 360;
}
namespace {
struct Entry {
    int key;
    PrismTint tint;
    bool operator==(const Entry& other) const { return key == other.key && tint == other.tint; }
};
using Palette = std::vector<Entry>;
std::mutex receiveMutex;
std::map<int, Palette> pending;
std::atomic<uint64_t> epoch{1};
std::atomic<bool> resetPending{false};
std::map<int, Palette> palettes;
uint64_t revision = 1;
std::map<int, uint64_t> characterRevisions;
PrismTint Find(const Palette& palette, int key) {
    auto i = std::lower_bound(palette.begin(), palette.end(), key,
        [](const Entry& e, int k) { return e.key < k; });
    return i != palette.end() && i->key == key ? i->tint : PrismTint{};
}
int Character(void* avatar);
PrismTint Tint(void* avatar, int key);

unsigned int Transform(unsigned int pixel, PrismTint tint) {
    if (!(pixel >> 24)) return pixel;
    const float r = ((pixel >> 16) & 255) / 255.0f;
    const float g = ((pixel >> 8) & 255) / 255.0f;
    const float b = (pixel & 255) / 255.0f;
    const float hi = (std::max)({r, g, b}), lo = (std::min)({r, g, b});
    const float delta = hi - lo;
    float hue = 0, saturation = hi == 0 ? 0 : delta / hi;
    if (delta > 0) {
        if (hi == r) hue = (g - b) / delta;
        else if (hi == g) hue = 2 + (b - r) / delta;
        else hue = 4 + (r - g) / delta;
        hue *= 60;
    }
    if (tint.hue < 0) hue = static_cast<float>(-tint.hue - 1);
    else hue += tint.hue;
    hue = std::fmod(hue + 720.0f, 360.0f);
    auto adjust = [](float value, int amount) {
        return amount >= 0 ? value + (1 - value) * amount / 100.0f
                           : value * (1 + amount / 100.0f);
    };
    saturation = adjust(saturation, tint.chroma);
    const float value = adjust(hi, tint.bright);
    const float c = value * saturation;
    const float x = c * (1 - std::fabs(std::fmod(hue / 60, 2.0f) - 1));
    const float m = value - c;
    float rr = 0, gg = 0, bb = 0;
    if (hue < 60) { rr = c; gg = x; }
    else if (hue < 120) { rr = x; gg = c; }
    else if (hue < 180) { gg = c; bb = x; }
    else if (hue < 240) { gg = x; bb = c; }
    else if (hue < 300) { rr = x; bb = c; }
    else { rr = c; bb = x; }
    auto byte = [m](float channel) { return static_cast<unsigned int>((channel + m) * 255 + 0.5f); };
    return (pixel & 0xFF000000U) | byte(rr) << 16 | byte(gg) << 8 | byte(bb);
}
// Pixel buffers are COM-allocated raw canvases, never CRT blocks handed to WZ.
class RawLock {
    IWzRawCanvasPtr raw_;
public:
    int pitch = 0;
    Ztl_variant_t address;
    explicit RawLock(IWzRawCanvasPtr raw) : raw_(raw) { address = raw_->_LockAddress(&pitch); }
    ~RawLock() { raw_->_UnlockAddress(nullptr); }
    unsigned char* Bytes() const {
        if (address.vt == VT_I4 || address.vt == VT_UI4)
            return reinterpret_cast<unsigned char*>(static_cast<uintptr_t>(address.ulVal));
        _com_issue_error(E_UNEXPECTED);
        return nullptr;
    }
};
struct Clone {
    IWzCanvasPtr original;
    IWzCanvasPtr canvas;
    PrismTint tint;
};
std::vector<Clone> clones;
IWzCanvasPtr CloneCanvas(IWzCanvasPtr source, PrismTint tint) {
    for (const auto& c : clones) {
        if (c.canvas == source) return nullptr;
        if (c.original == source && c.tint == tint) return c.canvas;
    }
    IWzCanvasPtr copy;
    PcCreateObject<IWzCanvasPtr>(L"Canvas", copy, nullptr);
    copy->Create(source->width, source->height, Ztl_variant_t(0), Ztl_variant_t(CP_A8R8G8B8));
    copy->Copy(0, 0, source, Ztl_variant_t(CA_OVERWRITE));
    copy->cx = source->cx;
    copy->cy = source->cy;
    // Preserve origin/map/z/delay and all other frame metadata, including raw UOLs.
    IWzPropertyPtr originalProps = source->property, copyProps = copy->property;
    IEnumVARIANTPtr props = originalProps->_NewEnum;
    for (;;) {
        Ztl_variant_t key;
        ULONG fetched = 0;
        if (FAILED(props->Next(1, &key, &fetched)) || !fetched) break;
        Ztl_bstr_t name(key);
        Ztl_variant_t value = originalProps->item[name];
        // Kaentake's sole resolver re-materializes linked canvases on EVERY
        // read. Our clone already contains the resolved pixels: carrying these
        // three source directives would overwrite HSV with vanilla pixels.
        // Original metadata/aliases are untouched and restored by the swap.
        if (value.vt == VT_BSTR && (wcscmp(name.GetBSTR(), L"_inlink") == 0 ||
            wcscmp(name.GetBSTR(), L"_outlink") == 0 ||
            wcscmp(name.GetBSTR(), L"source") == 0)) continue;
        copyProps->item[name] = value;
    }
    // WzCanvas may be tiled. Lock and transform each native tile independently.
    const unsigned int tw = copy->tileWidth, th = copy->tileHeight;
    if (!tw || !th) _com_issue_error(E_UNEXPECTED);
    for (unsigned int y = 0; y < copy->height; y += th) {
        for (unsigned int x = 0; x < copy->width; x += tw) {
            IWzRawCanvasPtr tile = copy->GetrawCanvas(x / tw, y / th);
            RawLock lock(tile);
            auto* bytes = lock.Bytes();
            for (unsigned int row = 0; row < tile->height; ++row) {
                auto* pixels = reinterpret_cast<unsigned int*>(bytes + static_cast<ptrdiff_t>(row) * lock.pitch);
                for (unsigned int col = 0; col < tile->width; ++col) pixels[col] = Transform(pixels[col], tint);
            }
        }
    }
    clones.push_back({source, copy, tint});
    return copy;
}
struct Slot {
    IWzPropertyPtr parent;
    Ztl_bstr_t name;
    Ztl_variant_t raw;
    IWzCanvasPtr clone;
};
class Plan {
    std::vector<Slot> slots_;
    std::vector<IWzProperty*> ancestors_;
    void Walk(IWzPropertyPtr property, PrismTint body, PrismTint effect, bool effectBranch, int depth) {
        if (!property || depth > 64 || std::find(ancestors_.begin(), ancestors_.end(), property.GetInterfacePtr()) != ancestors_.end()) return;
        ancestors_.push_back(property);
        IEnumVARIANTPtr enumeration = property->_NewEnum;
        for (;;) {
            Ztl_variant_t key;
            ULONG count = 0;
            if (FAILED(enumeration->Next(1, &key, &count)) || !count) break;
            Ztl_bstr_t name(key);
            if (wcsncmp(name.GetBSTR(), L"__bunsPrism", 11) == 0) continue;
            // get_item returns the RAW variant. Only get_unknown resolves its UOL.
            Ztl_variant_t raw = property->item[name];
            Ztl_variant_t resolveValue(raw);
            IUnknownPtr resolved = get_unknown(resolveValue);
            if (!resolved) continue;
            const bool fx = effectBranch || wcsncmp(name.GetBSTR(), L"effect", 6) == 0;
            PrismTint selected = fx ? effect : body;
            IWzCanvasPtr canvas;
            if (SUCCEEDED(resolved.QueryInterface(__uuidof(IWzCanvas), &canvas))) {
                if (!selected.Identity()) {
                    auto clone = CloneCanvas(canvas, selected);
                    if (clone) slots_.push_back({property, name, raw, clone});
                }
                continue;
            }
            IWzPropertyPtr child;
            if (SUCCEEDED(resolved.QueryInterface(__uuidof(IWzProperty), &child)))
                Walk(child, body, effect, fx, depth + 1);
        }
        ancestors_.pop_back();
    }
public:
    void Add(IWzPropertyPtr property, PrismTint body, PrismTint effect, bool allEffect = false) {
        if (body.Identity() && effect.Identity()) return;
        Walk(property, body, effect, allEffect, 0);
    }
    class Swap {
        Plan* plan_;
        size_t applied_ = 0;
    public:
        explicit Swap(Plan& plan) : plan_(&plan) {
            try {
                for (const auto& slot : plan.slots_) {
                    slot.parent->item[slot.name] = Ztl_variant_t(slot.clone.GetInterfacePtr());
                    ++applied_;
                }
            } catch (...) { Restore(); throw; }
        }
        void Restore() noexcept {
            while (applied_) {
                const auto& slot = plan_->slots_[--applied_];
                // Each saved variant owns its reference; aliases are restored as aliases.
                HRESULT hr = slot.parent->put_item(slot.name, slot.raw);
                if (FAILED(hr)) std::terminate(); // never continue with a corrupt shared WZ tree
            }
        }
        ~Swap() { Restore(); }
        Swap(Swap&& other) noexcept : plan_(other.plan_), applied_(other.applied_) {
            other.applied_ = 0;
        }
        Swap(const Swap&) = delete;
        Swap& operator=(const Swap&) = delete;
    };
};
// Angel.idb: GetCharacterImgEntry uses actionman+18, LRU list+4;
// LoadFaceLook uses map+44, list+30. They MUST travel together. A global cache
// keyed only by item/action would leak the first character's dye to everyone.
class NativeCaches {
    std::array<uintptr_t, 22> words_{};
    bool initialized_ = false;
    static uintptr_t* Engine() {
        void* manager = *reinterpret_cast<void**>(addr::prism::kActionMan);
        return manager ? reinterpret_cast<uintptr_t*>(static_cast<unsigned char*>(manager) + 4) : nullptr;
    }
    void Init(uintptr_t* engine) {
        std::copy(engine, engine + words_.size(), words_.begin());
        for (size_t base : {size_t(0), size_t(11)}) {
            // list: vptr, accessor, count, head, tail; map: vptr, buckets,
            // bucket-count, count, grow threshold, shrink threshold.
            std::fill(words_.begin() + base + 1, words_.begin() + base + 5, uintptr_t(0));
            words_[base + 6] = words_[base + 8] = 0;
        }
        initialized_ = true;
    }
public:
    NativeCaches() = default;
    NativeCaches(const NativeCaches&) = delete;
    NativeCaches& operator=(const NativeCaches&) = delete;
    ~NativeCaches() {
        if (!initialized_) return;
        // Native scalar deleting destructors, flags=0: free their native nodes,
        // never our container. Maps and LRUs each hold their own ZRef.
        for (size_t off : {size_t(5), size_t(16), size_t(0), size_t(11)}) {
            void* object = words_.data() + off;
            auto table = *reinterpret_cast<void***>(object);
            reinterpret_cast<void*(__thiscall*)(void*, unsigned int)>(table[0])(object, 0);
        }
    }
    class Scope {
        NativeCaches* cache_;
        uintptr_t* engine_;
    public:
        explicit Scope(NativeCaches& cache) : cache_(&cache), engine_(Engine()) {
            if (!engine_) return;
            if (!cache.initialized_) cache.Init(engine_);
            for (size_t i = 0; i < cache.words_.size(); ++i) std::swap(engine_[i], cache.words_[i]);
        }
        ~Scope() {
            if (engine_) for (size_t i = 0; i < cache_->words_.size(); ++i)
                std::swap(engine_[i], cache_->words_[i]);
        }
    };
};
struct Appearance {
    int skin = 0, face = 0, sticker = 0;
    std::array<int, 52> items{};
    explicit Appearance(void* avatar) {
        skin = prismabi::At<int>(avatar, 0x11);
        face = prismabi::At<int>(avatar, 0x15);
        sticker = prismabi::At<int>(avatar, 0x19);
        memcpy(items.data(), static_cast<unsigned char*>(avatar) + 0x1D, sizeof(items));
        // Preserve the engine/upstream forcing-appearance overlay. -1 inherits
        // the real equip, exactly as native PrepareActionLayer 00454610 does.
        if (prismabi::At<int>(avatar, 0x460)) for (size_t i = 0; i < items.size(); ++i) {
            const int forced = prismabi::At<int>(avatar, 0x390 + i * 4);
            if (forced != -1) items[i] = forced;
        }
    }
    bool Matches(void* avatar) const {
        if (skin != prismabi::At<int>(avatar, 0x11) ||
            face != prismabi::At<int>(avatar, 0x15) ||
            sticker != prismabi::At<int>(avatar, 0x19)) return false;
        const bool forcing = prismabi::At<int>(avatar, 0x460) != 0;
        for (size_t i = 0; i < items.size(); ++i) {
            int item = prismabi::At<int>(avatar, 0x1D + i * 4);
            if (forcing) {
                const int forced = prismabi::At<int>(avatar, 0x390 + i * 4);
                if (forced != -1) item = forced;
            }
            if (items[i] != item) return false;
        }
        return true;
    }
};
IWzPropertyPtr ItemRoot(int id) {
    if (id / 10000 == 501) {
        wchar_t path[128];
        swprintf_s(path, L"Item/Cash/0501.img/%08d", id);
        return prismabi::Property(path);
    }
    ZXString<wchar_t> path;
    reinterpret_cast<ZXString<wchar_t>*(__cdecl*)(ZXString<wchar_t>*, int)>(
        addr::prism::kEquipDataPath)(&path, id);
    return path.GetLength() ? prismabi::Property(static_cast<const wchar_t*>(path)) : nullptr;
}
struct Context {
    Appearance look;
    uint64_t version;
    Plan plan;
    NativeCaches native;
    Context(void* avatar, uint64_t v) : look(avatar), version(v) {
        wchar_t path[128];
        PrismTint skin = Tint(avatar, -3);
        if (!skin.Identity()) {
            swprintf_s(path, L"Character/%08d.img", 2000 + look.skin);
            plan.Add(prismabi::Property(path), skin, skin);
            swprintf_s(path, L"Character/%08d.img", 12000 + look.skin);
            plan.Add(prismabi::Property(path), skin, skin);
        }
        const int hair = look.items[0];
        auto hairTint = Tint(avatar, -1);
        if (hair && !hairTint.Identity()) {
            swprintf_s(path, L"Character/Hair/%08d.img", hair);
            plan.Add(prismabi::Property(path), hairTint, hairTint);
        }
        auto faceTint = Tint(avatar, -2);
        if (look.face && !faceTint.Identity()) {
            swprintf_s(path, L"Character/Face/%08d.img", look.face);
            plan.Add(prismabi::Property(path), faceTint, faceTint);
        }
        for (size_t slot = 1; slot <= look.items.size(); ++slot) {
            int id = slot == look.items.size() ? look.sticker : look.items[slot];
            if (!id) continue;
            const auto body = Tint(avatar, id), effect = Tint(avatar, id + 10000000);
            if (!body.Identity() || !effect.Identity()) plan.Add(ItemRoot(id), body, effect);
        }
    }
};
struct Preview {
    int character;
    int key;
    PrismTint tint;
    uint64_t version;
};
std::map<void*, Preview> previews;
std::map<void*, std::unique_ptr<Context>> contexts;
int Character(void* avatar) {
    auto preview = previews.find(avatar);
    return preview == previews.end() ? prismabi::AvatarCharacterId(avatar) : preview->second.character;
}
PrismTint Tint(void* avatar, int key) {
    auto preview = previews.find(avatar);
    if (preview != previews.end() && preview->second.key == key) return preview->second.tint;
    return WeaponTint_Get(Character(avatar), key);
}
uint64_t Version(void* avatar) {
    auto p = previews.find(avatar);
    if (p != previews.end()) return p->second.version;
    auto character = characterRevisions.find(Character(avatar));
    return character == characterRevisions.end() ? 0 : character->second;
}
bool HasTint(void* avatar) {
    if (!CapsAccepted(caps::kPrismSync)) return false;
    auto preview = previews.find(avatar);
    if (preview != previews.end() && !preview->second.tint.Identity()) return true;
    auto palette = palettes.find(Character(avatar));
    return palette != palettes.end() && !palette->second.empty();
}
Context& GetContext(void* avatar) {
    auto& context = contexts[avatar];
    if (!context || context->version != Version(avatar) || !context->look.Matches(avatar))
        context = std::make_unique<Context>(avatar, Version(avatar));
    return *context;
}
thread_local void* activeAppearance = nullptr;
using PrepareFn = void(__thiscall*)(void*, int, int, int);
using FaceFn = void(__thiscall*)(void*, int);
auto prepare = reinterpret_cast<PrepareFn>(addr::prism::kPrepareActionLayer);
auto face = reinterpret_cast<FaceFn>(addr::prism::kPrepareFaceLayer);
struct ActiveAvatar {
    void* old;
    explicit ActiveAvatar(void* avatar) : old(activeAppearance) { activeAppearance = avatar; }
    ~ActiveAvatar() { activeAppearance = old; }
};
void __fastcall PrepareHook(void* avatar, void*, int speed, int walk, int down) {
    if (!HasTint(avatar) || activeAppearance == avatar) { prepare(avatar, speed, walk, down); return; }
    auto& context = GetContext(avatar);
    NativeCaches::Scope cache(context.native);
    Plan::Swap swaps(context.plan);
    ActiveAvatar active(avatar);
    prepare(avatar, speed, walk, down);
}
void __fastcall FaceHook(void* avatar, void*, int emotion) {
    if (!HasTint(avatar) || activeAppearance == avatar) { face(avatar, emotion); return; }
    auto& context = GetContext(avatar);
    NativeCaches::Scope cache(context.native);
    Plan::Swap swaps(context.plan);
    ActiveAvatar active(avatar);
    face(avatar, emotion);
}
struct EffectKey {
    int id;
    PrismTint tint;
    bool operator<(const EffectKey& other) const {
        if (id != other.id) return id < other.id;
        if (tint.hue != other.tint.hue) return tint.hue < other.tint.hue;
        if (tint.chroma != other.tint.chroma) return tint.chroma < other.tint.chroma;
        return tint.bright < other.tint.bright;
    }
};
std::map<EffectKey, std::unique_ptr<Plan>> effectPlans, skillPlans, auraPlans;
Plan& EffectPlan(std::map<EffectKey, std::unique_ptr<Plan>>& plans, int id, PrismTint tint, int kind) {
    auto& plan = plans[{id, tint}];
    if (!plan) {
        auto candidate = std::make_unique<Plan>();
        wchar_t path[160];
        if (kind == 0) swprintf_s(path, L"Item/Cash/0501.img/%08d/effect", id);
        else if (kind == 1) swprintf_s(path, L"Skill/%03d.img/skill/%d", id / 10000, id);
        else swprintf_s(path, L"Effect/ItemEff.img/%d/effect", id);
        candidate->Add(prismabi::Property(path), tint, tint);
        plan = std::move(candidate);
    }
    return *plan;
}
using CashFn = void(__thiscall*)(void*, int);
auto cash = reinterpret_cast<CashFn>(addr::prism::kShowEffectItem);
auto follow = reinterpret_cast<CashFn>(addr::prism::kShowFollowEffectItem);
void CashBuild(CashFn original, void* user, int item) {
    void* avatar = static_cast<unsigned char*>(user) + 0x88;
    PrismTint tint = Tint(avatar, item + 10000000);
    if (!CapsAccepted(caps::kPrismSync) || tint.Identity()) { original(user, item); return; }
    Plan::Swap swap(EffectPlan(effectPlans, item, tint, 0));
    original(user, item);
}
void __fastcall CashHook(void* user, void*, int item) { CashBuild(cash, user, item); }
void __fastcall FollowHook(void* user, void*, int item) { CashBuild(follow, user, item); }
using SkillFn = void(__thiscall*)(void*, const int*, int, int, int, void*);
auto skill = reinterpret_cast<SkillFn>(addr::prism::kShowSkillEffect);
struct SkillFrame { void* avatar; int id; std::optional<Plan::Swap> swap; };
thread_local std::vector<SkillFrame> skillStack;
class SkillScope {
public:
    SkillScope(void* avatar, int id) { WeaponTint_BeginSkillSwap(avatar, id); }
    ~SkillScope() { WeaponTint_EndSkillSwap(); }
};
void __fastcall SkillHook(void* user, void*, const int* entry, int level, int flags, int extra, void* point) {
    SkillScope scope(static_cast<unsigned char*>(user) + 0x88, entry ? *entry : 0);
    skill(user, entry, level, flags, extra, point);
}
using SkillPrepareFn = void(__thiscall*)(void*, const int*, int, int, int);
using SkillSpecialFn = void(__thiscall*)(void*, const int*, int, void*);
auto skillPrepare = reinterpret_cast<SkillPrepareFn>(addr::prism::kShowSkillPrepare);
auto skillSpecial = reinterpret_cast<SkillSpecialFn>(addr::prism::kShowSkillSpecialEffect);
void __fastcall SkillPrepareHook(void* user, void*, const int* entry, int level, int a, int b) {
    SkillScope scope(static_cast<unsigned char*>(user) + 0x88, entry ? *entry : 0);
    skillPrepare(user, entry, level, a, b);
}
void __fastcall SkillSpecialHook(void* user, void*, const int* entry, int level, void* grenade) {
    SkillScope scope(static_cast<unsigned char*>(user) + 0x88, entry ? *entry : 0);
    skillSpecial(user, entry, level, grenade);
}
// DamageInfo is played later by CMob::Update, after the attack scope closed.
// OnHit's first two words retain the caster and skill identity. Preserve every
// other word byte-for-byte; damage decoding/formatting is not owned here.
using MobHitFn = void(__thiscall*)(void*, unsigned int, int, uintptr_t, uintptr_t,
    uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
auto mobHit = reinterpret_cast<MobHitFn>(addr::prism::kMobOnHit);
void __fastcall MobHitHook(void* mob, void*, unsigned int caster, int id,
        uintptr_t a, uintptr_t b, uintptr_t c, uintptr_t d, uintptr_t e,
        uintptr_t f, uintptr_t g, uintptr_t h, uintptr_t i, uintptr_t j, uintptr_t k) {
    void* user = prismabi::User(static_cast<int>(caster));
    void* avatar = user ? static_cast<unsigned char*>(user) + 0x88 : nullptr;
    SkillScope scope(avatar, id);
    mobHit(mob, caster, id, a, b, c, d, e, f, g, h, i, j, k);
}
// The local attack hooks are shared with long damage by composition, not a
// second detour. This one call establishes its overflow lifetime per attack.
// The historical decorated melee name is stale: Angel.idb's actual epilogue
// at 0095355A is RET 1C, seven words, not the twelve in that name.
using MeleeFn = int(__thiscall*)(void*, const int*, int, uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t);
using ShootFn = int(__thiscall*)(void*, const int*, int, int, int, int, unsigned int);
using MagicFn = int(__thiscall*)(void*, const int*, int, int, int);
auto melee = reinterpret_cast<MeleeFn>(addr::prism::kTryMeleeAttack);
auto shoot = reinterpret_cast<ShootFn>(addr::prism::kTryShootAttack);
auto magic = reinterpret_cast<MagicFn>(addr::prism::kTryMagicAttack);
int __fastcall MeleeHook(void* user, void*, const int* entry, int a, uintptr_t b, uintptr_t c, uintptr_t d, uintptr_t e, uintptr_t f) {
    DamageLong_BeginLocalAttack();
    SkillScope scope(static_cast<unsigned char*>(user) + 0x88, entry ? *entry : 0);
    return melee(user, entry, a, b, c, d, e, f);
}
int __fastcall ShootHook(void* user, void*, const int* entry, int a, int b, int c, int d, unsigned int e) {
    DamageLong_BeginLocalAttack();
    SkillScope scope(static_cast<unsigned char*>(user) + 0x88, entry ? *entry : 0);
    return shoot(user, entry, a, b, c, d, e);
}
int __fastcall MagicHook(void* user, void*, const int* entry, int a, int b, int c) {
    DamageLong_BeginLocalAttack();
    SkillScope scope(static_cast<unsigned char*>(user) + 0x88, entry ? *entry : 0);
    return magic(user, entry, a, b, c);
}
// CreateBullet queues a UOL for a LATER tick (RET 2C, eleven words). Holding a
// shared WZ swap until arrival would leak one player's dye to a concurrent cast
// of the same skill. Instead queue an immutable, palette-specific namespace
// path. Native bullets/layers retain their own references, including volleys
// and Final Attack interleaved with an earlier skill.
struct ProjectileArt {
    std::wstring source;
    PrismTint tint;
    IWzPropertyPtr parent;
    Ztl_bstr_t child;
    Ztl_bstr_t path;
};
std::vector<ProjectileArt> projectileArt;
unsigned int projectileSerial = 0;
IWzPropertyPtr SnapshotProperty(IWzPropertyPtr source, PrismTint tint,
        std::vector<IWzProperty*>& ancestors, int depth = 0) {
    if (!source || depth > 64 || std::find(ancestors.begin(), ancestors.end(),
            source.GetInterfacePtr()) != ancestors.end()) return nullptr;
    ancestors.push_back(source);
    IWzPropertyPtr result;
    PcCreateObject<IWzPropertyPtr>(L"Property", result, nullptr);
    IEnumVARIANTPtr enumeration = source->_NewEnum;
    for (;;) {
        Ztl_variant_t key;
        ULONG count = 0;
        if (FAILED(enumeration->Next(1, &key, &count)) || !count) break;
        Ztl_bstr_t name(key);
        if (wcsncmp(name.GetBSTR(), L"__bunsPrism", 11) == 0) continue;
        Ztl_variant_t value = source->item[name];
        Ztl_variant_t resolve(value);
        IUnknownPtr unknown = get_unknown(resolve);
        IWzCanvasPtr canvas;
        IWzPropertyPtr property;
        if (unknown && SUCCEEDED(unknown.QueryInterface(__uuidof(IWzCanvas), &canvas))) {
            // A synchronous outer cast may already have installed a clone.
            // Use its ORIGINAL as input, never HSV-transform a clone twice.
            for (const auto& clone : clones) if (clone.canvas == canvas) {
                canvas = clone.original; break;
            }
            value = Ztl_variant_t(CloneCanvas(canvas, tint).GetInterfacePtr());
        } else if (unknown && SUCCEEDED(unknown.QueryInterface(__uuidof(IWzProperty), &property))) {
            auto nested = SnapshotProperty(property, tint, ancestors, depth + 1);
            if (nested) value = Ztl_variant_t(nested.GetInterfacePtr());
        }
        result->item[name] = value;
    }
    ancestors.pop_back();
    return result;
}
using BulletFn = void(__thiscall*)(void*, int, int, int, int, int, int, void*, int, uintptr_t, int, int);
auto bullet = reinterpret_cast<BulletFn>(addr::prism::kCreateBullet);
void __fastcall BulletHook(void* displayer, void*, int start, int arrive,
        int x, int y, int targetX, int targetY, void* origin, int z,
        uintptr_t nativeBallString, int extra, int item) {
    // Move the callee-owned _bstr_t word into our ABI-compatible wrapper, then
    // move it into the original callee. Never let two destructors own one ref.
    static_assert(sizeof(Ztl_bstr_t) == sizeof(uintptr_t));
    Ztl_bstr_t ball;
    memcpy(&ball, &nativeBallString, sizeof(nativeBallString));
    WeaponTint_NoteBulletFlight(&ball, item, arrive);
    memcpy(&nativeBallString, &ball, sizeof(nativeBallString));
    memset(&ball, 0, sizeof(ball));
    bullet(displayer, start, arrive, x, y, targetX, targetY, origin, z,
        nativeBallString, extra, item);
}
std::optional<Plan::Swap> cashPreviewSwap;
std::optional<Plan::Swap> itemEffSwap;
unsigned int itemEffDepth = 0;
bool SyncRoute(unsigned short opcode, CInPacket* packet) {
    return opcode == 0x372F ? WeaponTint_HandleSync(packet) : false;
}
void PrunePreviewTint(PrismTint tint) {
    if (tint.Identity() || activeAppearance || itemEffDepth || !skillStack.empty() || cashPreviewSwap) return;
    for (const auto& palette : palettes) for (const auto& entry : palette.second)
        if (entry.tint == tint) return;
    for (const auto& preview : previews) if (preview.second.tint == tint) return;
    // Slider exploration must not retain hundreds of full animation palettes.
    // Surviving native layers and immutable projectile snapshots own their refs.
    for (auto* plans : {&effectPlans, &skillPlans, &auraPlans})
        for (auto i = plans->begin(); i != plans->end();)
            if (i->first.tint == tint) i = plans->erase(i); else ++i;
    clones.erase(std::remove_if(clones.begin(), clones.end(),
        [tint](const Clone& clone) { return clone.tint == tint; }), clones.end());
}
void RefreshUser(void* user) {
    void* avatar = static_cast<unsigned char*>(user) + 0x88;
    contexts.erase(avatar);
    if (!prismabi::Rebuild(avatar)) return;
    // Native SetActiveEffectItem stores the persistent identity at user+2A44
    // (0093BB61), unlike AdditionalLayer+8 which is reset to -1 on the follow
    // path. Replay that exact state through its existing unhooked coordinator.
    reinterpret_cast<void(__thiscall*)(void*, int)>(
        addr::prism::kSetActiveEffectItem)(user, prismabi::At<int>(user, 0x2A44));
}
} // namespace

void WeaponTint_NoteBulletFlight(void* ballUol, int, int) {
    if (!ballUol || skillStack.empty() || !CapsAccepted(caps::kPrismSync)) return;
    auto& ball = *static_cast<Ztl_bstr_t*>(ballUol);
    const wchar_t* path = ball.GetBSTR();
    if (!path || !*path) return;
    const auto& cast = skillStack.back();
    // A Final Attack can queue after its nested ShowSkillEffect returned.
    // Its UOL, not the outer attack's id, identifies that projectile's palette.
    int skillId = cast.id;
    if (const wchar_t* marker = wcsstr(path, L"/skill/")) {
        wchar_t* end = nullptr;
        const long parsed = wcstol(marker + 7, &end, 10);
        if (parsed > 0 && parsed <= 2000000000L && end && (*end == L'/' || !*end))
            skillId = static_cast<int>(parsed);
    }
    PrismTint tint = Tint(cast.avatar, skillId + 30000000);
    if (tint.Identity()) return;
    for (const auto& cached : projectileArt) {
        if (cached.tint == tint && cached.source == path) { ball = cached.path; return; }
    }
    const wchar_t* slash = wcsrchr(path, L'/');
    if (!slash) return; // no skill UOL: native ammunition art remains native
    std::wstring parentPath(path, static_cast<size_t>(slash - path));
    auto parent = prismabi::Property(parentPath.c_str());
    auto source = prismabi::Property(path);
    if (!parent || !source) return;
    std::vector<IWzProperty*> ancestors;
    auto snapshot = SnapshotProperty(source, tint, ancestors);
    wchar_t child[64];
    swprintf_s(child, L"__bunsPrism%u", ++projectileSerial);
    std::wstring redirected = parentPath + L"/" + child;
    ProjectileArt art{path, tint, parent, Ztl_bstr_t(child), Ztl_bstr_t(redirected.c_str())};
    parent->item[art.child] = Ztl_variant_t(snapshot.GetInterfacePtr());
    projectileArt.push_back(std::move(art));
    ball = projectileArt.back().path;
}
bool WeaponTint_BeginCashPreview(void* avatar, int item) {
    if (!CapsAccepted(caps::kPrismSync)) return false;
    const PrismTint tint = Tint(avatar, item + 10000000);
    if (tint.Identity()) return false;
    cashPreviewSwap.emplace(EffectPlan(effectPlans, item, tint, 0));
    return true;
}
void WeaponTint_EndCashPreview() { cashPreviewSwap.reset(); }
PrismTint WeaponTint_Get(int characterId, int key) {
    if (!CapsAccepted(caps::kPrismSync)) return {};
    auto p = palettes.find(characterId);
    return p == palettes.end() ? PrismTint{} : Find(p->second, key);
}
uint64_t WeaponTint_Revision(int characterId) {
    auto version = characterRevisions.find(characterId);
    return version == characterRevisions.end() ? 0 : version->second;
}
void WeaponTint_Reset() {
    std::lock_guard<std::mutex> lock(receiveMutex);
    ++epoch;
    pending.clear();
    resetPending.store(true, std::memory_order_release);
}
bool WeaponTint_HandleSync(CInPacket* packet) {
    if (!packet) return true;
    const uint64_t connection = epoch.load(std::memory_order_acquire);
    if (!packet->SkipOpcode() || !CapsAccepted(caps::kPrismSync)) return true;
    unsigned char response = 0;
    int character = 0;
    unsigned short count = 0;
    if (!packet->Decode1(response) || response != 0 || !packet->Decode4(character) ||
        character <= 0 || !packet->Decode2(count) || !packet->CanRead(static_cast<size_t>(count) * 8)) return true;
    Palette decoded;
    decoded.reserve(count);
    for (unsigned int i = 0; i < count; ++i) {
        Entry e{};
        if (!packet->Decode4(e.key) || !packet->Decode(e.tint.hue) ||
            !packet->Decode(e.tint.chroma) || !packet->Decode(e.tint.bright)) return true;
        if (e.tint.hue < -360 || e.tint.hue > 359 || e.tint.chroma < -100 ||
            e.tint.chroma > 100 || e.tint.bright < -100 || e.tint.bright > 100 ||
            (e.key < 0 && e.key != -1 && e.key != -2 && e.key != -3) || e.key == 0) return true;
        if (!e.tint.Identity()) decoded.push_back(e);
    }
    std::sort(decoded.begin(), decoded.end(), [](const Entry& a, const Entry& b) { return a.key < b.key; });
    for (size_t i = 1; i < decoded.size(); ++i) if (decoded[i - 1].key == decoded[i].key) return true;
    std::lock_guard<std::mutex> lock(receiveMutex);
    if (connection == epoch.load(std::memory_order_relaxed) && CapsAccepted(caps::kPrismSync))
        pending[character] = std::move(decoded);
    return true;
}
void WeaponTint_SetPreview(void* avatar, int character, int key, PrismTint tint) {
    if (!avatar || !CapsAccepted(caps::kPrismSync)) return;
    auto p = previews.find(avatar);
    if (p != previews.end() && p->second.character == character && p->second.key == key && p->second.tint == tint) return;
    const PrismTint previous = p == previews.end() ? PrismTint{} : p->second.tint;
    previews[avatar] = {character, key, tint, ++revision};
    contexts.erase(avatar);
    PrunePreviewTint(previous);
}
void WeaponTint_ClearPreview(void* avatar) {
    auto preview = previews.find(avatar);
    PrismTint previous = preview == previews.end() ? PrismTint{} : preview->second.tint;
    previews.erase(avatar); contexts.erase(avatar);
    PrunePreviewTint(previous);
}
uint64_t WeaponTint_ItemEffRevision(void* avatar) {
    return CapsAccepted(caps::kPrismSync) ? Version(avatar) : 0;
}
bool WeaponTint_BeginItemEffSwap(void* avatar, int item) {
    // Nested misuse cannot restore the outer swap early; the owner still must
    // obey its non-reentrant contract. Every Begin consumes one matching End.
    if (itemEffDepth++ != 0) return false;
    if (!CapsAccepted(caps::kPrismSync)) return false;
    const PrismTint tint = Tint(avatar, item + 10000000);
    if (tint.Identity()) return false;
    try { itemEffSwap.emplace(EffectPlan(auraPlans, item, tint, 2)); }
    catch (...) { --itemEffDepth; throw; }
    return true;
}
void WeaponTint_EndItemEffSwap() {
    if (itemEffDepth && --itemEffDepth == 0) itemEffSwap.reset();
}
bool WeaponTint_BeginSkillSwap(void* avatar, int id) {
    const bool duplicate = !skillStack.empty() && skillStack.back().avatar == avatar && skillStack.back().id == id;
    std::optional<Plan::Swap> swap;
    if (!duplicate && id > 0 && CapsAccepted(caps::kPrismSync)) {
        PrismTint tint = Tint(avatar, id + 30000000);
        if (!tint.Identity()) swap.emplace(EffectPlan(skillPlans, id, tint, 1));
    }
    const bool applied = swap.has_value() || duplicate;
    skillStack.push_back({avatar, id, std::move(swap)});
    return applied;
}
void WeaponTint_EndSkillSwap() { if (!skillStack.empty()) skillStack.pop_back(); }
namespace {
std::map<int, bool> effectArt;
bool ContainsEffect(IWzPropertyPtr property, std::vector<IWzProperty*>& ancestors, int depth) {
    if (!property || depth > 64 || std::find(ancestors.begin(), ancestors.end(), property.GetInterfacePtr()) != ancestors.end()) return false;
    ancestors.push_back(property);
    IEnumVARIANTPtr enumeration = property->_NewEnum;
    for (;;) {
        Ztl_variant_t key;
        ULONG count = 0;
        if (FAILED(enumeration->Next(1, &key, &count)) || !count) break;
        Ztl_bstr_t name(key);
        auto value = property->item[name];
        IUnknownPtr resolved = get_unknown(value);
        if (!resolved) continue;
        if (wcsncmp(name.GetBSTR(), L"effect", 6) == 0) { ancestors.pop_back(); return true; }
        IWzCanvasPtr canvas;
        if (SUCCEEDED(resolved.QueryInterface(__uuidof(IWzCanvas), &canvas))) continue;
        IWzPropertyPtr child;
        if (SUCCEEDED(resolved.QueryInterface(__uuidof(IWzProperty), &child)) && ContainsEffect(child, ancestors, depth + 1)) {
            ancestors.pop_back(); return true;
        }
    }
    ancestors.pop_back();
    return false;
}
}
bool WeaponTint_ItemHasEffectArt(int item) {
    if (item >= 5010000 && item <= 5019999) return true;
    auto cached = effectArt.find(item);
    if (cached != effectArt.end()) return cached->second;
    std::vector<IWzProperty*> ancestors;
    wchar_t path[128];
    swprintf_s(path, L"Effect/ItemEff.img/%d/effect", item);
    bool result = prismabi::Property(path) != nullptr || ContainsEffect(ItemRoot(item), ancestors, 0);
    effectArt[item] = result;
    return result;
}
void WeaponTint_Tick() {
    std::map<int, Palette> updates;
    bool reset = resetPending.exchange(false, std::memory_order_acq_rel);
    {
        std::lock_guard<std::mutex> lock(receiveMutex);
        updates.swap(pending);
    }
    static bool wasAccepted = false;
    const bool accepted = CapsAccepted(caps::kPrismSync);
    if (wasAccepted && !accepted) reset = true;
    wasAccepted = accepted;
    if (reset) {
        // Rebuild live characters with the cap gate already closed/empty state.
        std::map<int, Palette> oldPalettes;
        oldPalettes.swap(palettes);
        previews.clear(); contexts.clear(); characterRevisions.clear();
        ++revision;
        ColorPrism_Reset();
        for (const auto& old : oldPalettes) if (!old.second.empty())
            if (void* user = prismabi::User(old.first)) RefreshUser(user);
        for (const auto& art : projectileArt) art.parent->Remove(art.child);
        projectileArt.clear();
        effectPlans.clear(); skillPlans.clear(); auraPlans.clear(); clones.clear();
    }
    if (!CapsAccepted(caps::kPrismSync)) return;
    for (auto& update : updates) {
        auto& current = palettes[update.first];
        if (current == update.second) continue;
        current = std::move(update.second);
        characterRevisions[update.first] = ++revision;
        if (void* user = prismabi::User(update.first)) RefreshUser(user);
    }
    ColorPrism_Tick();
}
bool AttachWeaponTintMod() {
    HMODULE kaentake = GetModuleHandleW(L"Kaentake.dll");
    auto bind = kaentake ? reinterpret_cast<RegisterPrismItemEffBridge>(
        GetProcAddress(kaentake, "Kaentake_SetPrismItemEffBridge")) : nullptr;
    static const PrismItemEffBridge bridge{kPrismItemEffBridgeVersion,
        &WeaponTint_BeginItemEffSwap, &WeaponTint_EndItemEffSwap,
        &WeaponTint_ItemEffRevision};
    if (!bind || !bind(&bridge)) return false;
    return RegisterPacketRoute(0x372F, &SyncRoute) &&
        ATTACH_HOOK(prepare, PrepareHook) && ATTACH_HOOK(face, FaceHook) &&
        ATTACH_HOOK(cash, CashHook) && ATTACH_HOOK(follow, FollowHook) &&
        ATTACH_HOOK(skill, SkillHook) && ATTACH_HOOK(melee, MeleeHook) &&
        ATTACH_HOOK(shoot, ShootHook) && ATTACH_HOOK(magic, MagicHook) &&
        ATTACH_HOOK(bullet, BulletHook) && ATTACH_HOOK(mobHit, MobHitHook) &&
        ATTACH_HOOK(skillPrepare, SkillPrepareHook) && ATTACH_HOOK(skillSpecial, SkillSpecialHook);
}
