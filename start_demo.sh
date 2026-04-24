#!/bin/bash
# Start demo services with ngrok tunnel
# Demo URL: https://rmpdemo.ngrok.app

set -e

echo "Building web app..."
pnpm run build:web

echo "Starting Docker services..."
docker compose -f docker-compose.yml -f docker-compose.optimizer.yml -f docker-compose.demo.yml --profile optimizer up -d

echo "Waiting for services to be healthy..."
sleep 5

echo "Starting ngrok tunnel..."
echo "Demo will be available at: https://rmpdemo.ngrok.app"
ngrok http --url=rmpdemo.ngrok.app 80
