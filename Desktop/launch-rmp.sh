#!/bin/bash
# Desktop launcher for RMP.ca system
# Provides easy access to all scripts

cd ~/Desktop/RMP-Scripts

# Check if X11 is available
if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
fi

# Launch the GUI interface
if [ -f "launch-gui.sh" ]; then
    echo "Launching RMP.ca GUI System..."
    ./launch-gui.sh
else
    echo "GUI script not found. Launching quick start instead..."
    ./quick-start.sh
fi
