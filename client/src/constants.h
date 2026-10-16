// BunsMS client build constants (NOT Kaentake's constants.h).
//
// Kaentake's wndman.h::ResetOrgWindow branches on CONSTANTS_CENTER_STATUSBAR
// (FALSE upstream). This tree pins the stock-centered status-bar layout:
// no resolution mod exists in this slice (spec §2.3), so the else-branch
// layout is the only one we ship. The macro resolves here, in our own
// header, instead of importing Kaentake's launcher-oriented constants
// (window name, DLL name, host/port globals) which do not belong to BunsMS.dll.

#pragma once

// Stock layout: status bar / quickslot anchored to the stock origins,
// not the centered-statusbar variant.
#define CONSTANTS_CENTER_STATUSBAR FALSE
