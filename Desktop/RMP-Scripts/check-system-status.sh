#!/bin/bash
# System status check script

echo "RMP.ca System Status"
echo "===================="
echo ""

# Check bastille service
echo "Bastille Service:"
if service bastille status >/dev/null 2>&1; then
    echo "  ✓ Running"
else
    echo "  ✗ Not running"
fi

echo ""
echo "Jail Status:"
bastille list | grep -v "^-" | grep -v "JID" | while read line; do
    jail_name=$(echo "$line" | awk '{print $2}')
    jail_state=$(echo "$line" | awk '{print $5}')
    
    if [ "$jail_state" = "Up" ]; then
        echo "  ✓ $jail_name (Up)"
    else
        echo "  ✗ $jail_name ($jail_state)"
    fi
done

echo ""
echo "Service Status:"
for jail in rmpcabackend rmpcaextract; do
    service_name=$(echo "$jail" | sed 's/rmpca//')
    echo -n "  $service_name in $jail: "
    bastille cmd "$jail" service "$service_name" status >/dev/null 2>&1 && echo "✓ Running" || echo "✗ Not running"
done

echo ""
echo "Port Status:"
for port in 3000 4000 8000 8090; do
    echo -n "  Port $port: "
    sockstat -l -p $port >/dev/null 2>&1 && echo "✓ In use" || echo "✗ Available"
done

echo ""
echo "System check complete!"
