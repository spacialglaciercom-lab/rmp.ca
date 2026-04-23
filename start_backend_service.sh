#!/bin/sh
# Script to start backend service inside jail

# Check if we're running inside a jail
if ! jexec $$ /bin/true 2>/dev/null; then
    echo "This script must be run from within a jail"
    exit 1
fi

# Try to start the backend service
if [ -f /usr/local/etc/rc.d/backend ]; then
    echo "Starting backend service..."
    service backend start
elif [ -f /root/backend/start.sh ]; then
    echo "Starting backend from root directory..."
    cd /root/backend && ./start.sh
else
    echo "Backend service not found"
    exit 1
fi

echo "Backend service started"
