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

OVERTURE_RELEASE="2026-04-15.0"
# Version suffix for filenames (YYYY-MM). Must match PMTILES_VERSION in components/maplibre/overture-style.ts
PMTILES_VERSION="v2026-04"
R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"

# Retry settings
UPLOAD_RETRIES=3
UPLOAD_RETRY_DELAY=5

# ─── City definitions (id=minLat|maxLat|minLon|maxLon) ────────
# North America: Canada, US, Mexico
declare -A CITIES=(
  # ── Canada (existing) ──
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
  [winnipeg]="49.75|49.95|-97.25|-97.05"
  [saskatoon]="52.08|52.20|-106.72|-106.58"
  [regina]="50.40|50.50|-104.70|-104.55"
  [victoria]="48.40|48.50|-123.45|-123.30"
  [hamilton]="43.20|43.30|-79.95|-79.75"
  [kitchener]="43.38|43.50|-80.60|-80.40"
  [london_on]="42.90|43.05|-81.35|-81.15"
  [st_johns]="47.50|47.60|-52.78|-52.65"
  [fredericton]="45.90|45.98|-66.70|-66.58"
  [charlottetown]="46.22|46.28|-63.17|-63.10"
  # ── Canada (new) ──
  [mississauga]="43.52|43.65|-79.75|-79.54"
  [brampton]="43.65|43.80|-79.80|-79.65"
  [markham]="43.82|43.93|-79.40|-79.22"
  [vaughan]="43.77|43.92|-79.60|-79.42"
  [surrey]="49.05|49.22|-122.90|-122.68"
  [burnaby]="49.20|49.30|-123.02|-122.89"
  [richmond_bc]="49.12|49.20|-123.22|-123.08"
  [gatineau]="45.42|45.52|-75.80|-75.60"
  [sherbrooke]="45.35|45.45|-71.95|-71.82"
  [trois_rivieres]="46.32|46.38|-72.60|-72.48"
  [saguenay]="48.38|48.48|-71.10|-70.88"
  [kelowna]="49.82|49.92|-119.55|-119.40"
  [kamloops]="50.66|50.74|-120.40|-120.28"
  [nanaimo]="49.13|49.23|-124.00|-123.90"
  [prince_george]="53.86|53.94|-122.82|-122.72"
  [lethbridge]="49.66|49.72|-112.86|-112.76"
  [red_deer]="52.22|52.30|-113.85|-113.76"
  [medicine_hat]="50.02|50.08|-110.70|-110.62"
  [thunder_bay]="48.36|48.46|-89.30|-89.18"
  [windsor]="42.28|42.36|-83.10|-82.90"
  [sudbury]="46.45|46.55|-81.05|-80.90"
  [barrie]="44.34|44.42|-79.72|-79.63"
  [oshawa]="43.85|43.93|-78.90|-78.80"
  [kingston]="44.20|44.28|-76.55|-76.44"
  [guelph]="43.50|43.58|-80.30|-80.20"
  [st_catharines]="43.14|43.22|-79.28|-79.18"
  [saint_john]="45.24|45.30|-66.10|-66.00"
  [moncton]="46.06|46.14|-64.85|-64.74"
  [whitehorse]="60.70|60.74|-135.10|-134.98"
  [yellowknife]="62.44|62.48|-114.42|-114.34"
  # ── US (major metros) ──
  [new_york]="40.49|40.92|-74.26|-73.70"
  [los_angeles]="33.70|34.34|-118.67|-118.15"
  [chicago]="41.64|42.02|-87.94|-87.52"
  [houston]="29.52|30.11|-95.79|-95.07"
  [phoenix]="33.29|33.70|-112.33|-111.79"
  [philadelphia]="39.87|40.14|-75.28|-74.95"
  [san_antonio]="29.28|29.60|-98.65|-98.37"
  [san_diego]="32.53|33.02|-117.28|-116.92"
  [dallas]="32.62|33.02|-96.95|-96.56"
  [austin]="30.10|30.52|-97.94|-97.56"
  [jacksonville]="30.10|30.50|-81.80|-81.38"
  [san_jose]="37.18|37.44|-122.05|-121.72"
  [fort_worth]="32.60|32.90|-97.50|-97.15"
  [columbus_oh]="39.86|40.13|-83.10|-82.77"
  [charlotte]="35.05|35.40|-80.95|-80.68"
  [indianapolis]="39.63|39.93|-86.30|-85.95"
  [san_francisco]="37.70|37.82|-122.52|-122.35"
  [seattle]="47.49|47.74|-122.43|-122.24"
  [denver]="39.61|39.82|-105.11|-104.87"
  [washington_dc]="38.79|38.99|-77.12|-76.91"
  [nashville]="35.97|36.27|-86.95|-86.60"
  [oklahoma_city]="35.32|35.60|-97.68|-97.38"
  [el_paso]="31.65|31.88|-106.62|-106.32"
  [boston]="42.23|42.40|-71.19|-70.99"
  [portland_or]="45.43|45.60|-122.83|-122.57"
  [las_vegas]="35.98|36.33|-115.38|-115.00"
  [memphis]="35.00|35.22|-90.10|-89.85"
  [louisville]="38.10|38.30|-85.85|-85.55"
  [baltimore]="39.20|39.37|-76.72|-76.52"
  [milwaukee]="42.92|43.12|-88.01|-87.84"
  [albuquerque]="34.98|35.22|-106.78|-106.48"
  [tucson]="32.10|32.32|-111.05|-110.80"
  [fresno]="36.65|36.82|-119.90|-119.68"
  [sacramento]="38.45|38.68|-121.55|-121.35"
  [mesa]="33.35|33.50|-111.88|-111.63"
  [kansas_city]="38.88|39.15|-94.72|-94.44"
  [atlanta]="33.64|33.89|-84.55|-84.28"
  [omaha]="41.17|41.32|-96.05|-95.86"
  [miami]="25.70|25.86|-80.32|-80.12"
  [raleigh]="35.72|35.90|-78.78|-78.54"
  [minneapolis]="44.88|45.06|-93.35|-93.20"
  [tampa]="27.85|28.08|-82.55|-82.38"
  [new_orleans]="29.86|30.05|-90.14|-89.90"
  [cleveland]="41.38|41.55|-81.82|-81.55"
  [pittsburgh]="40.36|40.50|-80.10|-79.86"
  [st_louis]="38.53|38.75|-90.35|-90.15"
  [cincinnati]="39.07|39.22|-84.60|-84.42"
  [orlando]="28.37|28.62|-81.50|-81.25"
  [salt_lake_city]="40.70|40.82|-111.97|-111.83"
  [detroit]="42.25|42.45|-83.25|-82.91"
  [honolulu]="21.25|21.38|-157.88|-157.78"
  [anchorage]="61.10|61.25|-149.95|-149.75"
  # ── Mexico (major metros) ──
  [mexico_city]="19.20|19.59|-99.35|-98.96"
  [guadalajara]="20.55|20.78|-103.45|-103.24"
  [monterrey]="25.58|25.78|-100.44|-100.22"
  [puebla]="18.98|19.10|-98.25|-98.12"
  [tijuana]="32.42|32.55|-117.10|-116.90"
  [leon]="21.08|21.18|-101.72|-101.60"
  [juarez]="31.62|31.80|-106.52|-106.36"
  [cancun]="21.06|21.22|-86.90|-86.74"
  [merida]="20.90|21.04|-89.70|-89.56"
  [queretaro]="20.52|20.66|-100.44|-100.32"
)

