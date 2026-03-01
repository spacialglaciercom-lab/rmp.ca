#!/usr/bin/env bash
#
# Build PMTiles from Overture Maps data and upload to Cloudflare R2.
#
# Usage:
#   ./scripts/build-pmtiles.sh                  # Build all cities
#   ./scripts/build-pmtiles.sh montreal         # Build one city
#   ./scripts/build-pmtiles.sh --list           # List available cities
#
# Requirements: Python 3 with duckdb, Docker (for tippecanoe + aws-cli)
# Credentials:  .env.r2

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.pmtiles-build"

# Load R2 credentials
if [ -f "$PROJECT_DIR/.env.r2" ]; then
  set -a
  source "$PROJECT_DIR/.env.r2"
  set +a
else
  echo "ERROR: .env.r2 not found. Create it with R2 credentials."
  exit 1
fi

OVERTURE_RELEASE="2026-02-18.0"
# Version suffix for filenames (YYYY-MM). Must match PMTILES_VERSION in components/maplibre/overture-style.ts
PMTILES_VERSION="v2026-02"
R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"

# Retry settings
UPLOAD_RETRIES=3
UPLOAD_RETRY_DELAY=5

# ─── City definitions (id=minLat|maxLat|minLon|maxLon) ────────
# Canadian cities only. US/Mexico cities removed to reduce build/hosting size.
declare -A CITIES=(
  [montreal]="45.41|45.70|-73.85|-73.50"
  [laval]="45.53|45.63|-73.80|-73.65"
  [longueuil]="45.43|45.55|-73.55|-73.42"
  [toronto]="43.58|43.85|-79.64|-79.11"
  [vancouver]="49.20|49.35|-123.25|-123.00"
  [ottawa]="45.30|45.55|-76.05|-75.50"
  [calgary]="50.90|51.20|-114.25|-113.85"
  [edmonton]="53.45|53.65|-113.65|-113.35"
  [quebec_city]="46.75|46.95|-71.35|-71.15"
  [halifax]="44.60|44.72|-63.70|-63.52"
)

# ─── Per-city zoom levels (core=8-14, secondary=10-13) ────────
declare -A CITY_MIN_ZOOM=(
  [montreal]=8  [laval]=8  [longueuil]=8  [toronto]=8  [vancouver]=8
  [ottawa]=10  [calgary]=10  [edmonton]=10  [quebec_city]=10  [halifax]=10
)
declare -A CITY_MAX_ZOOM=(
  [montreal]=14  [laval]=14  [longueuil]=14  [toronto]=14  [vancouver]=14
  [ottawa]=13  [calgary]=13  [edmonton]=13  [quebec_city]=13  [halifax]=13
)

# Road classes to include (drops footway, cycleway, path, track, driveway, parking_aisle, etc.)
ROAD_CLASSES="'residential','tertiary','secondary','primary','trunk','motorway','unclassified','living_street','service','secondary_link','primary_link','trunk_link','motorway_link'"

if [ "${1:-}" = "--list" ]; then
  echo "Available cities:"
  for city in $(echo "${!CITIES[@]}" | tr ' ' '\n' | sort); do
    echo "  $city"
  done
  exit 0
fi

# ─── Functions ─────────────────────────────────────────────────

