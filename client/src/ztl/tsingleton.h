#pragma once
// NOTE: C4100 (unreferenced parameter) is disabled in this vendored
// engine-interface header. The virtual-stub signatures mirror the stock v83
// engine ABI (cf. Kaentake, which builds without /WX); parameter names are
// kept for ABI documentation. Our own sources (dispatcher/tick/injector/
// dailycheckin/hook/debug) still build under /WX — see src/CMakeLists.txt.
#pragma warning(push)
#pragma warning(disable : 4100)
#include <cstdint>


template <typename T, uintptr_t ADDRESS>
class TSingleton {
public:
    inline static T*& ms_pInstance = *reinterpret_cast<T**>(ADDRESS);

    static T* GetInstance() {
        return ms_pInstance;
    }
    static bool IsInstantiated() {
        return ms_pInstance != nullptr;
    }
};