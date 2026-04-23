#!/bin/sh
# Deployment script for CBSD jails
# This script copies application files into the writable jail data directories

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Deploying to CBSD jails ==="

# Function to copy files into jail data directory
deploy_to_jail() {
    local jail_name="$1"
    local jail_data_path="$2"
    local src_path="$3"
    local dest_path="$4"
    
    echo "Deploying to ${jail_name}..."
    
    # Create destination directory in the writable data area
    mkdir -p "${jail_data_path}${dest_path}"
    
    # Copy files
    echo "Copying files from ${src_path} to ${jail_data_path}${dest_path}"
    cp -R "${src_path}"/* "${jail_data_path}${dest_path}/"
    
    # Set appropriate permissions
    chown -R root:wheel "${jail_data_path}${dest_path}"
    chmod -R 755 "${jail_data_path}${dest_path}"
}

# 1. Deploy extract service
echo "Deploying extract service..."
deploy_to_jail "rmpca-extract" "/usr/jails/jails-data/rmpca-extract-data" "${REPO_ROOT}/extract" "/app/extract"

# 2. Deploy backend service  
echo "Deploying backend service..."
deploy_to_jail "rmpca-backend" "/usr/jails/jails-data/rmpca-backend-data" "${REPO_ROOT}" "/app"

# Create environment configuration for backend
echo "Creating backend environment configuration..."
mkdir -p /usr/jails/jails-data/rmpca-backend-data/usr/local/etc/rmpca
cat > /usr/jails/jails-data/rmpca-backend-data/usr/local/etc/rmpca/backend.env << 'ENV'
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://10.0.0.2:9000
ENV

# Create environment configuration for extract
echo "Creating extract environment configuration..."
mkdir -p /usr/jails/jails-data/rmpca-extract-data/usr/local/etc/rmpca
cat > /usr/jails/jails-data/rmpca-extract-data/usr/local/etc/rmpca/extract.env << 'ENV'
PORT=9000
NODE_ENV=production
ENV

echo "=== Deployment complete ==="
echo "Services need to be started manually inside each jail."
echo "The jails are using CBSD, so you may need to use cbsd or jail commands to start services."
echo "Check the jail documentation for service management."
