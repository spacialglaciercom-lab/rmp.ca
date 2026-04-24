# RMP.ca Jail Startup Guide

This guide explains how to start and manage the RMP.ca system using the provided scripts.

## Quick Start

### 1. Start Jails Quickly
```bash
./quick-start.sh
```
This script:
- Starts the bastille service if not running
- Starts all 8 jails
- Shows jail status

### 2. Launch GUI System
```bash
./launch-gui.sh
```
This launches a graphical interface with:
- Control Panel window for management
- Service Monitor window for status
- Web Browser with local service interfaces
- File Manager for project navigation

### 3. Full System Startup (Interactive Menu)
```bash
./start-rmp-system.sh
```
This provides an interactive menu with options:
- Start all jails
- Check jail status
- Deploy code to jails
- Start services in jails
- Start development environment
- Full system startup

### 4. Automatic Full Startup
```bash
./start-rmp-system.sh auto
```
This performs a complete system startup without prompts.

## Scripts Overview

### `quick-start.sh`
- **Purpose**: Quick jail startup without deployment
- **Best for**: Testing jail connectivity, basic setup
- **Does not**: Deploy code or start services

### `start-rmp-system.sh`
- **Purpose**: Comprehensive system management
- **Features**:
  - Interactive menu or automatic mode
  - Jail management
  - Code deployment to jails
  - Service startup
  - Development environment

### `start-jails.sh`
- **Purpose**: Start development environment (Unix version)
- **Replaces**: Original Windows .bat files
- **Features**:
  - Port clearing
  - Development server startup
  - Backend service startup
  - Web UI launch

## Manual Commands

### Jail Management
```bash
# Start all jails
for jail in rmpcabackend rmpcacelery rmpcadb rmpcaextract rmpcamoonshine rmpcanginxopt rmpcaoptimizer rmpcaredis; do
    bastille start "$jail"
done

# Check jail status
bastille list

# Stop a jail
bastille stop jailname

# Restart a jail
bastille restart jailname
```

### Service Management
```bash
# Start backend service
bastille cmd rmpcabackend service backend start

# Start extract service
bastille cmd rmpcaextract service extract start

# Check service status
bastille cmd rmpcabackend service backend status
```

### Deployment
```bash
# Full deployment (as root)
cd /root/rmp.ca
sudo ./bastille/deploy.sh

# Deploy with optimizer
sudo ./bastille/deploy.sh --optimizer

# Deploy everything
sudo ./bastille/deploy.sh --all
```

## Troubleshooting

### Jails not starting
- Check bastille service: `service bastille status`
- Enable auto-start: `sysrc bastille_enable=YES`
- Start service: `service bastille start`

### Services not starting
- Check if code is deployed: `bastille cmd rmpcabackend ls /app/`
- Check service logs: `bastille cmd rmpcabackend service backend status`
- Try manual start: `bastille cmd rmpcabackend sh -c "cd /app && node dist/index.js &"`

### Port conflicts
- Check used ports: `sockstat -l`
- Kill processes: `kill -9 PID`

## System Architecture

### Jails and Services
- **rmpcabackend** (10.10.0.3:3000): Node.js API server
- **rmpcaextract** (10.10.0.2:4000): Extract service
- **rmpcaredis** (10.10.0.4): Redis database
- **rmpcaoptimizer** (10.10.0.5): Optimizer service
- **rmpcacelery** (10.10.0.6): Celery worker
- **rmpcanginxopt** (10.10.0.7:80): Nginx proxy
- **rmpcamoonshine** (10.10.0.8:8090): ASR sidecar
- **rmpcadb** (10.17.89.2): Database

### Port Forwarding
- Host:3000 → rmpcabackend:3000 (API)
- Host:4000 → rmpcaextract:4000 (Extract)
- Host:8000 → rmpcanginxopt:80 (Optimizer via Nginx)
- Host:8090 → rmpcamoonshine:8090 (ASR)

## Development Workflow

### 1. Start system
```bash
./quick-start.sh
```

### 2. Deploy code
```bash
cd /root/rmp.ca
sudo ./bastille/deploy.sh
```

### 3. Start services
```bash
./start-rmp-system.sh
# Choose option 4 to start services
```

### 4. Start development server
```bash
cd /root/rmp.ca
pnpm dev
```

## Auto-start Configuration

To ensure the system starts automatically on reboot:

```bash
# Enable bastille service
sysrc bastille_enable=YES

# Add startup scripts to rc.local
cat >> /etc/rc.local <<'EOF'
# Start RMP.ca jails
/root/quick-start.sh
EOF
```

## GUI Access

The system provides X11 GUI access through several scripts:

### `launch-gui.sh`
- **Purpose**: Launch a complete GUI management interface
- **Features**:
  - Control Panel window with command interface
  - Service Monitor window with real-time status
  - Web Browser windows for local services
  - File Manager for project navigation
- **Requirements**: X11 server, xterm, web browser, file manager

### `start-gui.sh`
- **Purpose**: Advanced GUI with multiple windows and control panel
- **Features**:
  - Multiple terminal windows for different functions
  - Graphical control panel (if zenity available)
  - Comprehensive system monitoring
  - Web interface access

### GUI Commands
```bash
# Launch simple GUI
./launch-gui.sh

# Launch advanced GUI
./start-gui.sh

# Check if X11 is available
 echo $DISPLAY
 xdpyinfo
```

## GUI Troubleshooting

### X11 not available
- Start X server: `startx` or `Xorg :0`
- Set display: `export DISPLAY=:0`
- Check connection: `xdpyinfo`

### Missing GUI tools
- Install xterm: `pkg install xterm`
- Install file manager: `pkg install pcmanfm`
- Install browser: `pkg install firefox` or `pkg install chromium`

## Notes

- Scripts must be run as root
- First-time deployment may take several minutes
- Jails persist across reboots once created
- Services need to be restarted after code changes
- GUI scripts require X11 environment
