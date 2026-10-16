// Native metrics are read through the retained Kaentake runtime's viewport ABI.
// No duplicate resolution hooks or hard-coded offsets into Kaentake.dll.

#pragma once
#include <windows.h>

int get_screen_width();
int get_screen_height();
int get_adjust_cy();
bool BindWeatherViewport(HMODULE upstream);
