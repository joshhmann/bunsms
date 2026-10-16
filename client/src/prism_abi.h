#pragma once
// Prism-only stock-v83 ABI. Engine-owned objects are created/released by the
// engine; no CRT ownership crosses this boundary. Addresses live in addresses.h.
#include "addresses.h"
#include "ztl/ztl.h"
#include "wvs/util.h"
#include <array>
#include <cstring>

namespace prismabi {
template<class T> T& At(void* p, size_t offset) {
    return *reinterpret_cast<T*>(static_cast<unsigned char*>(p) + offset);
}
inline void* CharacterData() {
    void* context = *reinterpret_cast<void**>(addr::prism::kWvsContext);
    return context ? At<void*>(context, 2094 * 4) : nullptr;
}
inline int LocalCharacterId() {
    void* user = *reinterpret_cast<void**>(addr::prism::kUserLocal);
    return user ? At<int>(user, 0x11A8) : 0;
}
inline void* User(int id) {
    void* pool = *reinterpret_cast<void**>(addr::prism::kUserPool);
    return pool ? reinterpret_cast<void*(__thiscall*)(void*, unsigned int)>(
        addr::prism::kGetUser)(pool, static_cast<unsigned int>(id)) : nullptr;
}
inline int AvatarCharacterId(void* avatar) {
    if (!avatar) return 0;
    const auto table = At<uintptr_t>(avatar, 0);
    if (table != addr::prism::kUserAvatarVtable &&
        table != addr::prism::kLocalAvatarVtable &&
        table != addr::prism::kRemoteAvatarVtable) return 0;
    return At<int>(static_cast<unsigned char*>(avatar) - 0x88, 0x11A8);
}
inline int ItemId(int type, int position) {
    void* data = CharacterData();
    if (!data || type < 1 || type > 5 || !position) return 0;
    unsigned int ref[2]{};
    reinterpret_cast<void*(__thiscall*)(void*, void*, int, int)>(
        addr::prism::kCharacterGetItem)(data, ref, type, position);
    if (!ref[1]) return 0;
    int id = reinterpret_cast<int(__thiscall*)(void*)>(addr::prism::kSecureIntGet)(
        reinterpret_cast<unsigned char*>(ref[1]) + 0xC);
    reinterpret_cast<void(__thiscall*)(void*)>(addr::prism::kItemRefDestroy)(ref);
    return id;
}
inline IWzCanvasPtr Canvas(const wchar_t* path) {
    auto value = get_rm()->GetObjectA(path);
    IUnknownPtr unknown = get_unknown(value);
    IWzCanvasPtr canvas;
    if (unknown) unknown.QueryInterface(__uuidof(IWzCanvas), &canvas);
    return canvas;
}
inline IWzPropertyPtr Property(const wchar_t* path) {
    auto value = get_rm()->GetObjectA(path);
    IUnknownPtr unknown = get_unknown(value);
    IWzPropertyPtr property;
    if (unknown) unknown.QueryInterface(__uuidof(IWzProperty), &property);
    return property;
}
inline bool Rebuild(void* avatar) {
    // A sync may precede native avatar initialization. Keep the published tint;
    // the normal Init/Prepare hooks apply it once real layers exist.
    if (!avatar || !At<IWzGr2DLayer*>(avatar, 0x10C8)) return false;
    reinterpret_cast<void(__thiscall*)(void*, int)>(addr::prism::kClearActionLayer)(avatar, 0);
    reinterpret_cast<void(__thiscall*)(void*, int)>(addr::prism::kClearActionLayer)(avatar, 1);
    auto* table = At<void**>(avatar, 0);
    // Preserve CUser's virtual PrepareActionLayer adjustment (and upstream
    // composition); the base engine call reaches our one owned detour.
    reinterpret_cast<void(__thiscall*)(void*, int, int, int)>(table[5])(avatar, 6, 100, 0);
    reinterpret_cast<void(__thiscall*)(void*, int)>(addr::prism::kPrepareFaceLayer)(avatar, -1);
    return true;
}
inline int ActionNamed(const wchar_t* wanted) {
    // Code->name has a caller-owned out parameter. The reverse lookup consumes
    // a ZXString<wchar_t>, NOT a BSTR, and must not be called with our wrappers.
    for (int code = 0; code < 162; ++code) {
        Ztl_bstr_t name;
        reinterpret_cast<Ztl_bstr_t*(__cdecl*)(Ztl_bstr_t*, int)>(
            addr::prism::kActionNameFromCode)(&name, code);
        if (name.GetBSTR() && _wcsicmp(name.GetBSTR(), wanted) == 0) return code;
    }
    return -1;
}
// Init and Update can emit EmotionEffect into g_pField. A detached preview must
// hide the field for exactly the duration of that synchronous engine call.
class HideField {
    void** field_ = reinterpret_cast<void**>(addr::prism::kCurrentField);
    void* saved_ = *field_;
public:
    HideField() { *field_ = nullptr; }
    ~HideField() { *field_ = saved_; }
    HideField(const HideField&) = delete;
    HideField& operator=(const HideField&) = delete;
};
class Preview {
    unsigned int ref_[2]{};
public:
    void* avatar = nullptr;
    ~Preview() { Clear(); }
    void Clear() {
        avatar = nullptr;
        if (ref_[1]) reinterpret_cast<long(__thiscall*)(void*, int)>(
            addr::prism::kAvatarRefRelease)(ref_, 0);
        ref_[0] = ref_[1] = 0;
    }
    // Call SetPreview before Init: Init builds layers through the tint hooks.
    bool Allocate() {
        Clear();
        avatar = reinterpret_cast<void*(__thiscall*)(void*)>(addr::prism::kAvatarRefAlloc)(ref_);
        return avatar != nullptr;
    }
    void Initialize(IWzGr2DLayer* layer, int item = 0) {
        std::array<unsigned char, 0x210> look{};
        reinterpret_cast<void*(__thiscall*)(void*, void*)>(addr::prism::kAvatarLookCtor)(
            look.data(), CharacterData());
        int slot = 0;
        switch (item / 10000) {
        case 100: slot = 1; break; case 101: slot = 2; break;
        case 102: slot = 3; break; case 103: slot = 4; break;
        case 104: case 105: slot = 5; break; case 106: slot = 6; break;
        case 107: slot = 7; break; case 108: slot = 8; break;
        case 109: slot = 10; break; case 110: slot = 9; break;
        default: if (item / 100000 == 13 || item / 100000 == 14) slot = 11; break;
        }
        if (slot) *reinterpret_cast<int*>(look.data() + 0x19 + slot * 4) = item;
        if (item / 100000 == 17) *reinterpret_cast<int*>(look.data() + 0x15) = item;
        layer->AddRef(); layer->AddRef();
        HideField hidden;
        reinterpret_cast<void(__thiscall*)(void*, void*, int, void*, void*, int, int, int, int, int)>(
            addr::prism::kAvatarInit)(avatar, look.data(), 4, layer, layer, 1, 150, 207, 100, 0);
    }
    void Update() {
        if (!avatar) return;
        HideField hidden;
        reinterpret_cast<void(__thiscall*)(void*)>(addr::prism::kAvatarUpdate)(avatar);
    }
    void Move(int packedAction) {
        if (avatar) reinterpret_cast<void(__thiscall*)(void*, int, int)>(
            addr::prism::kAvatarSetMoveAction)(avatar, packedAction, 0);
    }
    void Action(int action) {
        if (avatar) reinterpret_cast<void(__thiscall*)(void*, int)>(
            addr::prism::kAvatarSetActionCode)(avatar, action);
    }
    void Position(int x, int y) {
        if (!avatar) return;
        auto* vector = At<IWzVector2D*>(avatar, 0x10AC);
        if (vector) vector->RelMove(x, y);
    }
};
} // namespace prismabi
