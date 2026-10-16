# Build injector
add_library(injector SHARED
    injector.cpp
    system.cpp
    dispatcher.cpp
    tick.cpp
    dailycheckin.cpp
    debug.cpp
    hook.cpp
)

target_precompile_headers(injector PRIVATE pch.h)

target_link_libraries(injector PRIVATE
    Detours
    WzLib
)

# Warnings-as-errors for our own sources only (external/ exempt).
if (MSVC)
    target_compile_options(injector PRIVATE /W4 /WX)
endif()

set_target_properties(injector PROPERTIES
    OUTPUT_NAME ${BUNS_DLL_NAME}
)

# Stash the client version into the binary for the §5 version handshake.
target_compile_definitions(injector PRIVATE CLIENT_DLL_VERSION=${CLIENT_DLL_VERSION})
