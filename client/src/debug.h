#pragma once

#ifdef _DEBUG
#define DEBUG_MESSAGE(FORMAT, ...) DebugMessage(FORMAT, __VA_ARGS__)
#else
#define DEBUG_MESSAGE(FORMAT, ...)
#endif


void DebugMessage(const char* sFormat, ...);

void ErrorMessage(const char* sFormat, ...);

// Always-on Release diagnostics; bounded hot-path helpers never allocate.
void LogMessage(const char* format, ...);
#define LOG_ONCE(FORMAT, ...) \
    do { \
        static bool bunsLogged__ = false; \
        if (!bunsLogged__) { bunsLogged__ = true; LogMessage(FORMAT, __VA_ARGS__); } \
    } while (0)

inline constexpr int kLogKeyCap = 64;
#define LOG_ONCE_PER_ID(KEY, FORMAT, ...) \
    do { \
        static int bunsKeys__[kLogKeyCap] = {}; \
        static int bunsKeyCount__ = 0; \
        static bool bunsCapped__ = false; \
        const int bunsKey__ = (KEY); \
        bool bunsSeen__ = false; \
        for (int bunsI__ = 0; bunsI__ < bunsKeyCount__; ++bunsI__) { if (bunsKeys__[bunsI__] == bunsKey__) { bunsSeen__ = true; break; } } \
        if (!bunsSeen__) { \
            if (bunsKeyCount__ < kLogKeyCap) { bunsKeys__[bunsKeyCount__++] = bunsKey__; LogMessage(FORMAT, __VA_ARGS__); } \
            else if (!bunsCapped__) { bunsCapped__ = true; LogMessage("(%d distinct ids at this site; further ids suppressed)", kLogKeyCap); } \
        } \
    } while (0)
