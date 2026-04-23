#!/bin/sh
# Script to start extract service inside jail

# Check if we're running inside a jail
if ! jexec $$ /bin/true 2>/dev/null; then
    echo "This script must be run from within a jail"
    exit 1
fi

# Try to start the extract service
if [ -f /usr/local/etc/rc.d/extract ]; then
    echo "Starting extract service..."
    service extract start
elif [ -f /root/extract/start.sh ]; then
    echo "Starting extract from root directory..."
    cd /root/extract && ./start.sh
else
    echo "Extract service not found"
    exit 1
fi

echo "Extract service started"
