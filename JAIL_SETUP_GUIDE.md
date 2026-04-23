# FreeBSD Jail Setup Guide for rmp.ca

## Current Status

The system has CBSD-managed jails running with the following configuration:
- **rmpca-extract**: 10.0.0.2 (should run extract service on port 9000)
- **rmpca-backend**: 10.0.0.3 (should run backend service on port 3000)
- **Other jails**: redis, optimizer, celery, nginx-opt, moonshine, etc.

## Issues Identified

1. **WebSocket Connection Failures**: The frontend cannot connect to `ws://localhost:3000/ws/extract`
2. **CORS Errors**: API requests to `http://localhost:3000/api/config` are failing
3. **Services Not Running**: No processes are listening on ports 3000 or 9000

## Root Cause

The jails exist but the application services haven't been deployed or started within them.

## Solution

### Option 1: Use CBSD Commands (Recommended)

```bash
# Become the cbsd user or use sudo with cbsd privileges
sudo su - cbsd

# Deploy extract service
cbsd jexec jname=rmpca-extract mkdir -p /app/extract
cbsd jpush jname=rmpca-extract src=/path/to/extract dest=/app/extract
cbsd jexec jname=rmpca-extract sh -c "cd /app/extract && npm install --production"

# Deploy backend service  
cbsd jexec jname=rmpca-backend mkdir -p /app
cbsd jpush jname=rmpca-backend src=/path/to/repo dest=/app
cbsd jexec jname=rmpca-backend sh -c "cd /app && pnpm install && pnpm run build:server"

# Create environment files
cbsd jexec jname=rmpca-backend sh -c "cat > /usr/local/etc/rmpca/backend.env << 'ENV'
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://10.0.0.2:9000
ENV"

cbsd jexec jname=rmpca-extract sh -c "cat > /usr/local/etc/rmpca/extract.env << 'ENV'
PORT=9000
NODE_ENV=production
ENV"

# Start services
cbsd jexec jname=rmpca-extract sh -c "cd /app/extract && node server.js &"
cbsd jexec jname=rmpca-backend sh -c "cd /app && pnpm start:server &"
```

### Option 2: Use Standard Jail Commands

```bash
# You may need root privileges for these commands

# Deploy extract service
jexec rmpca-extract mkdir -p /app/extract
# Copy files using tar or other methods
jexec rmpca-extract sh -c "cd /app/extract && npm install --production"

# Deploy backend service
jexec rmpca-backend mkdir -p /app
# Copy files
jexec rmpca-backend sh -c "cd /app && pnpm install && pnpm run build:server"

# Start services
jexec rmpca-extract sh -c "cd /app/extract && node server.js &"
jexec rmpca-backend sh -c "cd /app && pnpm start:server &"
```

### Option 3: Use the Provided Deployment Scripts

Two deployment scripts are available:

1. **deploy_cbsd.sh** - For CBSD-managed jails (current setup)
2. **deploy_simple.sh** - For standard jails

Run with appropriate permissions:
```bash
sudo ./deploy_cbsd.sh
# or
sudo ./deploy_simple.sh
```

## Service Management

### Starting Services Manually

**Extract Service (port 9000)**:
```bash
jexec rmpca-extract sh -c "cd /app/extract && node server.js &"
```

**Backend Service (port 3000)**:
```bash
jexec rmpca-backend sh -c "cd /app && pnpm start:server &"
```

### Creating RC Scripts

For persistent services, create RC scripts in each jail:

**/usr/jails/jails-data/rmpca-extract-data/usr/local/etc/rc.d/extract**:
```bash
#!/bin/sh
# PROVIDE: extract
# REQUIRE: NETWORKING
# KEYWORD: shutdown

. /etc/rc.subr

name="extract"
rcvar="extract_enable"

start_cmd="extract_start"
stop_cmd=":"

extract_start() {
    cd /app/extract && node server.js &
}

load_rc_config $name
run_rc_command "$1"
```

**/usr/jails/jails-data/rmpca-backend-data/usr/local/etc/rc.d/backend**:
```bash
#!/bin/sh
# PROVIDE: backend
# REQUIRE: NETWORKING
# KEYWORD: shutdown

. /etc/rc.subr

name="backend"
rcvar="backend_enable"

start_cmd="backend_start"
stop_cmd=":"

backend_start() {
    cd /app && pnpm start:server &
}

load_rc_config $name
run_rc_command "$1"
```

## Environment Configuration

### Backend Environment (/usr/local/etc/rmpca/backend.env)
```
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://10.0.0.2:9000
# Add other environment variables as needed
```

### Extract Environment (/usr/local/etc/rmpca/extract.env)
```
PORT=9000
NODE_ENV=production
```

## Network Configuration

The jails use the following network setup:
- **Host IP**: 10.0.0.1
- **Extract Jail**: 10.0.0.2
- **Backend Jail**: 10.0.0.3
- **Other jails**: Various 10.0.0.x addresses

## Verification

After starting services, verify they're running:
```bash
# Check if ports are listening
sockstat -l | grep -E "(3000|9000)"

# Check jail processes
jexec rmpca-backend ps aux | grep node
jexec rmpca-extract ps aux | grep node

# Test WebSocket connection
curl -v http://localhost:3000/health
```

## Troubleshooting

### Permission Issues
If you get permission errors:
- Use `sudo` or become root
- Ensure you're in the `cbsd` group for CBSD commands
- Check file permissions in the jail data directories

### Port Conflicts
If ports are already in use:
- Check with `sockstat -l | grep <port>`
- Modify the port numbers in environment files
- Restart services

### Dependency Issues
If services fail to start:
- Check Node.js/Python versions in jails
- Run `npm install` or `pnpm install` inside jails
- Check logs in `/var/log/` within each jail

## Migration to Bastille (Optional)

If you want to switch to Bastille jails (recommended for easier management):

1. Install Bastille: `pkg install bastille`
2. Run the bootstrap script: `sudo ./bastille/bootstrap.sh`
3. Deploy applications: `sudo ./bastille/deploy.sh`

Bastille provides better tooling for application deployment and management.
