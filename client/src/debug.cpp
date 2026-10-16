#include "pch.h"
#include "debug.h"
#include <windows.h>
#include <strsafe.h>
#include <cstring>


void DebugMessage(const char* pszFormat, ...) {
    char pszDest[1024];
    size_t cbDest = 1024 * sizeof(char);
    va_list argList;
    va_start(argList, pszFormat);
    StringCbVPrintfA(pszDest, cbDest, pszFormat, argList);
    OutputDebugStringA(pszDest);
    va_end(argList);
}

void ErrorMessage(const char* pszFormat, ...) {
    char pszDest[1024];
    size_t cbDest = 1024 * sizeof(char);
    va_list argList;
    va_start(argList, pszFormat);
    StringCbVPrintfA(pszDest, cbDest, pszFormat, argList);
    MessageBoxA(nullptr, pszDest, "Error", MB_ICONERROR);
    va_end(argList);
}

void LogMessage(const char* format, ...) {
    char message[1024];
    va_list args;
    va_start(args, format);
    StringCbVPrintfA(message, sizeof(message), format, args);
    va_end(args);
    OutputDebugStringA(message);
    static wchar_t logPath[MAX_PATH] = {};
    if (!logPath[0]) {
        GetModuleFileNameW(nullptr, logPath, MAX_PATH);
        wchar_t* slash = wcsrchr(logPath, L'\\');
        if (!slash) return;
        StringCbCopyW(slash + 1, sizeof(logPath) - (slash + 1 - logPath) * sizeof(wchar_t), L"client.log");
    }
    HANDLE file = CreateFileW(logPath, FILE_APPEND_DATA, FILE_SHARE_READ, nullptr,
                              OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    SYSTEMTIME time;
    GetLocalTime(&time);
    char line[1200];
    StringCbPrintfA(line, sizeof(line), "[%02d:%02d:%02d.%03d] %s\r\n",
        time.wHour, time.wMinute, time.wSecond, time.wMilliseconds, message);
    DWORD written;
    WriteFile(file, line, static_cast<DWORD>(strlen(line)), &written, nullptr);
    CloseHandle(file);
}
