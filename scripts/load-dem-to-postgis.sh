#!/bin/bash
# ============================================================================
# Load DEM (Digital Elevation Model) GeoTIFF into PostGIS
# ============================================================================
# This script loads elevation data into the PostgreSQL/PostGIS database for
# use by the FuelAwarePostGISPlugin routing cost plugin.
#
# Prerequisites:
#   - PostgreSQL with PostGIS and postgis_raster extensions enabled
#   - raster2pgsql tool (comes with PostGIS)
#   - GeoTIFF file in WGS84 (EPSG:4326) projection
#
# Usage:
#   ./scripts/load-dem-to-postgis.sh [path/to/dem.tif]
#
# Environment:
#   DATABASE_URL - PostgreSQL connection string (required)
#   DEM_TILE_SIZE - Tile size for raster (default: 100x100)
#
# Example:
#   DATABASE_URL=postgresql://postgres@10.17.89.2:5432/routemaster \
#     ./scripts/load-dem-to-postgis.sh n45_w074_1arc_v3.tif
# ============================================================================

set -e

# Configuration
DEM_FILE="${1:-n45_w074_1arc_v3.tif}"
TABLE_NAME="dem_elevation"
TILE_SIZE="${DEM_TILE_SIZE:-100x100}"

# Check for DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL environment variable not set"
    echo "Example: export DATABASE_URL=postgresql://postgres@10.17.89.2:5432/routemaster"
    exit 1
fi

# Check if DEM file exists
if [ ! -f "$DEM_FILE" ]; then
    echo "Error: DEM file not found: $DEM_FILE"
    echo ""
    echo "Download SRTM/ASTER DEM data from:"
    echo "  - NASA EarthData: https://earthdata.nasa.gov"
    echo "  - USGS Earth Explorer: https://earthexplorer.usgs.gov"
    echo "  - CGIAR SRTM: https://srtm.csi.cgiar.org"
    exit 1
fi

echo "=========================================="
echo "Loading DEM into PostGIS"
echo "=========================================="
echo "File: $DEM_FILE"
echo "Table: public.$TABLE_NAME"
echo "Tile size: $TILE_SIZE"
echo "=========================================="

# Extract database name from DATABASE_URL for psql command
DB_NAME=$(echo "$DATABASE_URL" | sed 's/.*\/\([^?]*\).*/\1/')

# Check if raster2pgsql is available
if ! command -v raster2pgsql &> /dev/null; then
    echo "Error: raster2pgsql not found"
    echo "Install PostGIS tools: apt-get install postgis"
    exit 1
fi

# Run the migration first (creates table structure)
echo ""
echo "Step 1: Running database migration..."
psql "$DATABASE_URL" -f "$(dirname "$0")/../drizzle/0004_dem_elevation.sql" || true

# Load the raster data
echo ""
echo "Step 2: Loading raster data..."
raster2pgsql \
    -s 4326 \
    -I \
    -C \
    -M \
    -t "$TILE_SIZE" \
    "$DEM_FILE" \
    "public.$TABLE_NAME" \
    | psql "$DATABASE_URL"

# Verify the load
echo ""
echo "Step 3: Verifying load..."
TILE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM $TABLE_NAME")
echo "Loaded $TILE_COUNT tiles"

# Show coverage
echo ""
echo "Step 4: DEM coverage:"
psql "$DATABASE_URL" -c "
SELECT
    ST_XMin(ST_Union(ST_ConvexHull(rast))) AS min_lon,
    ST_YMin(ST_Union(ST_ConvexHull(rast))) AS min_lat,
    ST_XMax(ST_Union(ST_ConvexHull(rast))) AS max_lon,
    ST_YMax(ST_Union(ST_ConvexHull(rast))) AS max_lat,
    COUNT(*) AS tile_count
FROM $TABLE_NAME;
"

echo ""
echo "=========================================="
echo "DEM loaded successfully!"
echo "=========================================="
echo ""
echo "Test elevation query:"
echo "  psql \"\$DATABASE_URL\" -c \"SELECT get_elevation(-73.5875, 45.5041);\""
echo ""
echo "Use in Python:"
echo "  from app.elevation_postgis import sample_elevation_from_postgis"
echo "  elevations = sample_elevation_from_postgis([(-73.5875, 45.5041)])"
echo ""