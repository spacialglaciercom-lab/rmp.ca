# RMP.ca System Scripts

Welcome to the RMP.ca system management scripts!

## Quick Start

### 1. Start the system quickly:
```bash
./quick-start.sh
```

### 2. Launch the GUI interface:
```bash
./launch-gui.sh
```

### 3. Full system management:
```bash
./start-rmp-system.sh
```

## Available Scripts

### Core Scripts
- **quick-start.sh** - Quick jail startup
- **start-rmp-system.sh** - Comprehensive system management
- **start-jails.sh** - Development environment startup
- **check-system-status.sh** - System status monitoring

### GUI Scripts
- **launch-gui.sh** - Simple GUI management interface
- **start-gui.sh** - Advanced GUI with multiple windows

### Documentation
- **JAIL_STARTUP_GUIDE.md** - Complete user guide
- **SCRIPTS_SUMMARY.md** - Script overview and comparison

## System Status

Run this to check the current system status:
```bash
./check-system-status.sh
```

## Requirements

- **Root access** (most scripts need sudo)
- **X11 environment** (for GUI scripts)
- **Bastille** (jail management)
- **Basic Unix tools** (bash, grep, awk, etc.)

## Installation

If you need to install dependencies:
```bash
# Core dependencies
pkg install bastille bash sudo

# GUI dependencies  
pkg install xterm pcmanfm firefox

# Development dependencies
npm install -g pnpm
```

## Support

For detailed documentation, see:
- **JAIL_STARTUP_GUIDE.md** - Complete guide
- **SCRIPTS_SUMMARY.md** - Script comparison

## Quick Reference

| Task | Command |
|------|---------|
| Start jails | `./quick-start.sh` |
| Launch GUI | `./launch-gui.sh` |
| Full system | `./start-rmp-system.sh` |
| Check status | `./check-system-status.sh` |
| Deploy code | `cd /root/rmp.ca && sudo ./bastille/deploy.sh` |

Enjoy managing your RMP.ca system! 🚀
