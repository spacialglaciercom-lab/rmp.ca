#!/bin/bash
# Simple GUI launcher for RMP.ca system
# Uses basic X11 tools that should be available

echo "Launching RMP.ca GUI..."

# Check for X11 display
if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
    if ! xdpyinfo >/dev/null 2>&1; then
        echo "Error: X11 display not available. Please start X server first."
        exit 1
    fi
fi

# Start the system
./quick-start.sh >/dev/null 2>&1

# Launch main control window
xterm -title "RMP.ca System Control" -geometry 100x35+50+50 -e "bash -c '
    echo "RMP.ca System Control Panel"
    echo "============================"
    echo ""
    echo "Commands:"
    echo "  status   - Check system status"
    echo "  start    - Start all services"
    echo "  stop     - Stop all services"
    echo "  restart  - Restart jails"
    echo "  deploy   - Deploy code to jails"
    echo "  exit     - Close this window"
    echo ""
    while true; do
        read -p "Enter command: " cmd
        case "$cmd" in
            status)
                bash check-system-status.sh
                ;;
            start)
                echo "Starting services..."
                ./start-rmp-system.sh auto
                ;;
            stop)
                echo "Stopping services..."
                for jail in rmpcabackend rmpcaextract; do
                    bastille cmd "$jail" service "$(echo "$jail" | sed s/rmpca//)" stop
                done
                echo "Services stopped"
                ;;
            restart)
                echo "Restarting jails..."
                for jail in rmpcabackend rmpcacelery rmpcadb rmpcaextract rmpcamoonshine rmpcanginxopt rmpcaoptimizer rmpcaredis; do
                    bastille restart "$jail"
                done
                echo "Jails restarted"
                ;;
            deploy)
                echo "Deploying code to jails..."
                cd /root/rmp.ca && sudo ./bastille/deploy.sh
                ;;
            exit)
                exit 0
                ;;
            *)
                echo "Unknown command: $cmd"
                ;;
        esac
    done
'" &

# Launch service monitor
xterm -title "Service Monitor" -geometry 80x25+50+450 -e "watch -n 2 'bash check-system-status.sh'" &

# Launch web browser
if command -v firefox >/dev/null 2>&1; then
    firefox http://localhost:3000 http://localhost:8000 http://localhost:8090 &
elif command -v chromium >/dev/null 2>&1; then
    chromium http://localhost:3000 http://localhost:8000 http://localhost:8090 &
else
    xdg-open http://localhost:3000 &
    xdg-open http://localhost:8000 &
    xdg-open http://localhost:8090 &
fi

# Launch file manager
if command -v pcmanfm >/dev/null 2>&1; then
    pcmanfm /root/rmp.ca &
elif command -v thunar >/dev/null 2>&1; then
    thunar /root/rmp.ca &
elif command -v nautilus >/dev/null 2>&1; then
    nautilus /root/rmp.ca &
fi

echo "GUI Launched!"
echo "- Control Panel: Main management window"
echo "- Service Monitor: System status window"
echo "- Web Browser: Local service interfaces"
echo "- File Manager: Project navigation"

# Keep script running
wait
