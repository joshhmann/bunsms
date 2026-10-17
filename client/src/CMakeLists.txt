# Build injector
add_library(injector SHARED
    injector.cpp
    system.cpp
    dispatcher.cpp
    tick.cpp
    screen.cpp
    caps.cpp
    dailycheckin.cpp
    cashshopwnd.cpp
    coloringprism.cpp
    prismdispatch.cpp
    weapontint.cpp
    damagelong.cpp
    weather.cpp
    weatherfx.cpp
    weathercanvas.cpp
    weatherwind.cpp
    weathersway.cpp
    weatheraccum.cpp
    weatherpuddle.cpp
    weathersplash.cpp
    weathermove.cpp
    weathersound.cpp
    lamps.cpp
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
    target_compile_options(injector PRIVATE /W4 /WX $<$<CONFIG:Release>:/Zi>)
    target_link_options(injector PRIVATE
        $<$<CONFIG:Release>:/DEBUG:FULL>
        $<$<CONFIG:Release>:/INCREMENTAL:NO>
        $<$<CONFIG:Release>:/OPT:REF>
        $<$<CONFIG:Release>:/OPT:ICF>
    )
endif()

set_target_properties(injector PROPERTIES
    OUTPUT_NAME ${BUNS_DLL_NAME}
    PDB_NAME ${BUNS_DLL_NAME}
    PDB_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/$<CONFIGURATION>"
)

# Stash the client version into the binary for the §5 version handshake.
target_compile_definitions(injector PRIVATE CLIENT_DLL_VERSION=${CLIENT_DLL_VERSION})
