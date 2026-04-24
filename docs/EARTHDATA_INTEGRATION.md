# NASA Earthdata ASTER GDEM Integration

This document describes the integration of NASA's ASTER Global Digital Elevation Model (GDEM) data into RouteMaster Pro for fuel-aware routing and elevation-aware optimization.

## Overview

**ASTER GDEM** is a global digital elevation model with 30-meter spatial resolution, providing elevation data for fuel consumption calculations, route optimization, and terrain analysis.

### Key Features

- **Automated Data Fetching**: Fetches ASTER GDEM tiles from NASA Earthdata using authenticated API
- **PostGIS Raster Storage**: Efficient storage and spatial indexing of elevation tiles
- **Spatial Query Functions**: Optimized queries for point, route, and geofence elevation data
- **Fuel Consumption Modeling**: Elevation-aware fuel calculation for route optimization
- **Resilient API Client**: Handles authentication, rate limiting, and retries

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     RouteMaster Pro                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐      ┌──────────────────────────────┐   │
│  │ EarthdataService │──────│ NASA CMR API                 │   │
│  │                  │     │ (search granules)            │   │
│  │ - Search         │      └──────────────────────────────┘   │
│  │ - Download       │                                       │
│  │ - Process        │      ┌──────────────────────────────┐   │
│  └──────────────────┘──────│ NASA Earthdata Cloud         │   │
│                           │ (download GeoTIFF)           │   │
│                           └──────────────────────────────┘   │
│                                    │                            │
│                                    ▼                            │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              PostGIS Database (Raster Storage)           │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  dem_granules        │ Metadata for imported tiles       │ │
│  │  dem_elevation       │ Raster tiles (100x100 pixels)     │ │
│  │  elevation_cache     │ Query result cache                │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                    │                            │
│                                    ▼                            │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              Spatial Query Functions                     │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  get_elevation(lon, lat)              │ Point query      │ │
│  │  get_elevations(points[])             │ Batch query      │ │
│  │  get_route_elevation(route, interval) │ Route profile    │ │
│  │  get_geofence_elevation_stats(polygon)│ Geofence stats   │ │
│  │  get_elevation_profile(route)         │ Fuel-aware       │ │
│  │  check_dem_coverage(bbox)             │ Coverage check   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. NASA Earthdata Account

