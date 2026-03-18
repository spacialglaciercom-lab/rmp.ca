#!/usr/bin/env bash
# Print this machine's LAN IP so you can set EXPO_PUBLIC_API_BASE_URL for iOS device.
# Usage: ./scripts/check-host-ip.sh   or   bash scripts/check-host-ip.sh
# Then in .env: EXPO_PUBLIC_API_BASE_URL=http://<printed-ip>:3000

set -e
if command -v ip &>/dev/null; then
  # Linux: primary default route interface
  ip -4 route get 8.8.8.8 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' || true
elif command -v ipconfig &>/dev/null; then
  # macOS
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
fi
