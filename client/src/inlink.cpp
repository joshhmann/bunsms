#include "pch.h"
#include "inlink.h"
#include "hook.h"
#include "addresses.h"
#include "wvs/util.h"
#include "ztl/ztl.h"

namespace {

// Link-following half of Kaentake's HandleLinkProperty (inlink.cpp):
// resolve _inlink / _outlink / source to the source canvas snapshot.
void HandleLinkProperty(IWzCanvasPtr pCanvas) {
    static const wchar_t* asLinkProperty[] = {
        L"_inlink",
        L"_outlink",
        L"source",
    };
    for (size_t i = 0; i < 3; ++i) {
        Ztl_variant_t vLink = pCanvas->property->item[asLinkProperty[i]];
        if (V_VT(&vLink) != VT_BSTR) {
            continue;
        }

        IWzCanvasPtr pSource;
        IUnknownPtr pUnknown = get_rm()->GetObjectA(V_BSTR(&vLink)).GetUnknown();
        if (!pUnknown || FAILED(pUnknown->QueryInterface(&pSource))) {
            DEBUG_MESSAGE("Could not resolve linked canvas %ls=\"%ls\"", asLinkProperty[i], V_BSTR(&vLink));
            continue;
        }

        int nWidth, nHeight, nFormat, nMagLevel;
        pSource->GetSnapshot(&nWidth, &nHeight, nullptr, nullptr, (CANVAS_PIXFORMAT*)&nFormat, &nMagLevel);
        pCanvas->Create(nWidth, nHeight, nMagLevel, nFormat);
        pCanvas->AddRawCanvas(0, 0, pSource->rawCanvas[0][0]);

        IWzVector2DPtr pOrigin = pCanvas->property->item[L"origin"].GetUnknown();
        pCanvas->cx = pOrigin->x;
        pCanvas->cy = pOrigin->y;
        break;
    }
}

using GetUnknown_t = IUnknownPtr*(__cdecl*)(IUnknownPtr*, Ztl_variant_t&);
GetUnknown_t g_GetUnknownOrig = reinterpret_cast<GetUnknown_t>(addr::kGetUnknown);
using VariantGetUnknown_t = IUnknown*(__thiscall*)(Ztl_variant_t*, bool, bool);
VariantGetUnknown_t g_VariantGetUnknownOrig =
    reinterpret_cast<VariantGetUnknown_t>(addr::kVariantGetUnknown);


IUnknown* __fastcall VariantGetUnknown_hook(Ztl_variant_t* pThis, void* /*edx*/, bool fAddRef, bool fTryChangeType) {
    IUnknownPtr result = pThis->GetUnknown(fAddRef, fTryChangeType);
    IWzCanvasPtr pCanvas;
    if (SUCCEEDED(result.QueryInterface(__uuidof(IWzCanvas), &pCanvas))) {
        HandleLinkProperty(pCanvas);
    }
    return result;
}

} // namespace
IUnknownPtr* __cdecl get_unknown_hook(IUnknownPtr* result, Ztl_variant_t& v) {
    g_GetUnknownOrig(result, v);
    IWzCanvasPtr pCanvas;
    if (SUCCEEDED(result->QueryInterface(__uuidof(IWzCanvas), &pCanvas))) {
        HandleLinkProperty(pCanvas);
    }
    return result;
}

// Co-load ownership rule: Kaentake hooks this same pair (its inlink does
// everything this file does, plus the raw_Serialize half). If Kaentake.dll
// is already loaded in-process, SKIP both hooks and ride its link
// resolution — double-Detour would run HandleLinkProperty twice on the
// same canvas. Stock-profile loads (no Kaentake) install ours.
void AttachInlinkMod() {
    if (GetModuleHandleA("Kaentake.dll") != nullptr) {
        DEBUG_MESSAGE("inlink: Kaentake.dll present, deferring get_unknown pair");
        return;
    }
    ATTACH_HOOK(g_GetUnknownOrig, get_unknown_hook);
    ATTACH_HOOK(g_VariantGetUnknownOrig, VariantGetUnknown_hook);
}
