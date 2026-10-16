cmake_minimum_required(VERSION 3.18)
project(BunsKaentake LANGUAGES C CXX)

if (NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
    message(FATAL_ERROR "The Kaentake runtime requires a Win32 toolchain")
endif()

# Separate build tree: upstream owns its target names and pinned submodules.
# Never substitute the companion tree's WzLib renderer side-output at runtime.
include(FetchContent)
find_package(Git REQUIRED)

FetchContent_Declare(kaentake
    GIT_REPOSITORY https://github.com/iw2d/kaentake.git
    GIT_TAG 2a43a01e7f4cdd75cda08ab533049230760d7cfa
    GIT_CONFIG core.autocrlf=false
    GIT_SUBMODULES external/Detours external/WzLib
    GIT_SUBMODULES_RECURSE TRUE
    PATCH_COMMAND
        "${GIT_EXECUTABLE}" apply --check "${CMAKE_CURRENT_SOURCE_DIR}/patches/0001-load-buns-companion.patch"
        COMMAND "${GIT_EXECUTABLE}" apply "${CMAKE_CURRENT_SOURCE_DIR}/patches/0001-load-buns-companion.patch"
        COMMAND "${GIT_EXECUTABLE}" apply --check "${CMAKE_CURRENT_SOURCE_DIR}/patches/0003-resolve-domain-host.patch"
        COMMAND "${GIT_EXECUTABLE}" apply "${CMAKE_CURRENT_SOURCE_DIR}/patches/0003-resolve-domain-host.patch"
        COMMAND "${GIT_EXECUTABLE}" apply --check "${CMAKE_CURRENT_SOURCE_DIR}/patches/0006-route-winsock-connect.patch"
        COMMAND "${GIT_EXECUTABLE}" apply "${CMAKE_CURRENT_SOURCE_DIR}/patches/0006-route-winsock-connect.patch"
        COMMAND "${GIT_EXECUTABLE}" apply --check "${CMAKE_CURRENT_SOURCE_DIR}/patches/0007-prism-itemeff-bridge.patch"
        COMMAND "${GIT_EXECUTABLE}" apply "${CMAKE_CURRENT_SOURCE_DIR}/patches/0007-prism-itemeff-bridge.patch"
)

file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/patches/0001-load-buns-companion.patch" companion_patch_sha256)
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/patches/0003-resolve-domain-host.patch" resolver_patch_sha256)
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/patches/0006-route-winsock-connect.patch" routing_patch_sha256)
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/patches/0007-prism-itemeff-bridge.patch" prism_patch_sha256)
file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/kaentake-build.json" CONTENT
    "{\n  \"upstreamCommit\": \"2a43a01e7f4cdd75cda08ab533049230760d7cfa\",\n  \"companionPatchSha256\": \"${companion_patch_sha256}\",\n  \"resolverPatchSha256\": \"${resolver_patch_sha256}\",\n  \"routingPatchSha256\": \"${routing_patch_sha256}\",\n  \"prismBridgePatchSha256\": \"${prism_patch_sha256}\",\n  \"diagnosticOnly\": false,\n  \"companionEntry\": \"BunsMS_Initialize\"\n}\n"
)
FetchContent_MakeAvailable(kaentake)
target_include_directories(injector PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../src")
target_link_options(injector PRIVATE "/EXPORT:Kaentake_SetPrismItemEffBridge=_Kaentake_SetPrismItemEffBridge")
