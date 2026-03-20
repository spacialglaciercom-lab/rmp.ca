#!/usr/bin/env bash
# Run this on macOS only. iOS native project generation and CocoaPods require macOS/Xcode.
set -e
cd "$(dirname "$0")/.."
echo "Running Expo prebuild for iOS..."
npx expo prebuild --platform ios --clean
echo "Installing iOS pods..."
cd ios
pod install
echo "Done. Open ios/*.xcworkspace in Xcode to build and run."