# ─── Per-city zoom levels ─────────────────────────────────────
# Large metros: 8-14, mid-size: 10-14, smaller: 10-13
declare -A CITY_MIN_ZOOM=(
  # Canada (existing)
  [montreal]=8  [laval]=8  [longueuil]=8  [toronto]=8  [vancouver]=8
  [ottawa]=10  [calgary]=10  [edmonton]=10  [quebec_city]=10  [halifax]=10
  [winnipeg]=10  [saskatoon]=10  [regina]=10  [victoria]=10
  [hamilton]=10  [kitchener]=10  [london_on]=10  [st_johns]=10
  [fredericton]=10  [charlottetown]=10
  # Canada (new)
  [mississauga]=10  [brampton]=10  [markham]=10  [vaughan]=10
  [surrey]=10  [burnaby]=10  [richmond_bc]=10  [gatineau]=10
  [sherbrooke]=10  [trois_rivieres]=10  [saguenay]=10
  [kelowna]=10  [kamloops]=10  [nanaimo]=10  [prince_george]=10
  [lethbridge]=10  [red_deer]=10  [medicine_hat]=10
  [thunder_bay]=10  [windsor]=10  [sudbury]=10  [barrie]=10
  [oshawa]=10  [kingston]=10  [guelph]=10  [st_catharines]=10
  [saint_john]=10  [moncton]=10  [whitehorse]=10  [yellowknife]=10
  # US (large metros)
  [new_york]=8  [los_angeles]=8  [chicago]=8  [houston]=8  [phoenix]=8
  [philadelphia]=8  [dallas]=8  [san_diego]=8  [san_antonio]=8
  [san_francisco]=8  [seattle]=8  [denver]=8  [washington_dc]=8
  [boston]=8  [atlanta]=8  [miami]=8  [detroit]=8
  # US (mid-size)
  [austin]=10  [jacksonville]=10  [san_jose]=10  [fort_worth]=10
  [columbus_oh]=10  [charlotte]=10  [indianapolis]=10  [nashville]=10
  [oklahoma_city]=10  [el_paso]=10  [portland_or]=10  [las_vegas]=10
  [memphis]=10  [louisville]=10  [baltimore]=10  [milwaukee]=10
  [albuquerque]=10  [tucson]=10  [fresno]=10  [sacramento]=10
  [mesa]=10  [kansas_city]=10  [omaha]=10  [raleigh]=10
  [minneapolis]=10  [tampa]=10  [new_orleans]=10  [cleveland]=10
  [pittsburgh]=10  [st_louis]=10  [cincinnati]=10  [orlando]=10
  [salt_lake_city]=10  [honolulu]=10  [anchorage]=10
  # Mexico
  [mexico_city]=8  [guadalajara]=10  [monterrey]=10  [puebla]=10
  [tijuana]=10  [leon]=10  [juarez]=10  [cancun]=10
  [merida]=10  [queretaro]=10
)
declare -A CITY_MAX_ZOOM=(
  # Canada (existing)
  [montreal]=14  [laval]=14  [longueuil]=14  [toronto]=14  [vancouver]=14
  [ottawa]=13  [calgary]=13  [edmonton]=13  [quebec_city]=13  [halifax]=13
  [winnipeg]=13  [saskatoon]=13  [regina]=13  [victoria]=13
  [hamilton]=13  [kitchener]=13  [london_on]=13  [st_johns]=13
  [fredericton]=13  [charlottetown]=13
  # Canada (new)
  [mississauga]=14  [brampton]=13  [markham]=13  [vaughan]=13
  [surrey]=14  [burnaby]=13  [richmond_bc]=13  [gatineau]=13
  [sherbrooke]=13  [trois_rivieres]=13  [saguenay]=13
  [kelowna]=13  [kamloops]=13  [nanaimo]=13  [prince_george]=13
  [lethbridge]=13  [red_deer]=13  [medicine_hat]=13
  [thunder_bay]=13  [windsor]=13  [sudbury]=13  [barrie]=13
  [oshawa]=13  [kingston]=13  [guelph]=13  [st_catharines]=13
  [saint_john]=13  [moncton]=13  [whitehorse]=13  [yellowknife]=13
  # US (large metros)
  [new_york]=14  [los_angeles]=14  [chicago]=14  [houston]=14  [phoenix]=14
  [philadelphia]=14  [dallas]=14  [san_diego]=14  [san_antonio]=14
  [san_francisco]=14  [seattle]=14  [denver]=14  [washington_dc]=14
  [boston]=14  [atlanta]=14  [miami]=14  [detroit]=14
  # US (mid-size)
  [austin]=14  [jacksonville]=13  [san_jose]=14  [fort_worth]=13
  [columbus_oh]=14  [charlotte]=14  [indianapolis]=14  [nashville]=14
  [oklahoma_city]=13  [el_paso]=13  [portland_or]=14  [las_vegas]=14
  [memphis]=13  [louisville]=13  [baltimore]=14  [milwaukee]=14
  [albuquerque]=13  [tucson]=13  [fresno]=13  [sacramento]=14
  [mesa]=13  [kansas_city]=14  [omaha]=13  [raleigh]=14
  [minneapolis]=14  [tampa]=14  [new_orleans]=14  [cleveland]=14
  [pittsburgh]=14  [st_louis]=14  [cincinnati]=14  [orlando]=14
  [salt_lake_city]=14  [honolulu]=13  [anchorage]=13
  # Mexico
  [mexico_city]=14  [guadalajara]=14  [monterrey]=14  [puebla]=13
  [tijuana]=13  [leon]=13  [juarez]=13  [cancun]=13
  [merida]=13  [queretaro]=13
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