extract_overture() {
  local city="$1"
  local bounds="${CITIES[$city]}"
  IFS='|' read -r minLat maxLat minLon maxLon <<< "$bounds"

  local outdir="$BUILD_DIR/$city"
  mkdir -p "$outdir"

  echo "==> Extracting Overture data for $city (bbox: $minLon,$minLat,$maxLon,$maxLat)..."
  if ! command -v python >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: Python 3 is required for Overture extraction. Install Python and duckdb."
    return 1
  fi

  python - "$outdir" "$minLon" "$minLat" "$maxLon" "$maxLat" "$OVERTURE_RELEASE" "$ROAD_CLASSES" <<'PYEOF'
import sys, json, duckdb

outdir = sys.argv[1]
min_lon, min_lat, max_lon, max_lat = float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
release = sys.argv[6]
road_classes = sys.argv[7]

con = duckdb.connect()
con.execute("INSTALL spatial; LOAD spatial;")
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute("SET s3_region='us-west-2';")

# Extract transportation segments (filtered by road class)
print("  Querying transportation segments...")
segments = con.execute(f"""
  SELECT
    id,
    names.primary AS name,
    subtype,
    class,
    subclass,
    ST_AsGeoJSON(geometry) AS geometry_json,
    road_surface[1].value AS surface
  FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=transportation/type=segment/*', hive_partitioning=1)
  WHERE bbox.xmin >= {min_lon}
    AND bbox.xmax <= {max_lon}
    AND bbox.ymin >= {min_lat}
    AND bbox.ymax <= {max_lat}
    AND class IN ({road_classes})
""").fetchall()

cols_seg = ['id','name','subtype','class','subclass','geometry_json','surface']
features = []
for row in segments:
    d = dict(zip(cols_seg, row))
    geom = json.loads(d.pop('geometry_json'))
    props = {k: v for k, v in d.items() if v is not None}
    features.append({"type": "Feature", "geometry": geom, "properties": props})
print(f"  Segments: {len(features)}")

# Extract transportation connectors
print("  Querying transportation connectors...")
connectors = con.execute(f"""
  SELECT
    id,
    ST_AsGeoJSON(geometry) AS geometry_json
  FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=transportation/type=connector/*', hive_partitioning=1)
  WHERE bbox.xmin >= {min_lon}
    AND bbox.xmax <= {max_lon}
    AND bbox.ymin >= {min_lat}
    AND bbox.ymax <= {max_lat}
""").fetchall()

for row in connectors:
    geom = json.loads(row[1])
    features.append({"type": "Feature", "geometry": geom, "properties": {"id": row[0], "type": "connector"}})
print(f"  Connectors: {len(connectors)}")

# Write GeoJSON
fc = {"type": "FeatureCollection", "features": features}
outpath = f"{outdir}/merged.geojson"
with open(outpath, 'w') as f:
    json.dump(fc, f)
print(f"  Total features: {len(features)}")
print(f"  Written to: {outpath}")

con.close()
PYEOF
}

TIPPECANOE_IMAGE="tippecanoe-builder:local"

# Build a local Docker image with tippecanoe compiled from source.
# Cached after first run — only rebuilds if image doesn't exist.
ensure_tippecanoe_image() {
  if docker image inspect "$TIPPECANOE_IMAGE" >/dev/null 2>&1; then
    return 0
  fi
  echo "==> Building tippecanoe Docker image (first run only)..."
  docker build -t "$TIPPECANOE_IMAGE" -f - . <<'DOCKERFILE'
FROM ubuntu:22.04
RUN apt-get update -qq && \
    apt-get install -y -qq git build-essential libsqlite3-dev zlib1g-dev && \
    cd /tmp && git clone -q https://github.com/felt/tippecanoe.git && \
    cd tippecanoe && make -j$(nproc) -s && make install -s && \
    cd / && rm -rf /tmp/tippecanoe && \
    apt-get remove -y git build-essential && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*
DOCKERFILE
}

