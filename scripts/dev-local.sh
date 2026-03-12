#!/usr/bin/env bash
# Local development: start the Python optimizer backend via Docker Compose.
# On Windows run from Git Bash or WSL. Requires Docker Desktop.
#
# VPN note: docker-compose.yml passes BASE_IMAGE=public.ecr.aws/... to the
# build so Docker pulls from AWS ECR Public Gallery, not Docker Hub.
set -eu
# pipefail not used for Windows Git Bash compatibility

echo "[dev] Checking Docker Desktop..."

# Wait up to 30 s for Docker daemon to become ready
docker_was_ready=false
for i in $(seq 1 6); do
  if docker info > /dev/null 2>&1; then
    docker_was_ready=true
    break
  fi
  if [ "$i" -eq 6 ]; then
    echo "[dev] Docker Desktop is not running. Please start it and retry."
    exit 1
  fi
  echo "[dev] Waiting for Docker Desktop... (${i}/6)"
  sleep 5
done

if $docker_was_ready && [ "${i:-1}" -eq 1 ]; then
  echo "[dev] Docker Desktop already running."
else
  echo "[dev] Docker Desktop ready."
fi

echo "[dev] Starting optimizer backend (docker compose)..."

cd "$(dirname "$0")/.."

docker compose up --build -d

echo "[dev] Optimizer backend running at http://localhost:8080"
echo "[dev] Logs: docker compose logs -f rmpca-backend"
echo "[dev] Stop:  docker compose down"
