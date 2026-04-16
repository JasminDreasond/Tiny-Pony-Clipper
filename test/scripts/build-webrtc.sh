#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Project paths
ROOT_DIR=$(pwd)
WORK_DIR="$ROOT_DIR/webrtc_build"
VENDOR_DIR="$ROOT_DIR/vendor"
DEPOT_TOOLS_DIR="$WORK_DIR/depot_tools"

echo "Starting WebRTC secure build process..."

# 1. Prepare isolated workspace
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

if [ ! -d "$DEPOT_TOOLS_DIR" ]; then
    echo "Cloning Google depot_tools..."
    git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
fi

export PATH="$DEPOT_TOOLS_DIR:$PATH"

# 2. Fetch the official WebRTC source code
if [ ! -d "src" ]; then
    echo "Fetching WebRTC source (this will download several gigabytes)..."
    fetch --nohooks webrtc
    cd src
    gclient sync
else
    echo "WebRTC source found. Syncing latest changes..."
    cd src
    gclient sync
fi

# 3. Configure the build specifically for Node.js C++ Addon compatibility
echo "Configuring GN build parameters..."
gn gen out/Release --args='is_debug=false'

# 4. Compile the library
echo "Compiling libwebrtc. This will take a while depending on your CPU..."
ninja -C out/Release

# 5. Prepare the vendor structure
echo "Structuring the vendor directory..."
cd "$ROOT_DIR"
rm -rf "$VENDOR_DIR"
mkdir -p "$VENDOR_DIR/lib"
mkdir -p "$VENDOR_DIR/include"

# 6. Extract only what is necessary
echo "Copying static library..."
cp "$WORK_DIR/src/out/Release/obj/libwebrtc.a" "$VENDOR_DIR/lib/"

echo "Extracting header files and preserving directory tree..."
cd "$WORK_DIR/src"
# Using --parents natively to keep the original header structure intact
find . -name "*.h" -exec cp --parents \{\} "$VENDOR_DIR/include/" \;

# 7. Clean up the massive source tree to save disk space
echo "Cleaning up temporary build files..."
cd "$ROOT_DIR"
rm -rf "$WORK_DIR"

echo "Build complete! Your secure WebRTC files are ready inside the 'vendor' folder."