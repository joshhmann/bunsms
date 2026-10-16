// Stock screen metrics (no resolution mod in this slice — spec §2.3).
//
// Kaentake's resolution.cpp owns these globals plus a full resolution-switch
// UI; this tree ships no resolution mod, so the stock 800×600 values are
// pinned here. dailycheckin.cpp (ClampToScreen/EnsureWindow) and
// wvs/wndman.h (ResetOrgWindow) link against these. When/if a resolution
// mod lands, it takes over this file (weatherwind's vertical-fall-distance
// dependency is recorded in XREF.md until then).

#pragma once

int get_screen_width();
int get_screen_height();
int get_adjust_cy();
