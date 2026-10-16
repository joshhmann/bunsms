#pragma once
// NOTE: C4100 (unreferenced parameter) is disabled in this vendored
// engine-interface header. The virtual-stub signatures mirror the stock v83
// engine ABI (cf. Kaentake, which builds without /WX); parameter names are
// kept for ABI documentation. Our own sources (dispatcher/tick/injector/
// dailycheckin/hook/debug) still build under /WX — see src/CMakeLists.txt.
#pragma warning(push)
#pragma warning(disable : 4100)
#include "gobj.h"
#include "msghandler.h"
#include "../ztl/ztl.h"


class CStage : public IGObj, public IUIMsgHandler, public INetMsgHandler, public ZRefCounted {
public:
    virtual void Init(void* pParam) {}
    virtual void Close() {}
};

inline ZRef<CStage>& get_stage() {
    return *reinterpret_cast<ZRef<CStage>*>(0x00BEDED0);
}