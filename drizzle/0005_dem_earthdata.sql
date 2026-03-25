-- ============================================================================
-- DEM Elevation Data Migration for NASA Earthdata ASTER GDEM
-- ============================================================================
-- 
-- This migration creates the database schema for storing and querying
-- ASTER Global Digital Elevation Model (GDEM) data from NASA Earthdata.
--
-- Prerequisites:
--   - PostgreSQL 14+
--   - PostGIS 3.3+ with raster support
--   - postgis_raster extension enabled
--
-- Usage:
--   psql $DATABASE_URL -f drizzle/0005_dem_earthdata.sql
--
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Ensure PostGIS raster extension is enabled
CREATE EXTENSION IF NOT EXISTS postgis_raster;

-- ============================================================================
-- TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- dem_granules: Metadata for imported ASTER GDEM granules
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dem_granules (
  id SERIAL PRIMARY KEY,
  
  -- NASA CMR identifiers
  granule_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  producer_granule_id TEXT,
  
  -- File information
  local_path TEXT,
  format TEXT DEFAULT 'GeoTIFF',
  file_size INTEGER,
  checksum TEXT,
  checksum_type TEXT,
  
  -- Spatial coverage (WGS84)
  min_lon DOUBLE PRECISION NOT NULL,
  min_lat DOUBLE PRECISION NOT NULL,
  max_lon DOUBLE PRECISION NOT NULL,
  max_lat DOUBLE PRECISION NOT NULL,
  coverage_geom GEOMETRY(Polygon, 4326),
  
  -- Elevation statistics
  min_elevation DOUBLE PRECISION,
  max_elevation DOUBLE PRECISION,
  tile_count INTEGER DEFAULT 0,
  
  -- Temporal extent
  temporal_start TIMESTAMP,
  temporal_end TIMESTAMP,
  
  -- Import status
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  
  -- Additional metadata
  metadata JSONB,
  
  -- Timestamps
  imported_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for dem_granules
CREATE INDEX IF NOT EXISTS dem_granules_granule_id_idx ON dem_granules(granule_id);
CREATE INDEX IF NOT EXISTS dem_granules_producer_id_idx ON dem_granules(producer_granule_id);
CREATE INDEX IF NOT EXISTS dem_granules_status_idx ON dem_granules(status);
CREATE INDEX IF NOT EXISTS dem_granules_coverage_idx ON dem_granules USING GIST(coverage_geom);
CREATE INDEX IF NOT EXISTS dem_granules_imported_at_idx ON dem_granules(imported_at);

-- ----------------------------------------------------------------------------
-- dem_elevation: Raster tiles for elevation data
-- ----------------------------------------------------------------------------

-- This table is populated by raster2pgsql
-- Each row represents a tile (typically 100x100 pixels)
CREATE TABLE IF NOT EXISTS dem_elevation (
  rid SERIAL PRIMARY KEY,
  rast RASTER NOT NULL,
  granule_id INTEGER REFERENCES dem_granules(id) ON DELETE CASCADE,
  imported_at TIMESTAMP DEFAULT NOW()
);

-- Create spatial index on raster column
CREATE INDEX IF NOT EXISTS dem_elevation_rast_idx ON dem_elevation USING GIST(ST_ConvexHull(rast));
CREATE INDEX IF NOT EXISTS dem_elevation_granule_id_idx ON dem_elevation(granule_id);
CREATE INDEX IF NOT EXISTS dem_elevation_imported_at_idx ON dem_elevation(imported_at);

-- Add raster constraints for data integrity
SELECT AddRasterConstraints('dem_elevation'::name, 'rast'::name);

-- ----------------------------------------------------------------------------
-- elevation_cache: Cache for frequently accessed elevation queries
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS elevation_cache (
  id SERIAL PRIMARY KEY,
  
  -- Query identification
  query_hash TEXT NOT NULL UNIQUE,
  query_type TEXT NOT NULL CHECK (query_type IN ('point', 'linestring', 'geofence')),
  input_geom TEXT NOT NULL,
  
  -- Cached result
  result JSONB NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS elevation_cache_query_hash_idx ON elevation_cache(query_hash);
CREATE INDEX IF NOT EXISTS elevation_cache_created_at_idx ON elevation_cache(created_at);

-- ============================================================================
-- SPATIAL FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- get_elevation(lon, lat): Get elevation at a single point
-- ----------------------------------------------------------------------------
-- Returns elevation in meters for a given WGS84 coordinate.
-- Returns NULL if no DEM data covers the point.

CREATE OR REPLACE FUNCTION get_elevation(
  lon DOUBLE PRECISION,
  lat DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
  elevation DOUBLE PRECISION;
BEGIN
  SELECT ST_Value(rast, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
  INTO elevation
  FROM dem_elevation
  WHERE ST_Intersects(rast, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
  LIMIT 1;
  
  RETURN elevation;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- get_elevations(points[]): Get elevations for multiple points
-- ----------------------------------------------------------------------------
-- Returns an array of elevations for the given array of WGS84 points.
-- Points without coverage will have NULL values.

CREATE OR REPLACE FUNCTION get_elevations(
  points GEOMETRY(Point, 4326)[]
) RETURNS DOUBLE PRECISION[] AS $$
DECLARE
  result DOUBLE PRECISION[];
  point GEOMETRY(Point, 4326);
  elevation DOUBLE PRECISION;
BEGIN
  result := '{}';
  
  FOREACH point IN ARRAY points LOOP
    SELECT ST_Value(rast, point)
    INTO elevation
    FROM dem_elevation
    WHERE ST_Intersects(rast, point)
    LIMIT 1;
    
    result := array_append(result, elevation);
  END LOOP;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- get_route_elevation(route, interval): Get elevation profile along a route
-- ----------------------------------------------------------------------------
-- Samples elevation at regular intervals along a LineString route.
-- Returns a table with distance along route and elevation at each point.

CREATE OR REPLACE FUNCTION get_route_elevation(
  route GEOMETRY(LineString, 4326),
  interval_m DOUBLE PRECISION DEFAULT 10.0
) RETURNS TABLE (
  distance_m DOUBLE PRECISION,
  elevation_m DOUBLE PRECISION,
  point GEOMETRY(Point, 4326)
) AS $$
DECLARE
  num_points INTEGER;
  i INTEGER;
BEGIN
  -- Calculate number of sample points
  num_points := CEIL(ST_Length(route::geography) / interval_m)::INTEGER + 1;
  
  FOR i IN 0..(num_points - 1) LOOP
    -- Calculate distance along route
    distance_m := i * interval_m;
    
    -- Get point at this distance
    point := ST_LineInterpolatePoint(route, i::DOUBLE PRECISION / (num_points - 1)::DOUBLE PRECISION);
    
    -- Get elevation at this point
    SELECT ST_Value(rast, point)
    INTO elevation_m
    FROM dem_elevation
    WHERE ST_Intersects(rast, point)
    LIMIT 1;
    
    RETURN NEXT;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- get_geofence_elevation_stats(geofence): Get elevation statistics within a geofence
-- ----------------------------------------------------------------------------
-- Returns min, max, avg elevation and coverage percentage for a polygon geofence.
-- The geofence should be in WGS84 (SRID 4326).

CREATE OR REPLACE FUNCTION get_geofence_elevation_stats(
  geofence GEOMETRY(Polygon, 4326)
) RETURNS TABLE (
  min_elevation DOUBLE PRECISION,
  max_elevation DOUBLE PRECISION,
  avg_elevation DOUBLE PRECISION,
  coverage_percent DOUBLE PRECISION,
  pixel_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    MIN(ST_SummaryStats(ST_Clip(rast, geofence)).min)::DOUBLE PRECISION AS min_elevation,
    MAX(ST_SummaryStats(ST_Clip(rast, geofence)).max)::DOUBLE PRECISION AS max_elevation,
    AVG(ST_SummaryStats(ST_Clip(rast, geofence)).mean)::DOUBLE PRECISION AS avg_elevation,
    (ST_Area(geofence::geography) / NULLIF(ST_Area(ST_Union(ST_ConvexHull(rast))::geography), 0) * 100.0)::DOUBLE PRECISION AS coverage_percent,
    SUM(ST_Count(rast))::BIGINT AS pixel_count
  FROM dem_elevation
  WHERE ST_Intersects(rast, geofence);
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- get_elevation_profile(route): Get detailed elevation profile for route optimization
-- ----------------------------------------------------------------------------
-- Returns elevation data optimized for fuel-aware routing calculations.
-- Includes distance, elevation, grade (slope), and cumulative ascent/descent.

CREATE OR REPLACE FUNCTION get_elevation_profile(
  route GEOMETRY(LineString, 4326),
  sample_interval_m DOUBLE PRECISION DEFAULT 10.0
) RETURNS TABLE (
  segment_id INTEGER,
  distance_from_start_m DOUBLE PRECISION,
  distance_segment_m DOUBLE PRECISION,
  elevation_start_m DOUBLE PRECISION,
  elevation_end_m DOUBLE PRECISION,
  grade_percent DOUBLE PRECISION,
  cumulative_ascent_m DOUBLE PRECISION,
  cumulative_descent_m DOUBLE PRECISION
) AS $$
DECLARE
  prev_elevation DOUBLE PRECISION := NULL;
  prev_distance DOUBLE PRECISION := 0.0;
  cum_ascent DOUBLE PRECISION := 0.0;
  cum_descent DOUBLE PRECISION := 0.0;
  rec RECORD;
  seg_id INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT * FROM get_route_elevation(route, sample_interval_m)
    ORDER BY distance_m
  LOOP
    seg_id := seg_id + 1;
    
    IF prev_elevation IS NOT NULL THEN
      -- Calculate grade (slope percentage)
      grade_percent := CASE 
        WHEN rec.distance_m - prev_distance > 0 
        THEN ((rec.elevation_m - prev_elevation) / (rec.distance_m - prev_distance)) * 100.0
        ELSE 0.0
      END;
      
      -- Update cumulative ascent/descent
      IF rec.elevation_m > prev_elevation THEN
        cum_ascent := cum_ascent + (rec.elevation_m - prev_elevation);
      ELSIF rec.elevation_m < prev_elevation THEN
        cum_descent := cum_descent + (prev_elevation - rec.elevation_m);
      END IF;
    ELSE
      grade_percent := 0.0;
    END IF;
    
    segment_id := seg_id;
    distance_from_start_m := rec.distance_m;
    distance_segment_m := rec.distance_m - prev_distance;
    elevation_start_m := prev_elevation;
    elevation_end_m := rec.elevation_m;
    cumulative_ascent_m := cum_ascent;
    cumulative_descent_m := cum_descent;
    
    RETURN NEXT;
    
    prev_elevation := rec.elevation_m;
    prev_distance := rec.distance_m;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- check_dem_coverage(bbox): Check if DEM data covers a bounding box
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_dem_coverage(
  min_lon DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lon DOUBLE PRECISION,
  max_lat DOUBLE PRECISION
) RETURNS TABLE (
  has_coverage BOOLEAN,
  coverage_percent DOUBLE PRECISION,
  tile_count BIGINT,
  granule_ids TEXT[]
) AS $$
DECLARE
  bbox GEOMETRY(Polygon, 4326);
BEGIN
  bbox := ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326);
  
  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1 FROM dem_elevation WHERE ST_Intersects(rast, bbox)
    ) AS has_coverage,
    COALESCE(
      (ST_Area(ST_Intersection(ST_Union(ST_ConvexHull(rast)), bbox)::geography) / 
       NULLIF(ST_Area(bbox::geography), 0) * 100.0),
      0.0
    )::DOUBLE PRECISION AS coverage_percent,
    COUNT(*)::BIGINT AS tile_count,
    array_agg(DISTINCT g.granule_id)::TEXT[] AS granule_ids
  FROM dem_elevation e
  LEFT JOIN dem_granules g ON e.granule_id = g.id
  WHERE ST_Intersects(e.rast, bbox);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp on dem_granules
CREATE OR REPLACE FUNCTION update_dem_granules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dem_granules_updated_at
  BEFORE UPDATE ON dem_granules
  FOR EACH ROW
  EXECUTE FUNCTION update_dem_granules_updated_at();

-- ============================================================================
-- CLEANUP FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- cleanup_old_cache_entries(): Remove expired cache entries
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cleanup_old_cache_entries(
  days_old INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM elevation_cache
  WHERE created_at < NOW() - (days_old || ' days')::INTERVAL
     OR expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- cleanup_old_dem_files(): Remove DEM files older than specified days
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cleanup_old_dem_files(
  days_old INTEGER DEFAULT 365
) RETURNS TABLE (
  granule_id TEXT,
  local_path TEXT,
  deleted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  UPDATE dem_granules
  SET 
    local_path = NULL,
    status = 'archived'
  WHERE imported_at < NOW() - (days_old || ' days')::INTERVAL
    AND local_path IS NOT NULL
  RETURNING 
    dem_granules.granule_id,
    dem_granules.local_path,
    TRUE AS deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANT PERMISSIONS (adjust as needed for your setup)
-- ============================================================================

-- Grant permissions to application user
-- Replace 'app_user' with your actual database user

-- GRANT SELECT, INSERT, UPDATE, DELETE ON dem_granules TO app_user;
-- GRANT SELECT, INSERT ON dem_elevation TO app_user;
-- GRANT SELECT, INSERT, DELETE ON elevation_cache TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE dem_granules IS 'Metadata for imported ASTER GDEM granules from NASA Earthdata';
COMMENT ON TABLE dem_elevation IS 'Raster tiles containing elevation data from ASTER GDEM';
COMMENT ON TABLE elevation_cache IS 'Cache for frequently accessed elevation query results';

COMMENT ON FUNCTION get_elevation IS 'Get elevation in meters at a single WGS84 coordinate';
COMMENT ON FUNCTION get_elevations IS 'Get elevations for multiple WGS84 points';
COMMENT ON FUNCTION get_route_elevation IS 'Sample elevation along a LineString route at regular intervals';
COMMENT ON FUNCTION get_geofence_elevation_stats IS 'Get elevation statistics within a polygon geofence';
COMMENT ON FUNCTION get_elevation_profile IS 'Get detailed elevation profile for fuel-aware routing';
COMMENT ON FUNCTION check_dem_coverage IS 'Check if DEM data covers a bounding box';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Insert migration record (if using migration tracking)
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES (
  '0005_dem_earthdata',
  NOW()
) ON CONFLICT DO NOTHING;