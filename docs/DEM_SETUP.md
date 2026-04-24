# DEM Elevation Data Setup

This document explains how to set up Digital Elevation Model (DEM) data for fuel-aware routing in Route Master Pro.

## Overview

The routing system can use elevation data to calculate fuel costs based on road grade (uphill/downhill). This is implemented via the `FuelAwarePlugin` which samples elevation at each graph node.

## Two Storage Options

### Option 1: PostGIS Raster (Recommended)

Store DEM data directly in PostgreSQL/PostGIS for:
- Single source of truth for road network and terrain
- Spatial indexing for fast queries (milliseconds)
- Batch elevation queries for entire routes
- No file I/O or DEM_PATH configuration needed

**Setup:**

1. Enable the PostGIS raster extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis_raster;
   ```

2. Run the migration:
   ```bash
   psql $DATABASE_URL -f drizzle/0004_dem_elevation.sql
   ```

3. Load your DEM GeoTIFF:
   ```bash
   # Download SRTM/ASTER DEM for your area (must be EPSG:4326)
   # Example: Montreal area (45°N, 74°W)
   
   ./scripts/load-dem-to-postgis.sh n45_w074_1arc_v3.tif
   ```

4. Verify the load:
   ```sql
   -- Check tile count
   SELECT COUNT(*) FROM dem_elevation;
   
   -- Test elevation query (Mount Royal, Montreal)
   SELECT get_elevation(-73.5875, 45.5041);
   
   -- Check coverage
   SELECT * FROM dem_coverage;
   ```

### Option 2: File-Based DEM (Fallback)

Store DEM as a GeoTIFF file and configure via environment variable.

**Setup:**

1. Download SRTM/ASTER DEM data:
   - NASA EarthData: https://earthdata.nasa.gov
   - USGS Earth Explorer: https://earthexplorer.usgs.gov
   - CGIAR SRTM: https://srtm.csi.cgiar.org

2. Ensure the GeoTIFF is in WGS84 (EPSG:4326) projection.

3. Set the environment variable:
   ```bash
   export DEM_PATH=/path/to/your/dem.tif
   ```

4. For Docker, add to `docker-compose.optimizer.yml`:
   ```yaml
   environment:
     - DEM_PATH=${DEM_PATH:-}
   volumes:
     - /path/to/dem:/data/dem:ro
   ```

## How It Works

### Fuel-Aware Routing

The `FuelAwarePlugin` calculates a cost multiplier based on road grade:

```
grade_percent = ((elev_B - elev_A) / distance_m) * 100

if grade >= 0:
    multiplier = 1.0 + (grade * 0.1)   # Uphill: +10% per 1% grade
else:
    multiplier = 1.0 + (grade * 0.04)  # Downhill: +4% per -1% grade

multiplier = max(0.5, multiplier)       # Clamp to prevent negative costs
```

### Plugin Selection

The `create_fuel_aware_plugin()` factory automatically selects the best available:

1. **PostGIS DEM** (preferred): If `DATABASE_URL` is set and `dem_elevation` table has data
2. **File-based DEM**: If `DEM_PATH` is set and file exists
3. **Error**: If neither is available

### Python API

```python
from app.routing_plugins import create_fuel_aware_plugin

# Automatic selection (PostGIS preferred)
plugin = create_fuel_aware_plugin()

# Explicit PostGIS
from app.routing_plugins import FuelAwarePostGISPlugin
plugin = FuelAwarePostGISPlugin(database_url="postgresql://...")

# Explicit file-based
from app.routing_plugins import FuelAwarePlugin
plugin = FuelAwarePlugin(dem_path="/path/to/dem.tif")
```

### SQL API

```sql
-- Single point elevation
SELECT get_elevation(-73.5875, 45.5041);

-- Batch elevations for a route
SELECT * FROM get_elevations(ARRAY[
    ST_SetSRID(ST_MakePoint(-73.5875, 45.5041), 4326),
    ST_SetSRID(ST_MakePoint(-73.58, 45.50), 4326)
]);

