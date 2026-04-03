# RMP.ca Scripts Summary

## Overview

This document summarizes all the scripts available for managing the RMP.ca system.

## Script Categories

### 1. Core System Scripts

#### `quick-start.sh`
**Purpose**: Quick jail startup without deployment
**Usage**: `./quick-start.sh`
**Features**:
- Starts bastille service if needed
- Starts all 8 jails
- Shows jail status
- Fast startup (no deployment)

#### `start-rmp-system.sh`
**Purpose**: Comprehensive system management
**Usage**: 
- Interactive: `./start-rmp-system.sh`
- Automatic: `./start-rmp-system.sh auto`
**Features**:
- Interactive menu system
- Jail management
- Code deployment
- Service startup
- Development environment

#### `start-jails.sh`
**Purpose**: Unix-compatible development startup
**Usage**: `./start-jails.sh`
**Features**:
- Replaces Windows .bat files
- Port management
- Development server startup
- Backend service startup
- Web UI launch

### 2. GUI Scripts

#### `launch-gui.sh`
**Purpose**: Simple GUI management interface
**Usage**: `./launch-gui.sh`
**Features**:
- Control Panel window
- Service Monitor window
- Web Browser launch
- File Manager launch
- Basic X11 requirements

#### `start-gui.sh`
**Purpose**: Advanced GUI with multiple windows
**Usage**: `./start-gui.sh`
**Features**:
- Multiple terminal windows
- Graphical control panel (zenity)
- Comprehensive monitoring
- Web interfaces
- File management

### 3. Utility Scripts

#### `check-system-status.sh`
**Purpose**: System status monitoring
**Usage**: `./check-system-status.sh`
**Features**:
- Bastille service status
- Jail status overview
- Service status check
- Port usage monitoring

#### `start-jails-simple.sh`
**Purpose**: Simple jail startup
**Usage**: `./start-jails-simple.sh`
**Features**:
- Starts all jails
- Attempts service startup
- Basic status display

### 4. Documentation

#### `JAIL_STARTUP_GUIDE.md`
**Purpose**: Complete user guide
**Content**:
- Quick start instructions
- Script documentation
- Manual commands
- Troubleshooting
- System architecture
- Development workflow

#### `SCRIPTS_SUMMARY.md`
**Purpose**: This file - script overview

## Script Comparison Table

| Script | Purpose | GUI | Auto | Complexity |
|--------|---------|-----|------|------------|
| `quick-start.sh` | Quick jail start | ❌ | ✅ | Low |
| `start-rmp-system.sh` | Full system management | ❌ | ✅ | High |
| `start-jails.sh` | Development startup | ❌ | ✅ | Medium |
| `launch-gui.sh` | Simple GUI interface | ✅ | ✅ | Medium |
| `start-gui.sh` | Advanced GUI interface | ✅ | ✅ | High |
| `check-system-status.sh` | Status monitoring | ❌ | ✅ | Low |

## Usage Scenarios

### Scenario 1: Quick Testing
```bash
./quick-start.sh
./check-system-status.sh
```

### Scenario 2: Development Work
```bash
./start-rmp-system.sh
# Use interactive menu
```

### Scenario 3: GUI Management
```bash
./launch-gui.sh
# Use GUI windows for control
```

### Scenario 4: Production Deployment
```bash
./quick-start.sh
cd /root/rmp.ca
sudo ./bastille/deploy.sh --all
./start-rmp-system.sh auto
```

## Dependencies

### Core Dependencies
- `bastille` - Jail management
- `bash` - Script execution
- `sudo` - Root privileges

### GUI Dependencies
- `xterm` - Terminal windows
- `xdg-open` - Web browser launch
- `pcmanfm`/`thunar`/`nautilus` - File manager
- `firefox`/`chromium` - Web browser
- `zenity` - GUI dialogs (optional)

### Development Dependencies
- `pnpm`/`npm` - Package management
- `node` - JavaScript runtime
- `python` - Backend services

## Installation

### Install Core Dependencies
```bash
pkg install bastille bash sudo
```

### Install GUI Dependencies
```bash
pkg install xterm pcmanfm firefox zenity
```

### Install Development Dependencies
```bash
npm install -g pnpm
```

## File Locations

All scripts are located in `/root/`:
```
/root/
├── quick-start.sh
├── start-rmp-system.sh
├── start-jails.sh
├── launch-gui.sh
├── start-gui.sh
├── check-system-status.sh
├── start-jails-simple.sh
├── JAIL_STARTUP_GUIDE.md
└── SCRIPTS_SUMMARY.md
```

## Permissions

All scripts need execute permissions:
```bash
chmod +x *.sh
```

## Best Practices

1. **Start with quick-start.sh** for basic testing
2. **Use launch-gui.sh** for graphical management
3. **Use start-rmp-system.sh** for comprehensive control
4. **Check status regularly** with check-system-status.sh
5. **Run as root** for full functionality

## Troubleshooting

### Script not found
```bash
chmod +x scriptname.sh
./scriptname.sh
```

### Permission denied
```bash
sudo ./scriptname.sh
```

### X11 not available
```bash
startx
export DISPLAY=:0
```

### Missing dependencies
```bash
pkg install missing-package
```

## Support

For issues with specific scripts, refer to the detailed documentation in `JAIL_STARTUP_GUIDE.md`.