build_pmtiles() {
  local city="$1"
  local outdir="$BUILD_DIR/$city"
  local output_name="${city}-${PMTILES_VERSION}.pmtiles"
  local min_zoom="${CITY_MIN_ZOOM[$city]:-10}"
  local max_zoom="${CITY_MAX_ZOOM[$city]:-14}"

  if [ ! -f "$outdir/merged.geojson" ]; then
    echo "ERROR: merged.geojson not found for $city"
    return 1
  fi

  echo "==> Building PMTiles for $city (${output_name}, zoom ${min_zoom}-${max_zoom})..."

  ensure_tippecanoe_image

  # Windows Docker path: use C:/ format with MSYS_NO_PATHCONV
  local win_path
  win_path=$(cd "$outdir" && pwd -W 2>/dev/null || echo "$outdir" | sed 's|^/c/|C:/|')

  if ! MSYS_NO_PATHCONV=1 docker run --rm \
    -v "${win_path}:/data" \
    "$TIPPECANOE_IMAGE" \
    tippecanoe \
      -o "/data/${output_name}" \
      -z "$max_zoom" -Z "$min_zoom" \
      --drop-densest-as-needed \
      --extend-zooms-if-still-dropping \
      --force \
      -l transportation \
      /data/merged.geojson; then
    echo "ERROR: tippecanoe failed for $city"
    return 1
  fi

  if [ -f "$outdir/${output_name}" ]; then
    local size
    size=$(wc -c < "$outdir/${output_name}" 2>/dev/null || echo "0")
    echo "  PMTiles created: ${output_name} ($(numfmt --to=iec $size 2>/dev/null || echo "$size bytes"))"
  else
    echo "ERROR: tippecanoe did not produce ${output_name}"
    return 1
  fi
}

upload_to_r2() {
  local city="$1"
  local outdir="$BUILD_DIR/$city"
  local output_name="${city}-${PMTILES_VERSION}.pmtiles"
  local pmtiles_file="$outdir/${output_name}"

  if [ ! -f "$pmtiles_file" ]; then
    echo "ERROR: $pmtiles_file not found"
    return 1
  fi

  echo "==> Uploading ${output_name} to R2 bucket '$R2_BUCKET'..."

  local win_path
  win_path=$(cd "$outdir" && pwd -W 2>/dev/null || echo "$outdir" | sed 's|^/c/|C:/|')

  local attempt=1
  while [ $attempt -le "$UPLOAD_RETRIES" ]; do
    if MSYS_NO_PATHCONV=1 docker run --rm \
      -v "${win_path}:/data" \
      -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
      -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
      amazon/aws-cli \
      s3 cp "/data/${output_name}" "s3://${R2_BUCKET}/tiles/${output_name}" \
      --endpoint-url "$R2_ENDPOINT" \
      --content-type "application/vnd.pmtiles"; then
      echo "  Uploaded: tiles/${output_name}"
      return 0
    fi
    echo "  Upload attempt $attempt/$UPLOAD_RETRIES failed. Retrying in ${UPLOAD_RETRY_DELAY}s..."
    sleep "$UPLOAD_RETRY_DELAY"
    attempt=$((attempt + 1))
  done
  echo "ERROR: Failed to upload ${output_name} after $UPLOAD_RETRIES attempts"
  return 1
}

process_city() {
  local city="$1"
  echo ""
  echo "════════════════════════════════════════"
  echo "  Processing: $city"
  echo "════════════════════════════════════════"
  extract_overture "$city"
  build_pmtiles "$city"
  upload_to_r2 "$city"
  echo "  Done: $city"
}

# ─── Main ──────────────────────────────────────────────────────

mkdir -p "$BUILD_DIR"

echo "Overture Maps → PMTiles → Cloudflare R2 Pipeline"
echo "Release: $OVERTURE_RELEASE"
echo "Bucket:  $R2_BUCKET"
echo ""

if [ -n "${1:-}" ] && [ "$1" != "--list" ]; then
  if [ -z "${CITIES[$1]+x}" ]; then
    echo "ERROR: Unknown city '$1'. Use --list to see available cities."
    exit 1
  fi
  process_city "$1"
else
  for city in $(echo "${!CITIES[@]}" | tr ' ' '\n' | sort); do
    process_city "$city"
  done
fi

echo ""
echo "==> All done!"
echo "PMTiles URL pattern: https://pub-${R2_ACCOUNT_ID}.r2.dev/tiles/{city}-${PMTILES_VERSION}.pmtiles"
echo "Update PMTILES_VERSION in components/maplibre/overture-style.ts when deploying a new build."
