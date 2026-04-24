#!/usr/bin/env bash
# Build rmp-routing into .so libraries for Android (arm64-v8a, armeabi-v7a, x86_64).
#
# Prerequisites:
#   rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
#   NDK installed; set ANDROID_NDK_HOME
#   cargo install cargo-ndk
#
# Output:
#   ../modules/route-optimizer/android/src/main/jniLibs/<ABI>/librmp_routing.so
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")/.." && pwd)/rmp-routing"
JNI_OUT="$(cd "$(dirname "$0")/../../modules/route-optimizer/android/src/main/jniLibs" && pwd)"

TARGETS=(
    "aarch64-linux-android   arm64-v8a"
    "armv7-linux-androideabi armeabi-v7a"
    "x86_64-linux-android    x86_64"
)

for entry in "${TARGETS[@]}"; do
    TARGET=$(echo "$entry" | awk '{print $1}')
    ABI=$(echo "$entry" | awk '{print $2}')
    echo "▶ Building for $ABI ($TARGET)…"
    cargo ndk \
        --target "$TARGET" \
        --platform 21 \
        -- build --release \
        --manifest-path "$CRATE_DIR/Cargo.toml"

    DEST="$JNI_OUT/$ABI"
    mkdir -p "$DEST"
    cp "$CRATE_DIR/../../target/$TARGET/release/librmp_routing.so" "$DEST/"
    echo "  ✓ $DEST/librmp_routing.so"
done

echo "✓ Android .so libraries ready in $JNI_OUT"
