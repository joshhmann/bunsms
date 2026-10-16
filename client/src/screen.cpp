#include "pch.h"
#include "screen.h"

namespace {
using Metric = int(__cdecl*)();
Metric widthMetric = nullptr, heightMetric = nullptr, adjustMetric = nullptr;
}

bool BindWeatherViewport(HMODULE upstream) {
    if (!upstream) return false;
    auto width = reinterpret_cast<Metric>(GetProcAddress(upstream, "KaentakeWeatherViewportWidth"));
    auto height = reinterpret_cast<Metric>(GetProcAddress(upstream, "KaentakeWeatherViewportHeight"));
    auto adjust = reinterpret_cast<Metric>(GetProcAddress(upstream, "KaentakeWeatherViewportAdjustY"));
    if (!width || !height || !adjust) {
        ErrorMessage("Kaentake viewport ABI is missing; the paired runtime is required.");
        return false;
    }
    widthMetric = width;
    heightMetric = height;
    adjustMetric = adjust;
    return true;
}

int get_screen_width() { return widthMetric ? widthMetric() : 800; }
int get_screen_height() { return heightMetric ? heightMetric() : 600; }
int get_adjust_cy() { return adjustMetric ? adjustMetric() : 0; }
