cmake_minimum_required(VERSION 3.14)
project(BunsMS)

# Product DLL filename (locked decision): BunsMS.dll. Ships via launcher
# manifest profile entries; see README.md shipping section.
set(BUNS_DLL_NAME BunsMS)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/$<CONFIGURATION>")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/$<CONFIGURATION>")

# Client DLL version. The server holds the matching MIN_DLL_VERSION constant;
# the DLL stamps CLIENT_DLL_VERSION into the handshake (see system.cpp).
# Bump both sides in the same paired release (see client/README.md).
set(CLIENT_DLL_VERSION 1)

# Build external dependencies
add_subdirectory(external)

# Build injector DLL
add_subdirectory(src)
