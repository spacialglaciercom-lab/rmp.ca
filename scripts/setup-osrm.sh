#!/usr/bin/env bash
# Downloads Canada OSM data from Geofabrik and preprocesses it for OSRM (MLD algorithm).
#
# Usage:
#   ./scripts/setup-osrm.sh            # Full Canada (~1.5 GB download, ~20-40 min preprocessing)
#   ./scripts/setup-osrm.sh quebec     # Quebec only (~150 MB, faster for development)
#
# After this script completes, start OSRM with:
#   docker compose -f docker-compose.yml -f docker-compose.osrm.yml --profile osrm up -d
#
# Then add to .env.local:
#   EXPO_PUBLIC_OSRM_URL=http://localhost:5000

set -euo pipefail

REGION="${1:-canada}"
DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/osrm-data"
DOCKER_IMAGE="osrm/osrm-backend:latest"

# Map friendly region names to Geofabrik paths
case "$REGION" in
  canada)
    URL="https://download.geofabrik.de/north-america/canada-latest.osm.pbf"
    ;;
  quebec)
    URL="https://download.geofabrik.de/north-america/canada/quebec-latest.osm.pbf"
    ;;
  ontario)
    URL="https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf"
    ;;
  british-columbia|bc)
    URL="https://download.geofabrik.de/north-america/canada/british-columbia-latest.osm.pbf"
    ;;
  alberta)
    URL="https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf"
    ;;
  new-brunswick)
    URL="https://download.geofabrik.de/north-america/canada/new-brunswick-latest.osm.pbf"
    ;;
  *)
    echo "Unknown region: $REGION"
    echo "Supported: canada, quebec, ontario, british-columbia, alberta, new-brunswick"
    exit 1
    ;;
esac

echo "==> Region: $REGION"
echo "==> Data directory: $DATA_DIR"
echo "==> Source: $URL"
echo ""

mkdir -p "$DATA_DIR"

PBF="$DATA_DIR/region.osm.pbf"

# Download (skip if already present and non-empty)
if [[ -f "$PBF" && -s "$PBF" ]]; then
  echo "==> Skipping download — $PBF already exists."
  echo "    Delete it to re-download: rm $PBF"
else
  echo "==> Downloading OSM data..."
  wget --progress=bar:force -O "$PBF" "$URL"
  echo "==> Download complete."
fi

echo ""
echo "==> Pulling OSRM Docker image..."
docker pull "$DOCKER_IMAGE"

echo ""
echo "==> Step 1/3: osrm-extract (profiling road network)..."
echo "    This can take 10-30 minutes for Canada-wide data."
docker run --rm -t \
  -v "$DATA_DIR:/data" \
  "$DOCKER_IMAGE" \
  osrm-extract -p /opt/car.lua /data/region.osm.pbf

echo ""
echo "==> Step 2/3: osrm-partition (graph partitioning for MLD)..."
docker run --rm -t \
  -v "$DATA_DIR:/data" \
  "$DOCKER_IMAGE" \
  osrm-partition /data/region.osrm

echo ""
echo "==> Step 3/3: osrm-customize (metric customization)..."
docker run --rm -t \
  -v "$DATA_DIR:/data" \
  "$DOCKER_IMAGE" \
  osrm-customize /data/region.osrm

echo ""
echo "==> OSRM preprocessing complete!"
echo ""
echo "Start OSRM with:"
echo "  docker compose -f docker-compose.yml -f docker-compose.osrm.yml --profile osrm up -d"
echo ""
echo "Then add to .env.local:"
echo "  EXPO_PUBLIC_OSRM_URL=http://localhost:5000"
echo ""
echo "Verify it works:"
echo "  curl 'http://localhost:5000/route/v1/driving/-73.6,45.5;-73.5,45.5?steps=true' | head -c 200"
