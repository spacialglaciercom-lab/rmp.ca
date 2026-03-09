#!/usr/bin/env bash
# Local development: start the Python optimizer backend via Docker Compose.
# On Windows run from Git Bash or WSL. Requires Docker Desktop.
set -euo pipefail

echo "[dev] Checking Docker Desktop..."

# Wait up to 30 s for Docker daemon to become ready
for i in $(seq 1 6); do
  if docker info > /dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 6 ]; then
    echo "[dev] Docker Desktop is not running. Please start it and retry."
    exit 1
  fi
  echo "[dev] Waiting for Docker Desktop... (${i}/6)"
  sleep 5
done

echo "[dev] Docker Desktop already running."

# ---------------------------------------------------------------------------
# Pre-pull base images from AWS ECR Public Gallery and tag them as their
# Docker Hub equivalents. Docker Hub (registry-1.docker.io) can time out on
# TLS handshakes when running behind a VPN. AWS ECR Public is unaffected.
# Once the image is in local cache Docker never re-pulls from Docker Hub.
# ---------------------------------------------------------------------------
ecr_pull_and_tag() {
  local ecr_image="$1"   # e.g. public.ecr.aws/docker/library/python:3.12-slim
  local hub_image="$2"   # e.g. python:3.12-slim

  if docker image inspect "$hub_image" > /dev/null 2>&1; then
    echo "[dev] Image $hub_image already cached, skipping pull."
    return 0
  fi

  echo "[dev] Pulling $ecr_image (AWS ECR mirror)..."
  if docker pull "$ecr_image"; then
    docker tag "$ecr_image" "$hub_image"
    echo "[dev] Tagged $ecr_image -> $hub_image"
  else
    echo "[dev] WARNING: Could not pull $ecr_image. Build may fail if $hub_image is not cached."
  fi
}

ecr_pull_and_tag "public.ecr.aws/docker/library/python:3.12-slim" "python:3.12-slim"
ecr_pull_and_tag "public.ecr.aws/docker/library/node:20-alpine"   "node:20-alpine"

# ---------------------------------------------------------------------------
echo "[dev] Starting optimizer backend (docker compose)..."

cd "$(dirname "$0")/.."

docker compose up --build -d

echo "[dev] Optimizer backend running at http://localhost:8080"
echo "[dev] Logs: docker compose logs -f rmpca-backend"
echo "[dev] Stop:  docker compose down"
