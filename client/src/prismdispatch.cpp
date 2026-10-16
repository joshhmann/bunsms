#include "pch.h"
#include "prismdispatch.h"
#include "coloringprism.h"
#include "caps.h"
#include "hook.h"
#include "addresses.h"
#include "ztl/zstr.h"

namespace {
using CashType = int(__cdecl*)(int);
using CashUse = void(__thiscall*)(void*, int, int, int, ZXString<char>);
using EtcUse = void(__thiscall*)(void*, int, int);
using ItemDrop = int(__thiscall*)(void*, IUIMsgHandler*, IUIMsgHandler*, int, int);
auto cashType = reinterpret_cast<CashType>(addr::prism::kConsumeCashItemType);
auto cashUse = reinterpret_cast<CashUse>(addr::prism::kConsumeCashItemUse);
auto etcUse = reinterpret_cast<EtcUse>(addr::prism::kEtcCashItemUse);
auto itemDrop = reinterpret_cast<ItemDrop>(addr::prism::kItemOnDropped);

bool OwnsPrism(int item) {
    return CapsAccepted(caps::kPrismSync) && ColorPrism_IsPrismItem(item);
}
int __cdecl CashTypeHook(int item) {
    return OwnsPrism(item) ? 1 : cashType(item);
}
void __fastcall CashUseHook(void* context, void*, int position, int item, int extra, ZXString<char> text) {
    if (OwnsPrism(item)) {
        ColorPrism_OnUse(position, item);
        return; // The incoming native string reference is released by its destructor.
    }
    cashUse(context, position, item, extra, text);
}
void __fastcall EtcUseHook(void* context, void*, int position, int item) {
    if (OwnsPrism(item)) {
        ColorPrism_OnUse(position, item);
        return;
    }
    etcUse(context, position, item);
}
struct DragSource { int type; int position; };
// This SEH leaf does not own objects requiring C++ unwinding. Accept only the
// actual stock inventory/equipped-items handlers; custom bags/catalogs are not
// allowed to reinterpret their private slot numbers as inventory positions.
bool ReadInventorySource(void* drag, IUIMsgHandler* from, DragSource& result) {
    if (!drag || !from) return false;
    __try {
        const auto bytes = static_cast<const unsigned char*>(drag);
        const auto source = *reinterpret_cast<IUIMsgHandler* const*>(bytes + 0x24);
        if (source != from) return false;
        const auto vtable = *reinterpret_cast<const uintptr_t*>(source);
        if (vtable != addr::prism::kInventoryHandlerVtable &&
            vtable != addr::prism::kEquipHandlerVtable) return false;
        result.type = *reinterpret_cast<const int*>(bytes + 0x18);
        result.position = *reinterpret_cast<const int*>(bytes + 0x1C);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}
int __fastcall ItemDropHook(void* drag, void*, IUIMsgHandler* from, IUIMsgHandler* to, int x, int y) {
    DragSource source{};
    if (CapsAccepted(caps::kPrismSync) && ReadInventorySource(drag, from, source) &&
        ColorPrism_HandleItemDrop(to, source.type, source.position)) return 1;
    return itemDrop(drag, from, to, x, y);
}
}

bool AttachPrismDispatch() {
    return ATTACH_HOOK(cashType, CashTypeHook) && ATTACH_HOOK(cashUse, CashUseHook) &&
        ATTACH_HOOK(etcUse, EtcUseHook) && ATTACH_HOOK(itemDrop, ItemDropHook);
}