1. Create an account at [https://urs.earthdata.nasa.gov/](https://urs.earthdata.nasa.gov/)
2. Generate a Bearer token from your profile settings
3. Add the token to your `.env` file:

```bash
EARTHDATA_BEARER_TOKEN=eyJ0eXAiOiJKV1QiLCJvcmlnaW4iOiJFYXJ0aGRhdGEgTG9naW4i...
```

### 2. Database Migration

Run the migration to create the DEM tables and spatial functions:

```bash
psql $DATABASE_URL -f drizzle/0005_dem_earthdata.sql
```

### 3. Verify Token

Test your token is working:

```bash
curl -i -H "Authorization: Bearer $EARTHDATA_BEARER_TOKEN" \
  "https://cmr.earthdata.nasa.gov/search/granules.json?short_name=ASTGTM&version=003&page_size=1"
```

Expected response: `HTTP/2 200` with JSON metadata

## Usage

### Fetch DEM Data

#### By Bounding Box

Fetch all ASTER GDEM tiles covering a specific area:

```bash
# Montreal area
pnpm run fetch-dem --bbox="-73.9,45.4,-73.5,45.7"

# Quebec City region
pnpm run fetch-dem --bbox="-71.3,46.7,-71.1,46.9" --max-granules=5
```

#### By Granule ID

Fetch a specific tile:

```bash
# Montreal tile (N45W074)
pnpm run fetch-dem --granule="ASTGTMV003_N45W074"

# Quebec City tile (N46W071)
pnpm run fetch-dem --granule="ASTGTMV003_N46W071"
```

#### Dry Run

Preview what would be downloaded:

```bash
pnpm run fetch-dem --bbox="-73.9,45.4,-73.5,45.7" --dry-run --verbose
```

### Query Elevation Data

#### Point Elevation

```typescript
import { getElevationAtPoint } from "./services/elevationQueries";

const result = await getElevationAtPoint({
  lon: -73.5875,
  lat: 45.5041,
});

console.log(`Elevation: ${result.elevation}m`);
```

#### Route Elevation Profile

```typescript
import { getRouteElevationProfileCached } from "./services/elevationQueries";

const route = [
  [-73.5673, 45.5017], // Montreal
  [-73.5, 45.6],
  [-73.3, 45.8],
  [-71.2, 46.8], // Quebec City
];

const profile = await getRouteElevationProfileCached(route, 50); // 50m intervals

console.log(`Distance: ${profile.distanceKm} km`);
console.log(`Total Ascent: ${profile.totalAscent} m`);
console.log(`Total Descent: ${profile.totalDescent} m`);
console.log(`Elevation Range: ${profile.minElevation}m - ${profile.maxElevation}m`);
```

#### Geofence Elevation Stats

```typescript
import { getElevationInGeofence } from "./services/elevationQueries";

// 10-meter radius geofence around a point
const stats = await getElevationInGeofence(
  { lon: -73.5875, lat: 45.5041 },
  10 // 10 meter radius
);

console.log(`Min: ${stats.minElevation}m`);
console.log(`Max: ${stats.maxElevation}m`);
console.log(`Avg: ${stats.avgElevation}m`);
```

#### Fuel Consumption Calculation

```typescript
import { 
  getRouteElevationProfileCached, 
  calculateFuelConsumptionFactor 
} from "./services/elevationQueries";

const profile = await getRouteElevationProfileCached(route);
const fuel = calculateFuelConsumptionFactor(profile, 0.35); // 0.35 L/km base

console.log(`Total Fuel: ${fuel.totalFuelL.toFixed(2)} L`);
console.log(`Avg Consumption: ${fuel.avgConsumptionLPerKm.toFixed(3)} L/km`);
console.log(`Elevation Penalty: ${fuel.elevationPenaltyL.toFixed(2)} L`);
console.log(`Elevation Benefit: ${fuel.elevationBenefitL.toFixed(2)} L`);
```

### Raw SQL Queries

#### Point Elevation

```sql
SELECT get_elevation(-73.5875, 45.5041) AS elevation_m;
```

#### Route Elevation Profile

```sql
SELECT * FROM get_route_elevation(
  ST_SetSRID(ST_GeomFromText('LINESTRING(-73.5673 45.5017, -71.2 46.8)'), 4326),
  50.0  -- 50 meter intervals
);
```

#### Geofence Statistics

```sql
SELECT * FROM get_geofence_elevation_stats(
  ST_Buffer(
    ST_SetSRID(ST_MakePoint(-73.5875, 45.5041), 4326)::geography,
    10  -- 10 meter radius
  )::geometry
);
```

#### Check Coverage

```sql
SELECT * FROM check_dem_coverage(-73.9, 45.4, -73.5, 45.7);
```

## API Reference

### EarthdataService

Main service class for NASA Earthdata API integration.

#### Constructor

```typescript
const service = new EarthdataService({
  bearerToken: string,           // NASA Earthdata Bearer token
  cmrBaseUrl?: string,           // Default: https://cmr.earthdata.nasa.gov
  downloadDir?: string,          // Default: /tmp/earthdata
  maxConcurrentDownloads?: number, // Default: 3
  requestTimeout?: number,       // Default: 30000ms
  maxRetries?: number,           // Default: 5
  baseRetryDelay?: number,       // Default: 1000ms
});
```

#### Methods

##### `searchAsterGdem(bbox, options?)`

Search for ASTER GDEM granules intersecting a bounding box.

```typescript
const granules = await service.searchAsterGdem(
  {
    minLon: -73.9,
    minLat: 45.4,
    maxLon: -73.5,
    maxLat: 45.7,
  },
  {
    maxResults: 10,
    temporalStart: "2020-01-01",
    temporalEnd: "2024-12-31",
  }
);
```

##### `downloadGranule(granule, options?)`

Download a granule's data file.

```typescript
const result = await service.downloadGranule(granule, {
  preferredFormat: "GeoTIFF",
  onProgress: ({ downloaded, total }) => {
    console.log(`${((downloaded / total) * 100).toFixed(1)}%`);
  },
});
```

##### `processAndLoadToPostgis(downloadResult, options?)`

Process downloaded granule and load into PostGIS.

```typescript
const result = await service.processAndLoadToPostgis(downloadResult, {
  tableName: "dem_elevation",
  tileSize: "100x100",
  overwrite: false,
});
```

##### `fetchAndLoadDem(bbox, options?)`

Full pipeline: search, download, and load into PostGIS.

```typescript
const results = await service.fetchAndLoadDem(
  { minLon: -73.9, minLat: 45.4, maxLon: -73.5, maxLat: 45.7 },
  {
    maxGranules: 5,
    onProgress: (phase, detail) => {
      console.log(`[${phase}] ${detail}`);
    },
  }
);
```

### Error Classes

#### `EarthdataAuthError`

Authentication failed (HTTP 401/403).

```typescript
try {
  await service.searchAsterGdem(bbox);
} catch (error) {
  if (error instanceof EarthdataAuthError) {
    console.error("Token expired or invalid");
  }
}
```

#### `EarthdataRateLimitError`

Rate limited (HTTP 429).

```typescript
catch (error) {
  if (error instanceof EarthdataRateLimitError) {
    console.error(`Rate limited. Retry after ${error.retryAfter}s`);
  }
}
```

#### `EarthdataNetworkError`

Network or HTTP error.

```typescript
catch (error) {
  if (error instanceof EarthdataNetworkError) {
    console.error("Network error:", error.message);
  }
}
```

#### `EarthdataProcessingError`

Data processing error.

```typescript
catch (error) {
  if (error instanceof EarthdataProcessingError) {
    console.error("Processing failed for granule:", error.granuleId);
  }
}
```

## Database Schema

### `dem_granules`

Metadata for imported ASTER GDEM granules.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `granule_id` | TEXT | NASA CMR Granule ID |
| `title` | TEXT | Granule title |
| `producer_granule_id` | TEXT | Producer granule ID |
| `local_path` | TEXT | Local file path |
| `format` | TEXT | File format (GeoTIFF) |
| `file_size` | INTEGER | File size in bytes |
| `min_lon`, `min_lat`, `max_lon`, `max_lat` | DOUBLE PRECISION | Bounding box |
| `coverage_geom` | GEOMETRY(Polygon, 4326) | Coverage polygon |
| `min_elevation` | DOUBLE PRECISION | Minimum elevation (m) |
| `max_elevation` | DOUBLE PRECISION | Maximum elevation (m) |
| `tile_count` | INTEGER | Number of raster tiles |
| `status` | TEXT | Import status (pending/processing/completed/failed) |
| `imported_at` | TIMESTAMP | Import timestamp |

### `dem_elevation`

Raster tiles for elevation data.

| Column | Type | Description |
|--------|------|-------------|
| `rid` | SERIAL | Primary key |
| `rast` | RASTER | Raster tile data |
| `granule_id` | INTEGER | Foreign key to dem_granules |
| `imported_at` | TIMESTAMP | Import timestamp |

### `elevation_cache`

Cache for frequently accessed elevation queries.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Primary key |
| `query_hash` | TEXT | SHA-256 hash of query |
| `query_type` | TEXT | Query type (point/linestring/geofence) |
| `input_geom` | TEXT | Input geometry as WKT |
| `result` | JSONB | Cached result |
| `created_at` | TIMESTAMP | Creation timestamp |
| `expires_at` | TIMESTAMP | Expiration timestamp |

## Spatial Functions

### `get_elevation(lon, lat)`

Get elevation at a single point.

**Parameters:**
- `lon` (DOUBLE PRECISION): Longitude in WGS84
- `lat` (DOUBLE PRECISION): Latitude in WGS84

**Returns:** DOUBLE PRECISION (elevation in meters, or NULL if no coverage)

### `get_elevations(points[])`

Get elevations for multiple points.

**Parameters:**
- `points` (GEOMETRY(Point, 4326)[]): Array of points

**Returns:** DOUBLE PRECISION[] (array of elevations)

### `get_route_elevation(route, interval)`

Sample elevation along a route.

**Parameters:**
- `route` (GEOMETRY(LineString, 4326)): Route geometry
- `interval` (DOUBLE PRECISION): Sample interval in meters

**Returns:** TABLE (distance_m, elevation_m, point)

### `get_geofence_elevation_stats(geofence)`

Get elevation statistics within a geofence.

**Parameters:**
- `geofence` (GEOMETRY(Polygon, 4326)): Geofence polygon

**Returns:** TABLE (min_elevation, max_elevation, avg_elevation, coverage_percent, pixel_count)

### `get_elevation_profile(route, interval)`

Get detailed elevation profile for fuel-aware routing.

**Parameters:**
- `route` (GEOMETRY(LineString, 4326)): Route geometry
- `interval` (DOUBLE PRECISION): Sample interval in meters

**Returns:** TABLE (segment_id, distance_from_start_m, distance_segment_m, elevation_start_m, elevation_end_m, grade_percent, cumulative_ascent_m, cumulative_descent_m)

### `check_dem_coverage(min_lon, min_lat, max_lon, max_lat)`

Check if DEM data covers a bounding box.

**Parameters:**
- `min_lon`, `min_lat`, `max_lon`, `max_lat` (DOUBLE PRECISION): Bounding box

**Returns:** TABLE (has_coverage, coverage_percent, tile_count, granule_ids)

## Performance Considerations

### Raster Tile Size

Default tile size is **100x100 pixels**, which provides:
- Fast spatial queries (smaller tiles = faster intersection tests)
- Efficient storage (better compression)
- Good balance between tile count and query performance

Adjust with `--tile-size` flag:
```bash
pnpm run fetch-dem --bbox="..." --tile-size="50x50"   # More tiles, faster queries
pnpm run fetch-dem --bbox="..." --tile-size="200x200" # Fewer tiles, slower queries
```

### Spatial Indexing

All raster tiles are automatically indexed using:
- **GIST index** on `ST_ConvexHull(rast)` for fast intersection queries
- **BRIN index** on imported granules for time-based queries

### Query Caching

Frequently accessed queries are cached in `elevation_cache` table:
- Cache entries expire after 7 days
- Use `getRouteElevationProfileCached()` for automatic caching
- Clear cache with `clearExpiredCache()` or `clearAllCache()`

## Troubleshooting

### Token Authentication Failed

**Error:** `EarthdataAuthError: HTTP 401 Unauthorized`

**Solutions:**
1. Verify token is not expired (check `exp` claim in JWT)
2. Generate new token at https://urs.earthdata.nasa.gov/
3. Wait a few minutes after generating new token (propagation delay)

### Rate Limiting

**Error:** `EarthdataRateLimitError: HTTP 429 Too Many Requests`

**Solutions:**
1. Service automatically retries with exponential backoff
2. Reduce `maxConcurrentDownloads` in config
3. Wait for `retryAfter` seconds before retrying

### No Coverage Found

**Error:** Query returns NULL or empty results

**Solutions:**
1. Check coverage with `check_dem_coverage()`
2. Fetch DEM data for the area: `pnpm run fetch-dem --bbox="..."`
3. Verify granules imported successfully: `SELECT * FROM dem_granules WHERE status = 'completed'`

### GDAL/raster2pgsql Not Found

**Error:** `Command failed: raster2pgsql: command not found`

**Solutions:**
1. Install GDAL: `apt-get install gdal-bin` (Ubuntu/Debian)
2. Install PostGIS tools: `apt-get install postgis`
3. Verify installation: `raster2pgsql --version`

## References

- [NASA Earthdata](https://earthdata.nasa.gov/)
- [ASTER GDEM Documentation](https://lpdaac.usgs.gov/products/astgtmv003/)
- [CMR API Documentation](https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html)
- [PostGIS Raster Reference](https://postgis.net/docs/using_raster_dataman.html)
- [GDAL raster2pgsql](https://postgis.net/docs/using_raster_dataman.html#RT_Loading_Rasters)

## License

ASTER GDEM data is provided by NASA and METI under the terms of use available at:
https://earthdata.nasa.gov/earth-observation-data/near-real-time/download-nrt-data

This integration module is part of RouteMaster Pro and is subject to the project's license.