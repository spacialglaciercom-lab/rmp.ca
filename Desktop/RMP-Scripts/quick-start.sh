#!/bin/bash
# Quick start script for RMP.ca system
# Starts jails and basic services without full deployment

echo "RMP.ca Quick Start"
echo "=================="

# Start bastille service if not running
if ! service bastille status >/dev/null 2>&1; then
    echo "Starting bastille service..."
    service bastille onestart >/dev/null 2>&1 || true
fi

# Start all jails
echo "Starting jails..."
for jail in rmpcabackend rmpcacelery rmpcadb rmpcaextract rmpcamoonshine rmpcanginxopt rmpcaoptimizer rmpcaredis; do
    bastille start "$jail" >/dev/null 2>&1
    echo "  ✓ $jail"
done

# Show status
echo ""
echo "Jail status:"
bastille list | grep -v "^-" | grep -v "JID"

echo ""
echo "System started!"
echo "- Jails are running"
echo "- Use './start-rmp-system.sh' for full deployment"
echo "- Use 'bastille cmd <jail> service <service> start' to start individual services"
