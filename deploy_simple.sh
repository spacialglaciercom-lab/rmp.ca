#!/bin/sh
# Simple deployment script for existing jails (non-Bastille)
# This script copies application files into the jails and starts services

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Deploying to existing jails ==="

# Function to copy files into jail
deploy_to_jail() {
    local jail_name="$1"
    local jail_path="$2"
    local src_path="$3"
    local dest_path="$4"
    
    echo "Deploying to ${jail_name}..."
    
    # Create destination directory
    mkdir -p "${jail_path}${dest_path}"
    
    # Copy files
    cp -R "${src_path}"/* "${jail_path}${dest_path}/"
    
    # Set permissions
    chown -R root:wheel "${jail_path}${dest_path}"
    chmod -R 755 "${jail_path}${dest_path}"
}

# 1. Deploy extract service
echo "Deploying extract service..."
deploy_to_jail "rmpca-extract" "/usr/jails/jails/rmpca-extract" "${REPO_ROOT}/extract" "/app/extract"

# 2. Deploy backend service  
echo "Deploying backend service..."
deploy_to_jail "rmpca-backend" "/usr/jails/jails/rmpca-backend" "${REPO_ROOT}" "/app"

# Create environment configuration for backend
cat > /usr/jails/jails/rmpca-backend/usr/local/etc/rmpca/backend.env << 'ENV'
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://10.0.0.2:9000
ENV

# Create environment configuration for extract
cat > /usr/jails/jails/rmpca-extract/usr/local/etc/rmpca/extract.env << 'ENV'
PORT=9000
NODE_ENV=production
ENV

echo "=== Deployment complete ==="
echo "You may need to manually start the services inside each jail:"
echo "  jexec rmpca-backend /bin/sh -c 'cd /app && pnpm install && pnpm run build:server && pnpm start:server'"
echo "  jexec rmpca-extract /bin/sh -c 'cd /app/extract && npm install && node server.js'"
