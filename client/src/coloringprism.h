#pragma once
// Four dispatch callbacks below; the S2C route is WeaponTint_HandleSync.
class IUIMsgHandler;
bool AttachColoringPrismMod();
void ColorPrism_Tick();
// Main-thread only. Parent socket reset calls WeaponTint_Reset(), which queues
// this UI teardown on the sole main-thread WeaponTint_Tick driver.
void ColorPrism_Reset();
// The single cash-use/drop owner calls these; this module installs NO item-use,
// cash-type gate, item-drop, receive, send, reset, inlink, or tick detours.
bool ColorPrism_IsPrismItem(int itemId);
void ColorPrism_OnUse(int inventoryPosition, int itemId);
bool ColorPrism_HandleItemDrop(IUIMsgHandler* destination, int inventoryType, int inventoryPosition);
bool ColorPrism_HandleSkillDrop(void* destination, int skillId);

bool ColorPrism_ResourcesReady();
