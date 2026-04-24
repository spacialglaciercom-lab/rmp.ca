# Setup for Existing CBSD Jails

This guide explains how to use the modified setup scripts to work with your existing CBSD jails.

## What's Different

The original `setup.sh` creates new jails on the `10.10.0.0/24` network. Since you already have jails on `10.0.0.0/24`, we've created modified scripts that:

1. **Work with existing jails** - No jail creation/destruction
2. **Respect your current IPs** - Dynamically detect jail IPs and configure services accordingly
3. **Provision and deploy** - Install packages, copy code, and restart services

## New Scripts Created

### `cbsd/setup-existing.sh`
- Main driver script that provisions existing jails and deploys code
- Usage: `sudo sh cbsd/setup-existing.sh [--optimizer] [--moonshine] [--all]`

### `cbsd/deploy-existing.sh`
- Modified deployment script that works with your existing jail IPs
- Automatically detects jail IPs and configures inter-service communication
- Safe to re-run (idempotent)

## How to Use

### 1. Prepare environment file
```bash
cd /home/drone/Documents/rmp.ca
cp cbsd/env.sample cbsd/env
# Edit cbsd/env and set EXT_IF to your public network interface
```

### 2. Run the setup for existing jails
```bash
sudo sh cbsd/setup-existing.sh --all
```

This will:
- Check which of the 7 main jails exist
- Run provisioning scripts on existing jails
- Deploy application code with correct IP configurations
- Restart all services

### 3. Verify
```bash
cbsd jls  # Check jail status
sh cbsd/cli/rmpca status --health  # Check service health
```

## What Gets Deployed

**Core services (always deployed):**
- `rmpca-extract` - Overture Maps extractor
- `rmpca-backend` - tRPC/Express API
- `rmpca-redis` - Celery broker

**Optional services (with flags):**
- `--optimizer`: optimizer + celery + nginx-opt
- `--moonshine`: moonshine ASR sidecar
- `--all`: everything above

## Key Features

### Automatic IP Detection
The scripts automatically detect your existing jail IPs using `cbsd jls` and configure services to communicate correctly.

### Safe for Existing Jails
- Only touches jails that exist
- Skips missing jails with warnings
- Preserves your existing jail configurations

### Idempotent
You can re-run the scripts safely to:
- Update code after git pulls
- Reinstall dependencies
- Restart services

## Post-Setup

After running the setup, you may want to:

1. **Check logs**: `sh cbsd/cli/rmpca logs backend`
2. **Redeploy after changes**: `sh cbsd/deploy-existing.sh --all`
3. **Monitor health**: `sh cbsd/cli/rmpca status --health`

## Troubleshooting

If services don't start:
- Check jail logs: `cbsd jlogs jname=JAIL_NAME`
- Check service status: `cbsd jexec jname=JAIL_NAME service SERVICE status`
- Restart individual services: `cbsd jexec jname=JAIL_NAME service SERVICE restart`

## Files Modified/Created

- `cbsd/setup-existing.sh` - New main setup script
- `cbsd/deploy-existing.sh` - New deployment script
- `cbsd/SETUP_EXISTING.md` - This documentation

The original scripts (`setup.sh`, `deploy.sh`, etc.) remain unchanged for reference.
