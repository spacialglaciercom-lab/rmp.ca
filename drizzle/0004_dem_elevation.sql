-- ============================================================================
-- PostGIS Raster Extension for DEM Elevation Data
-- ============================================================================
-- This migration enables PostGIS raster support and creates the infrastructure
-- for storing Digital Elevation Model (DEM) data directly in the database.
--
-- To load DEM data, run on the FreeBSD server:
--   raster2pgsql -s 4326 -I -C -M -t 100x100 n45_w074_1arc_v3.tif public.dem_elevation | psql -U postgres -d routemaster
--
-- Benefits:
--   - Single source of truth for elevation data
--   - Spatial indexing for fast queries (milliseconds vs file I/O)
--   - Batch elevation queries for entire routes
--   - Automatic intersection with road network nodes
-- ============================================================================

-- Enable PostGIS raster extension (requires PostGIS 3+)
CREATE EXTENSION IF NOT EXISTS postgis_raster;

-- Create DEM elevation table (populated by raster2pgsql)
-- The table structure is created automatically by raster2pgsql:
--   - rast (raster type) - the tiled DEM data
--   - rid (serial PK) - tile identifier
--
-- We add metadata columns for tracking:
CREATE TABLE IF NOT EXISTS dem_elevation (
    rid serial PRIMARY KEY,
    rast raster,
    source_file text,
    imported_at timestamp default now()
);

-- Create spatial index on the raster column (critical for performance)
-- This is also created by raster2pgsql -I flag, but included here for completeness
CREATE INDEX IF NOT EXISTS idx_dem_elevation_rast ON dem_elevation USING gist (ST_ConvexHull(rast));

-- Add constraint to ensure WGS84 (EPSG:4326)
ALTER TABLE dem_elevation DROP CONSTRAINT IF EXISTS enforce_srid_rast;
ALTER TABLE dem_elevation ADD CONSTRAINT enforce_srid_rast CHECK (ST_SRID(rast) = 4326);

-- ============================================================================
-- Helper function: Get elevation for a single point
-- ============================================================================
-- Usage: SELECT get_elevation(-73.5875, 45.5041);
-- Returns: elevation in meters (float), or NULL if out of extent
CREATE OR REPLACE FUNCTION get_elevation(lon float, lat float)
RETURNS float AS $$
BEGIN
    RETURN (
        SELECT ST_Value(rast, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
        FROM dem_elevation
        WHERE ST_Intersects(rast, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
        LIMIT 1
    );
END;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- Helper function: Batch elevation for multiple points
-- ============================================================================
-- Usage: SELECT * FROM get_elevations(ARRAY[(-73.5875, 45.5041), (-73.58, 45.50)]);
-- Returns: table with index, lon, lat, elevation
CREATE OR REPLACE FUNCTION get_elevations(points geometry[])
RETURNS TABLE (idx int, lon float, lat float, elevation float) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.idx,
        ST_X(t.pt)::float AS lon,
        ST_Y(t.pt)::float AS lat,
        ST_Value(d.rast, t.pt)::float AS elevation
    FROM unnest(points) WITH ORDINALITY AS t(pt, idx)
    LEFT JOIN LATERAL (
        SELECT rast
        FROM dem_elevation
        WHERE ST_Intersects(rast, t.pt)
        LIMIT 1
    ) d ON true;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Helper function: Get elevation profile for a route (LineString)
-- ============================================================================
-- Usage: SELECT * FROM get_route_elevation(ST_GeomFromText('LINESTRING(-73.58 45.50, -73.57 45.51)', 4326), 100);
-- Parameters:
--   - route_line: the route geometry
--   - sample_interval_m: distance between elevation samples (default 10m)
-- Returns: table with distance_along (meters) and elevation (meters)
CREATE OR REPLACE FUNCTION get_route_elevation(route_line geometry, sample_interval_m float DEFAULT 10.0)
RETURNS TABLE (distance_along float, elevation float) AS $$
DECLARE
    total_length float;
    num_samples int;
BEGIN
    total_length := ST_Length(route_line::geography);
    num_samples := CEIL(total_length / sample_interval_m)::int + 1;
    
    RETURN QUERY
    SELECT
        (t.idx * sample_interval_m)::float AS distance_along,
        ST_Value(d.rast, ST_LineInterpolatePoint(route_line, t.idx::float / num_samples))::float AS elevation
    FROM generate_series(0, num_samples) AS t(idx)
    LEFT JOIN LATERAL (
        SELECT rast
        FROM dem_elevation
        WHERE ST_Intersects(rast, ST_LineInterpolatePoint(route_line, t.idx::float / num_samples))
        LIMIT 1
    ) d ON true;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- View: DEM coverage and statistics
-- ============================================================================
CREATE OR REPLACE VIEW dem_coverage AS
SELECT
    ST_Union(ST_ConvexHull(rast))::geometry AS coverage_geom,
    ST_SRID(rast) AS srid,
    COUNT(*) AS tile_count,
    MIN(ST_Width(rast) * ST_Height(rast)) AS min_tile_pixels,
    MAX(ST_Width(rast) * ST_Height(rast)) AS max_tile_pixels
FROM dem_elevation;

-- ============================================================================
-- Function: Check if DEM is available for a region
-- ============================================================================
CREATE OR REPLACE FUNCTION dem_is_available(test_lon float, test_lat float)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM dem_elevation
        WHERE ST_Intersects(rast, ST_SetSRID(ST_MakePoint(test_lon, test_lat), 4326))
        LIMIT 1
    );
END;
$$ LANGUAGE sql STABLE;

-- Grant permissions (adjust as needed for your setup)
GRANT SELECT ON dem_elevation TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_elevation(float, float) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_elevations(geometry[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_route_elevation(geometry, float) TO PUBLIC;
GRANT EXECUTE ON FUNCTION dem_is_available(float, float) TO PUBLIC;