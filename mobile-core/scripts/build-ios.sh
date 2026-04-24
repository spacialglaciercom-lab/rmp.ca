#!/usr/bin/env bash
# Build rmp-routing into a universal XCFramework for iOS + simulator.
#
# Prerequisites:
#   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
#   cargo install uniffi-bindgen
#
# Output:
#   ../modules/route-optimizer/ios/Frameworks/RmpRouting.xcframework
#   ../modules/route-optimizer/ios/RmpRouting.swift   (generated UniFFI bindings)
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")/.." && pwd)/rmp-routing"
OUT_DIR="$(cd "$(dirname "$0")/../../modules/route-optimizer/ios" && pwd)"
FRAMEWORK_NAME="RmpRouting"
SWIFT_OUT="$OUT_DIR/Generated"

mkdir -p "$SWIFT_OUT"
mkdir -p "$OUT_DIR/Frameworks"

echo "▶ Building rmp-routing for iOS device (aarch64-apple-ios)…"
cargo build --release \
    --manifest-path "$CRATE_DIR/Cargo.toml" \
    --target aarch64-apple-ios

echo "▶ Building rmp-routing for iOS Simulator (aarch64-apple-ios-sim)…"
cargo build --release \
    --manifest-path "$CRATE_DIR/Cargo.toml" \
    --target aarch64-apple-ios-sim

echo "▶ Building rmp-routing for iOS Simulator (x86_64, Rosetta)…"
cargo build --release \
    --manifest-path "$CRATE_DIR/Cargo.toml" \
    --target x86_64-apple-ios

DEVICE_LIB="$CRATE_DIR/../../target/aarch64-apple-ios/release/librmp_routing.a"
SIM_ARM_LIB="$CRATE_DIR/../../target/aarch64-apple-ios-sim/release/librmp_routing.a"
SIM_X86_LIB="$CRATE_DIR/../../target/x86_64-apple-ios/release/librmp_routing.a"

echo "▶ Creating fat simulator library (arm64 + x86_64)…"
LIPO_DIR="$(mktemp -d)"
lipo -create "$SIM_ARM_LIB" "$SIM_X86_LIB" -output "$LIPO_DIR/librmp_routing.a"

echo "▶ Generating UniFFI Swift bindings…"
# Uses the device binary to extract metadata.
uniffi-bindgen generate \
    --library "$DEVICE_LIB" \
    --language swift \
    --out-dir "$SWIFT_OUT"

# Rename header for XCFramework modulemap expectations
mv "$SWIFT_OUT/rmp_routingFFI.h"       "$SWIFT_OUT/${FRAMEWORK_NAME}FFI.h"       2>/dev/null || true
mv "$SWIFT_OUT/rmp_routingFFI.modulemap" "$SWIFT_OUT/${FRAMEWORK_NAME}FFI.modulemap" 2>/dev/null || true
mv "$SWIFT_OUT/rmp_routing.swift"      "$SWIFT_OUT/${FRAMEWORK_NAME}.swift"      2>/dev/null || true

echo "▶ Building device XCFramework slice…"
DEVICE_FW_DIR="$(mktemp -d)/device"
mkdir -p "$DEVICE_FW_DIR/Headers"
cp "$SWIFT_OUT/${FRAMEWORK_NAME}FFI.h"         "$DEVICE_FW_DIR/Headers/"
cp "$SWIFT_OUT/${FRAMEWORK_NAME}FFI.modulemap" "$DEVICE_FW_DIR/Headers/module.modulemap"
cp "$DEVICE_LIB" "$DEVICE_FW_DIR/"

echo "▶ Building simulator XCFramework slice…"
SIM_FW_DIR="$(mktemp -d)/sim"
mkdir -p "$SIM_FW_DIR/Headers"
cp "$SWIFT_OUT/${FRAMEWORK_NAME}FFI.h"         "$SIM_FW_DIR/Headers/"
cp "$SWIFT_OUT/${FRAMEWORK_NAME}FFI.modulemap" "$SIM_FW_DIR/Headers/module.modulemap"
cp "$LIPO_DIR/librmp_routing.a"                "$SIM_FW_DIR/"

XCFW="$OUT_DIR/Frameworks/${FRAMEWORK_NAME}.xcframework"
rm -rf "$XCFW"

echo "▶ Assembling $XCFW…"
xcodebuild -create-xcframework \
    -library "$DEVICE_FW_DIR/librmp_routing.a" \
    -headers "$DEVICE_FW_DIR/Headers" \
    -library "$SIM_FW_DIR/librmp_routing.a" \
    -headers "$SIM_FW_DIR/Headers" \
    -output "$XCFW"

echo "✓ XCFramework built at: $XCFW"
echo "✓ Swift bindings at:    $SWIFT_OUT/${FRAMEWORK_NAME}.swift"