-- Elevation profile along a route
SELECT * FROM get_route_elevation(
    ST_GeomFromText('LINESTRING(-73.58 45.50, -73.57 45.51)', 4326),
    100.0  -- sample every 100 meters
);

-- Check if DEM covers a location
SELECT dem_is_available(-73.5875, 45.5041);
```

## Data Sources

### SRTM (Shuttle Radar Topography Mission)

- Resolution: 1 arc-second (~30m at equator)
- Coverage: 56°S to 60°N
- Download: https://earthdata.nasa.gov

### ASTER GDEM

- Resolution: 1 arc-second (~30m)
- Coverage: Global
- Download: https://earthexplorer.usgs.gov

### File Naming Convention

SRTM files follow the naming pattern:
```
[N|S]YY_EEEE_1arc_v3.tif

Where:
- N|S: North or South latitude
- YY: Latitude (e.g., 45 for 45°N)
- E|W: East or West longitude
- EEE: Longitude (e.g., 074 for 74°W)

Example: n45_w074_1arc_v3.tif (Montreal area)
```

## Performance

### PostGIS Raster

- Single point query: ~1-5ms (with spatial index)
- Batch query (100 points): ~10-20ms
- Route profile (1000 samples): ~50-100ms

### File-Based

- Single point query: ~50-100ms (file I/O overhead)
- Batch query: Same as single (rasterio samples all at once)

## Troubleshooting

### "DEM must be WGS84 (EPSG:4326)"

The GeoTIFF must be in WGS84 projection. Reproject with GDAL:

```bash
gdalwarp -t_srs EPSG:4326 input.tif output_wgs84.tif
```

### "rasterio is required"

Install the rasterio library:

```bash
pip install rasterio
```

### "psycopg2 is required"

Install psycopg2 for PostGIS support:

```bash
pip install psycopg2-binary
```

### "DEM data not found in PostGIS"

1. Verify the table exists:
   ```sql
   SELECT COUNT(*) FROM dem_elevation;
   ```

2. If empty, load the data:
   ```bash
   ./scripts/load-dem-to-postgis.sh /path/to/dem.tif
   ```

3. Check spatial index:
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename = 'dem_elevation';
   ```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Route Optimization                       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Fuel-Aware Plugin Factory               │    │
│  │                                                      │    │
│  │   1. Try PostGIS (DATABASE_URL + dem_elevation)      │    │
│  │   2. Fall back to file (DEM_PATH + rasterio)        │    │
│  │   3. Raise error if neither available               │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│           ┌───────────────┴───────────────┐                │
│           ▼                               ▼                │
│  ┌─────────────────────┐      ┌─────────────────────┐      │
│  │ FuelAwarePostGIS    │      │   FuelAwarePlugin    │      │
│  │                     │      │   (file-based)       │      │
│  │ • psycopg2          │      │   • rasterio         │      │
│  │ • ST_Value()        │      │   • dataset.sample() │      │
│  │ • Spatial index     │      │   • File I/O         │      │
│  └─────────────────────┘      └─────────────────────┘      │
│           │                               │                │
│           ▼                               ▼                │
│  ┌─────────────────────┐      ┌─────────────────────┐      │
│  │   PostgreSQL/       │      │   GeoTIFF File       │      │
│  │   PostGIS Raster    │      │   (DEM_PATH)         │      │
│  │   (dem_elevation)   │      │                      │      │
│  └─────────────────────┘      └─────────────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Related Files

- `drizzle/0004_dem_elevation.sql` - Database migration for DEM table
- `backend/app/routing_plugins.py` - Fuel-aware routing plugins
- `backend/app/elevation_postgis.py` - PostGIS elevation sampling
- `scripts/load-dem-to-postgis.sh` - DEM loading script
- `lib/elevationEnrichment.ts` - Frontend elevation enrichment