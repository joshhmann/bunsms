// Canvas _inlink/_outlink resolution (Kaentake inlink-shaped, minimal).
//
// Sprites referenced through UOL links (e.g. close-button art addressed via
// link nodes) resolve to empty canvases unless something follows the link.
// Kaentake's inlink.cpp does this with two hooks: CWzCanvas::raw_Serialize
// (pattern-found in CANVAS.DLL) and get_unknown/Ztl_variant_t::GetUnknown.
// This slice needs only the get_unknown half: dailycheckin LoadSprite calls
// get_unknown() on GetObjectA results, and the declaration in wvs/util.h
// would otherwise link against nothing (LNK2019).
//
// Minimal by design: hook get_unknown (0x00414ADA, SEH/XREF per Kaentake
// source) + Ztl_variant_t::GetUnknown (0x004032B2) to follow _inlink /
// _outlink / source properties, exactly the link-following half of
// Kaentake's HandleLinkProperty. The raw_Serialize half (pattern scan in
// CANVAS.DLL) is NOT taken: no evidence it is needed for the check-in
// sprites, and pattern-scanned hooks are the least stable kind.
// Revisit with a canvas-dump if a sprite ever renders blank.

#pragma once

// Install the link-following get_unknown hooks. Called from
// AttachSystemHooks(), after the dispatcher (link resolution serves
// sprite loads, which happen on window creation — main thread).
void AttachInlinkMod();
