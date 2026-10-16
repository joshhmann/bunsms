#pragma once
#include "addresses.h"
#include "hook.h"
#include "caps.h"
#include "wvs/field.h"
#include "wvs/packet.h"

// Layout-only view; never constructed or owned by the CRT. Native this pointers
// retain the CMapLoadable base address and engine allocator/COM ownership.
class WeatherMapLoadable : public CMapLoadable {
public:
    MEMBER_AT(IWzPropertyPtr, 0x30, m_pPropField)
    MEMBER_HOOK(void, addr::weather::LoadMap, LoadMap)
    MEMBER_HOOK(void, addr::weather::Update, Update)
    MEMBER_HOOK(void, addr::weather::RestoreTile, RestoreTile)
    MEMBER_HOOK(void, addr::weather::RestoreObj, RestoreObj)
    MEMBER_HOOK(void, addr::weather::RestoreBack, RestoreBack)
    MEMBER_HOOK(void*, addr::weather::MakeBack, MakeBack, int nIndex, void* pProp)
    MEMBER_HOOK(void*, addr::weather::MakeObj, MakeObj, int nLayer, IWzProperty* pObjProp)
};
class WeatherNpcPool {
public:
    MEMBER_HOOK(void, addr::weather::OnNpcEnterField, OnNpcEnterField, void* pPacket)
};

template<class T> T WeatherDecode(CInPacket* packet) {
    T value{};
    packet->Decode(value);
    return value;
}

// Receive/reset callers publish only; the sole main-thread frame owner performs
// all property mutation, COM teardown and physics/audio restoration.
void Weather_Reset();
void Weather_Frame();
void Weather_Tick();
bool AttachWeatherMod();
bool AttachWeatherWindMod();
void Lamps_Reset();
// Native weather slot is cleared only while its owning field remains live.
void WeatherFx_Disable();
void WeatherFx_EnterMap();
