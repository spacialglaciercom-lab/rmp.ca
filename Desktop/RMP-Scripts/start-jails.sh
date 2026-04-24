#!/bin/bash
# Start all jails and the web UI for rmp.ca - Unix compatible version

# Change to the rmp.ca directory
cd /root/rmp.ca

# Function to kill processes on specific ports
kill_ports() {
    echo "Clearing ports 3000 and 19007..."
    for port in 3000 19007; do
        # Find and kill processes using the port
        PIDS=$(sockstat -l -p $port | awk '{print $3}' | grep -v PID)
        if [ -n "$PIDS" ]; then
            echo "Killing processes on port $port: $PIDS"
            kill -9 $PIDS 2>/dev/null
        fi
    done
    echo "Ports 3000 and 19007 are clear."
}

# Function to start the development server
start_dev_server() {
    echo "Starting Expo + tRPC development server..."
    
    # Check if pnpm is available, otherwise use npm
    if command -v pnpm >/dev/null 2>&1; then
        echo "Using pnpm..."
        pnpm dev &
    else
        echo "Using npm..."
        npm run dev &
    fi
    
    # Give it a moment to start
    sleep 3
}

# Function to start backend services
start_backend() {
    echo "Starting backend services..."
    
    # Try to find trash-route backend
    TRASH_ROUTE=""
    
    # Check TRASH_ROUTE_PATH environment variable
    if [ -n "$TRASH_ROUTE_PATH" ] && [ -f "$TRASH_ROUTE_PATH/src/api_main.py" ]; then
        TRASH_ROUTE="$TRASH_ROUTE_PATH"
    fi
    
    # Check common locations
    if [ -z "$TRASH_ROUTE" ] && [ -f "../trash-route/src/api_main.py" ]; then
        TRASH_ROUTE="../trash-route"
    fi
    
    if [ -z "$TRASH_ROUTE" ] && [ -f "../../trash-route/src/api_main.py" ]; then
        TRASH_ROUTE="../../trash-route"
    fi
    
    if [ -z "$TRASH_ROUTE" ] && [ -f "$HOME/trash-route/src/api_main.py" ]; then
        TRASH_ROUTE="$HOME/trash-route"
    fi
    
    if [ -n "$TRASH_ROUTE" ]; then
        echo "Found trash-route API at: $TRASH_ROUTE"
        cd "$TRASH_ROUTE/src" || return
        echo "Starting trash-route MC-CARP API on http://localhost:8000..."
        python -m uvicorn api_main:app --host 0.0.0.0 --port 8000 --reload &
        cd - >/dev/null
    else
        echo "trash-route API not found. Set TRASH_ROUTE_PATH environment variable."
        echo "Only Expo + tRPC will be started."
    fi
}

# Main execution
kill_ports
start_dev_server
start_backend

# Open the web UI in the default browser
echo "Opening web UI at http://localhost:3000..."
xdg-open http://localhost:3000

echo "Services started!"
echo "- Development server: http://localhost:3000"
echo "- MC-CARP API: http://localhost:8000 (if found)"
echo "Press Ctrl+C to stop all services."

# Keep the script running to maintain background processes
wait
