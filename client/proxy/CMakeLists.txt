# dinput8 proxy loader for BunsMS.dll (native-runtime-review blocker 1).
#
# Load path (no launcher changes): the stock exe auto-loads dinput8.dll from
# the exe dir. THIS dll (named dinput8.dll in the game dir) forwards all
# DirectInput8 imports to the real system dinput8 and LoadLibrary()s
# BunsMS.dll from the same dir on attach. Kaentake untouched and preserved:
# Kaentake.exe keeps injecting Kaentake.dll via its own path; the proxy only
# adds BunsMS.dll to any process that loads it (stock exe directly, or under
# Kaentake co-load — both get BunsMS hooks; Kaentake-primary rules still hold
# per XREF since our sites don't overlap).
#
# CONFLICT NOTE: the HD-mode Ezorsia dinput8.dll uses the SAME filename. The
# proxy and the HD shim cannot coexist in one dir — manifest/profile ownership
# of dinput8.dll decides (selfhost-assets-spec owns that call; this build
# produces the binary, never ships it silently).

add_library(dinput8_proxy SHARED
    proxy.cpp
)

target_precompile_headers(dinput8_proxy PRIVATE ../src/pch.h)

target_link_libraries(dinput8_proxy PRIVATE
    Detours
)

set_target_properties(dinput8_proxy PROPERTIES
    OUTPUT_NAME dinput8
)

if (MSVC)
    target_compile_options(dinput8_proxy PRIVATE /W4 /WX)
endif()
