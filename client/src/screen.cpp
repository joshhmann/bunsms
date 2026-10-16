#include "pch.h"
#include "screen.h"

// Stock v83 metrics. No hooks, no globals beyond these constants —
// the engine's own values; a resolution mod would replace this file.
int get_screen_width() { return 800; }
int get_screen_height() { return 600; }
int get_adjust_cy() { return 0; }
