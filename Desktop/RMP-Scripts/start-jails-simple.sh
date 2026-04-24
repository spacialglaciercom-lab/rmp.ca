#!/bin/bash
# Simple script to start jails and basic services

# Start all jails
echo "Starting all jails..."
for jail in rmpcabackend rmpcacelery rmpcadb rmpcaextract rmpcamoonshine rmpcanginxopt rmpcaoptimizer rmpcaredis; do
    echo "Starting jail: $jail"
    bastille start "$jail"
done

# Check jail status
echo "Jail status:"
bastille list

echo "Jails started! Use bastille cmd <jail> service <service> start to start individual services."

# Optionally try to start services
echo "Attempting to start services in jails..."
for jail in rmpcabackend rmpcaextract; do
    service_name=$(echo "$jail" | sed 's/rmpca//')
    echo "Starting $service_name service in $jail..."
    bastille cmd "$jail" service "$service_name" start 2>/dev/null || echo "Failed to start $service_name in $jail"
done

echo "Setup complete!"
