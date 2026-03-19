#!/bin/sh
# Allow Leap SDK Swift macros to run on EAS Build (no interactive trust dialog).
# See: https://developer.apple.com/forums/thread/739347
[ "$EAS_BUILD_PLATFORM" != "ios" ] && exit 0
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES 2>/dev/null || true
