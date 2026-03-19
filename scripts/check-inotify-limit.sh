#!/usr/bin/env bash
# Check inotify max_user_watches and print fix for ENOSPC "file watchers reached" on Linux.
# Run the printed commands with sudo if the limit is too low (e.g. < 524288).

set -e
LIMIT=$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo "0")
RECOMMENDED=524288

echo "Current fs.inotify.max_user_watches: $LIMIT"
echo "Recommended for this project (pnpm + Metro): $RECOMMENDED"
echo ""

if [ "$LIMIT" -lt "$RECOMMENDED" ] 2>/dev/null; then
  echo "Limit is too low. Run ONE of the following (requires sudo):"
  echo ""
  echo "  # Temporary (until reboot):"
  echo "  sudo sysctl -w fs.inotify.max_user_watches=$RECOMMENDED"
  echo ""
  echo "  # Persistent (add to /etc/sysctl.conf or a drop-in):"
  echo "  echo fs.inotify.max_user_watches=$RECOMMENDED | sudo tee -a /etc/sysctl.d/90-inotify-watches.conf"
  echo "  sudo sysctl -p /etc/sysctl.d/90-inotify-watches.conf"
  echo ""
  exit 1
else
  echo "Limit is sufficient."
  exit 0
fi
