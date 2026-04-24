#!/bin/bash
# X11 GUI Startup Script for RMP.ca System
# Launches GUI applications and manages windows properly

echo "Starting RMP.ca GUI System..."

# Ensure we have a display
if [ -z "$DISPLAY" ]; then
    echo "No X11 display found. Trying to detect..."
    export DISPLAY=:0
    if [ -z "$DISPLAY" ] || ! xdpyinfo >/dev/null 2>&1; then
        echo "Error: X11 display not available. Please start X server first."
        exit 1
    fi
fi

# Start bastille service
if ! service bastille status >/dev/null 2>&1; then
    echo "Starting bastille service..."
    service bastille onestart >/dev/null 2>&1 || true
fi

# Start all jails
echo "Starting jails..."
for jail in rmpcabackend rmpcacelery rmpcadb rmpcaextract rmpcamoonshine rmpcanginxopt rmpcaoptimizer rmpcaredis; do
    bastille start "$jail" >/dev/null 2>&1
done

# Launch terminal windows for key services
echo "Launching GUI applications..."

# Main control terminal
xterm -title "RMP.ca Control Center" -geometry 120x40+10+10 -e "bash -c 'echo \"RMP.ca Control Center\" && echo \"====================\" && echo \"\" && bash check-system-status.sh && echo \"\" && echo \"Type exit to close\" && bash'" &

# Jail management terminal
xterm -title "Jail Management" -geometry 80x30+10+520 -e "bash -c 'echo \"Jail Management Console\" && echo \"========================\" && echo \"\" && bastille list && echo \"\" && echo \"Commands: bastille start/stop/restart <jail>\" && bash'" &

# Service monitoring terminal
xterm -title "Service Monitor" -geometry 80x30+910+10 -e "bash -c 'echo \"Service Monitor\" && echo \"==============\" && echo \"\" && watch -n 2 \"bash check-system-status.sh\"'" &

# Log viewer terminal
xterm -title "System Logs" -geometry 100x25+910+520 -e "bash -c 'echo \"System Logs\" && echo \"==========\" && echo \"\" && tail -f /var/log/messages'" &

# Launch file manager for easy navigation
pcmanfm /root/rmp.ca &

# Launch web browser pointing to local services
echo "Launching web interfaces..."

# Try different browsers
if command -v firefox >/dev/null 2>&1; then
    firefox http://localhost:3000 http://localhost:8000 http://localhost:8090 &
elif command -v chromium >/dev/null 2>&1; then
    chromium http://localhost:3000 http://localhost:8000 http://localhost:8090 &
else
    xdg-open http://localhost:3000
    xdg-open http://localhost:8000
    xdg-open http://localhost:8090
fi

# Create a control panel with buttons (using zenity if available)
if command -v zenity >/dev/null 2>&1; then
    (
        while true; do
            choice=$(zenity --list --title="RMP.ca Control Panel" --text="Select an action:" --column="Action" \
                "Check System Status" \
                "Start All Services" \
                "Stop All Services" \
                "Restart Jails" \
                "Open Documentation" \
                "Exit")
            
            case "$choice" in
                "Check System Status")
                    xterm -title "System Status" -e "bash check-system-status.sh; read -p 'Press Enter to close...'" &
                    ;;
                "Start All Services")
                    xterm -title "Starting Services" -e "bash -c 'echo Starting services... && ./start-rmp-system.sh auto; read -p Press Enter to close...'" &
                    ;;
                "Stop All Services")
                    xterm -title "Stopping Services" -e "bash -c 'echo Stopping services... && for jail in rmpcabackend rmpcaextract; do bastille cmd \$jail service \$(echo \$jail | sed s/rmpca//) stop; done && echo Services stopped; read -p Press Enter to close...'" &
                    ;;
                "Restart Jails")
                    xterm -title "Restarting Jails" -e "bash -c 'echo Restarting jails... && for jail in rmpcabackend rmpcacelery rmpcadb rmpcaextract rmpcamoonshine rmpcanginxopt rmpcaoptimizer rmpcaredis; do bastille restart \$jail; done && echo Jails restarted; read -p Press Enter to close...'" &
                    ;;
                "Open Documentation")
                    xdg-open JAIL_STARTUP_GUIDE.md &
                    ;;
                "Exit"|*)
                    exit 0
                    ;;
            esac
        done
    ) &
fi

echo "GUI System Started!"
echo "- Control Center: Main management terminal"
echo "- Jail Management: Jail control terminal"
echo "- Service Monitor: System status monitor"
echo "- System Logs: Log viewer"
echo "- Web Browser: Local service interfaces"
echo "- File Manager: Project navigation"
echo "- Control Panel: Graphical control center (if zenity available)"

# Keep the script running to maintain all processes
wait
