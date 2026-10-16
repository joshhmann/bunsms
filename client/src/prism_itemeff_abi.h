#pragma once
#include <cstdint>
// Shared by the parent-patched pinned Kaentake owner and this module. POD only:
// no strings, COM smart pointers, CRT allocations, or object ownership transfer
// in the ABI. Registration precedes any custom rendering; the table is immutable.
struct PrismItemEffBridge {
    uint32_t version;
    bool (__cdecl* begin)(void* avatar, int itemId);
    void (__cdecl* end)();
    uint64_t (__cdecl* revision)(void* avatar);
};
inline constexpr uint32_t kPrismItemEffBridgeVersion = 1;
static_assert(sizeof(PrismItemEffBridge) == 16, "Prism is a stock-v83 Win32 ABI");
using RegisterPrismItemEffBridge = bool (__cdecl*)(const PrismItemEffBridge* bridge);
