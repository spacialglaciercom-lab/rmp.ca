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
declare -A CITIES=(
  [montreal]="45.2293|45.7913|-74.5876|-73.3104"
  [toronto]="43.58|43.85|-79.64|-79.11"
  [vancouver]="49.20|49.35|-123.25|-123.00"
  [ottawa]="45.30|45.55|-76.05|-75.50"
  [calgary]="50.90|51.20|-114.25|-113.85"
  [edmonton]="53.45|53.65|-113.65|-113.35"
  [quebec_city]="46.75|46.95|-71.35|-71.15"
  [quebec_south]="45.0|47.5|-74.5|-70.5"
  [halifax]="44.60|44.72|-63.70|-63.52"
  [new_york]="40.48|40.95|-74.30|-73.65"
  [los_angeles]="33.70|34.35|-118.65|-118.15"
  [chicago]="41.64|42.02|-87.95|-87.52"
  [houston]="29.62|29.95|-95.55|-95.12"
  [phoenix]="33.25|33.65|-112.25|-111.60"
  [philadelphia]="39.87|40.15|-75.30|-74.95"
  [san_antonio]="29.32|29.60|-98.65|-98.38"
  [san_diego]="32.53|33.12|-117.25|-116.90"
  [dallas]="32.65|32.99|-97.05|-96.55"
  [detroit]="42.25|42.45|-83.35|-82.90"
  [boston]="42.25|42.45|-71.20|-70.95"
  [mexico_city]="19.20|19.55|-99.25|-98.95"
)

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

  python - "$outdir" "$minLon" "$minLat" "$maxLon" "$maxLat" "$OVERTURE_RELEASE" <<'PYEOF'
import sys, json, duckdb

outdir = sys.argv[1]
min_lon, min_lat, max_lon, max_lat = float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
release = sys.argv[6]

con = duckdb.connect()
con.execute("INSTALL spatial; LOAD spatial;")
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute("SET s3_region='us-west-2';")

# Extract transportation segments
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

build_pmtiles() {
  local city="$1"
  local outdir="$BUILD_DIR/$city"
  local output_name="${city}-${PMTILES_VERSION}.pmtiles"

  if [ ! -f "$outdir/merged.geojson" ]; then
    echo "ERROR: merged.geojson not found for $city"
    return 1
  fi

  echo "==> Building PMTiles for $city (${output_name})..."

  # Windows Docker path: use C:/ format with MSYS_NO_PATHCONV
  local win_path
  win_path=$(cd "$outdir" && pwd -W 2>/dev/null || echo "$outdir" | sed 's|^/c/|C:/|')

  if ! MSYS_NO_PATHCONV=1 docker run --rm \
    -v "${win_path}:/data" \
    morlov/tippecanoe:latest \
    tippecanoe \
      -o "/data/${output_name}" \
      -z 14 -Z 8 \
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
    # Optional: validate if pmtiles CLI is available
    if command -v pmtiles >/dev/null 2>&1; then
      if pmtiles validate "$outdir/${output_name}" 2>/dev/null; then
        echo "  Validation: OK"
      else
        echo "  WARNING: pmtiles validate failed (optional)"
      fi
    fi
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
