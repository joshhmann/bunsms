#pragma once
#include "../ztl/ztl.h"

inline IWzGr2DPtr& get_gr() {
    return *reinterpret_cast<IWzGr2DPtr*>(0x00BF14EC);
}

inline IWzResManPtr& get_rm() {
    return *reinterpret_cast<IWzResManPtr*>(0x00BF14E8);
}

inline IWzNameSpacePtr& get_root() {
    return *reinterpret_cast<IWzNameSpacePtr*>(0x00BF14E0);
}

inline int get_int32(Ztl_variant_t& v, int nDefault) {
    Ztl_variant_t vInt;
    if (V_VT(&v) == VT_EMPTY || V_VT(&v) == VT_ERROR || FAILED(ZComAPI::ZComVariantChangeType(&vInt, &v, 0, VT_I4))) {
        return nDefault;
    } else {
        return V_I4(&vInt);
    }
}

// implementation in resolution.cpp
int get_screen_width();
int get_screen_height();
int get_adjust_cy();

// Kaentake-primary: direct engine call (0x00414ADA). Kaentake.dll's inlink
// supplies link-following when co-loaded; this tree installs no hook here.
inline IUnknownPtr get_unknown(Ztl_variant_t& v) {
    IUnknownPtr pUnk;
    reinterpret_cast<IUnknownPtr*(__cdecl*)(IUnknownPtr*, Ztl_variant_t&)>(0x00414ADA)(
        std::addressof(pUnk), v);
    return pUnk;
}