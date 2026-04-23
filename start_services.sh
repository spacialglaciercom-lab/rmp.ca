#!/bin/sh
# Simple script to start services in jails
# Run this after deploying the application code

echo "=== Starting Jail Services ==="

# Start extract service
echo "Starting extract service in rmpca-extract jail..."
jexec rmpca-extract sh -c "
    if [ -d /usr/local/app/extract ]; then
        cd /usr/local/app/extract
        if [ -f package.json ]; then
            if [ ! -d node_modules ]; then
                echo 'Installing dependencies...'
                npm install --production
            fi
            echo 'Starting extract service on port 9000...'
            node server.js &
            echo 'Extract service started'
        else
            echo 'ERROR: package.json not found in /usr/local/app/extract'
        fi
    else
        echo 'ERROR: /usr/local/app/extract directory not found'
    fi
" || echo "Failed to start extract service - check jail access and deployment"

# Start backend service
echo "Starting backend service in rmpca-backend jail..."
jexec rmpca-backend sh -c "
    if [ -d /usr/local/app ]; then
        cd /usr/local/app
        if [ -f package.json ]; then
            if [ ! -d node_modules ]; then
                echo 'Installing dependencies...'
                npm install -g pnpm@10.0.0
                pnpm install --prod
            fi
            if [ -f .env ]; then
                . .env
            fi
            if [ -f /usr/local/etc/rmpca/backend.env ]; then
                . /usr/local/etc/rmpca/backend.env
            fi
            echo 'Starting backend service on port 3000...'
            pnpm start:server &
            echo 'Backend service started'
        else
            echo 'ERROR: package.json not found in /usr/local/app'
        fi
    else
        echo 'ERROR: /usr/local/app directory not found'
    fi
" || echo "Failed to start backend service - check jail access and deployment"

echo "=== Service Startup Complete ==="
echo "Check service status with: sockstat -l | grep -E '(3000|9000)'"
echo "Test backend: curl -v http://localhost:3000/health"
echo "Test extract: curl -v http://localhost:9000/health"
