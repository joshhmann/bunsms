#pragma once
// NOTE: C4100 (unreferenced parameter) is disabled in this vendored
// engine-interface header. The virtual-stub signatures mirror the stock v83
// engine ABI (cf. Kaentake, which builds without /WX); parameter names are
// kept for ABI documentation. Our own sources (dispatcher/tick/injector/
// dailycheckin/hook/debug) still build under /WX — see src/CMakeLists.txt.
#pragma warning(push)
#pragma warning(disable : 4100)
#include "../hook.h"
#include "wnd.h"
#include "../ztl/ztl.h"


class CUIStatusBar : public CWnd, public TSingleton<CUIStatusBar, 0x00BEC208> {
public:
    MEMBER_AT(int, 0xD10, m_bQuickSlotUp)
    MEMBER_ARRAY_AT(IWzCanvasPtr, 0xD84, m_aCanvasSkillCooltime, 16)

    // resolution.cpp
    MEMBER_HOOK(int, 0x008DE8D5, GetShortCutIndexByPos, int x, int y)
};