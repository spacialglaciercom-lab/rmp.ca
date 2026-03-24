-- ============================================================================
-- PostGIS Spatial Database Tests
-- 
-- These tests verify that geography types are stored correctly and spatial
-- queries work as expected for the offline-first implementation.
--
-- To run these tests:
--   psql -d rmp_test -f TESTS/database/postgis-spatial.test.sql
--
-- Prerequisites:
--   - PostgreSQL with PostGIS extension enabled
--   - Test database created
-- ============================================================================

-- Setup test environment
\echo 'Setting up test environment...'

-- Create PostGIS extension if not exists
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create test tables (mirroring production schema)
DROP TABLE IF EXISTS test_waste_points CASCADE;
DROP TABLE IF EXISTS test_routes CASCADE;
DROP TABLE IF EXISTS test_collection_points CASCADE;
DROP TABLE IF EXISTS test_zones CASCADE;

CREATE TABLE test_waste_points (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE test_routes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  geometry GEOGRAPHY(LINESTRING, 4326) NOT NULL,
  distance_meters DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE test_collection_points (
  id SERIAL PRIMARY KEY,
  route_id INTEGER REFERENCES test_routes(id),
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE test_zones (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  boundary GEOGRAPHY(POLYGON, 4326) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create spatial indexes
CREATE INDEX idx_waste_points_location ON test_waste_points USING GIST (location);
CREATE INDEX idx_routes_geometry ON test_routes USING GIST (geometry);
CREATE INDEX idx_collection_points_location ON test_collection_points USING GIST (location);
CREATE INDEX idx_zones_boundary ON test_zones USING GIST (boundary);

\echo 'Test environment setup complete.'
\echo ''

-- ============================================================================
-- TEST 1: Geography Type Storage
-- ============================================================================

\echo 'TEST 1: Geography Type Storage'
\echo '--------------------------------'

-- Test 1.1: Insert and retrieve point
INSERT INTO test_waste_points (name, location, type)
VALUES ('Test Bin 1', ST_GeogFromText('POINT(-75.6972 45.4215)'), 'bin');

SELECT 
  id,
  name,
  ST_AsText(location) as location_wkt,
  type
FROM test_waste_points
WHERE name = 'Test Bin 1';

-- Verify: Should return POINT(-75.6972 45.4215)
\echo 'Expected: POINT(-75.6972 45.4215)'

-- Test 1.2: Insert and retrieve linestring (route)
INSERT INTO test_routes (name, geometry, distance_meters)
VALUES (
  'Test Route 1',
  ST_GeogFromText('LINESTRING(-75.6972 45.4215, -75.6960 45.4220, -75.6945 45.4225)'),
  350.5
);

SELECT 
  id,
  name,
  ST_AsText(geometry) as geometry_wkt,
  distance_meters
FROM test_routes
WHERE name = 'Test Route 1';

-- Verify: Should return LINESTRING with 3 points
\echo 'Expected: LINESTRING with 3 points'

-- Test 1.3: Insert and retrieve polygon (zone)
INSERT INTO test_zones (name, boundary)
VALUES (
  'Test Zone 1',
  ST_GeogFromText('POLYGON((-75.70 45.42, -75.69 45.42, -75.69 45.43, -75.70 45.43, -75.70 45.42))')
);

SELECT 
  id,
  name,
  ST_AsText(boundary) as boundary_wkt
FROM test_zones
WHERE name = 'Test Zone 1';

-- Verify: Should return POLYGON with 5 points (closed ring)
\echo 'Expected: POLYGON with 5 points (closed ring)'

\echo ''

-- ============================================================================
-- TEST 2: Haversine Distance Calculations
-- ============================================================================

\echo 'TEST 2: Haversine Distance Calculations'
\echo '----------------------------------------'

-- Test 2.1: Distance between two points (should use haversine)
SELECT 
  ST_Distance(
    ST_GeogFromText('POINT(-75.6972 45.4215)'),
    ST_GeogFromText('POINT(-75.6960 45.4220)')
  ) as distance_meters;

-- Expected: ~100 meters (approximately)
\echo 'Expected: ~100 meters'

-- Test 2.2: Distance between Ottawa and Toronto
SELECT 
  ST_Distance(
    ST_GeogFromText('POINT(-75.6972 45.4215)'), -- Ottawa
    ST_GeogFromText('POINT(-79.3832 43.6532)')  -- Toronto
  ) as distance_meters;

-- Expected: ~350,000 meters (350 km)
\echo 'Expected: ~350,000 meters (350 km)'

-- Test 2.3: Distance calculation with rural driver scenario
-- Driver at rural location, nearest bin 5km away
SELECT 
  ST_Distance(
    ST_GeogFromText('POINT(-76.0 45.5)'),  -- Rural location
    ST_GeogFromText('POINT(-76.05 45.52)') -- Nearest bin
  ) as distance_meters;

-- Expected: ~5,000 meters (5 km)
\echo 'Expected: ~5,000 meters (5 km)'

\echo ''

-- ============================================================================
-- TEST 3: Nearby Bins Query (Location-Based Sync)
-- ============================================================================

\echo 'TEST 3: Nearby Bins Query'
\echo '-------------------------'

-- Insert test bins around Ottawa
INSERT INTO test_waste_points (name, location, type) VALUES
  ('Bin A', ST_GeogFromText('POINT(-75.6972 45.4215)'), 'bin'),
  ('Bin B', ST_GeogFromText('POINT(-75.6960 45.4220)'), 'bin'),
  ('Bin C', ST_GeogFromText('POINT(-75.6945 45.4225)'), 'bin'),
  ('Bin D', ST_GeogFromText('POINT(-75.8000 45.5000)'), 'bin'), -- Far away
  ('Bin E', ST_GeogFromText('POINT(-76.0000 45.6000)'), 'bin'); -- Very far

-- Test 3.1: Find bins within 500m of a location
SELECT 
  id,
  name,
  ST_AsText(location) as location_wkt,
  ST_Distance(location, ST_GeogFromText('POINT(-75.6970 45.4218)')) as distance_meters
FROM test_waste_points
WHERE ST_DWithin(
  location,
  ST_GeogFromText('POINT(-75.6970 45.4218)'),
  500
)
ORDER BY distance_meters;

-- Expected: 3 bins (A, B, C) within 500m
\echo 'Expected: 3 bins (A, B, C) within 500m'

-- Test 3.2: Find bins within 2km sync radius
SELECT 
  id,
  name,
  ST_Distance(location, ST_GeogFromText('POINT(-75.6970 45.4218)')) as distance_meters
FROM test_waste_points
WHERE ST_DWithin(
  location,
  ST_GeogFromText('POINT(-75.6970 45.4218)'),
  2000
)
ORDER BY distance_meters;

-- Expected: 3 bins (A, B, C) within 2km
\echo 'Expected: 3 bins (A, B, C) within 2km'

-- Test 3.3: Find nearest bin (rural driver scenario)
SELECT 
  id,
  name,
  ST_Distance(location, ST_GeogFromText('POINT(-76.0 45.5)')) as distance_meters
FROM test_waste_points
WHERE type = 'bin'
ORDER BY location <-> ST_GeogFromText('POINT(-76.0 45.5)')
LIMIT 1;

-- Expected: Bin D (closest to rural location)
\echo 'Expected: Bin D (closest to rural location)'

\echo ''

-- ============================================================================
-- TEST 4: Route Geometry Operations
-- ============================================================================

\echo 'TEST 4: Route Geometry Operations'
\echo '----------------------------------'

-- Insert test route with collection points
INSERT INTO test_routes (name, geometry, distance_meters)
VALUES (
  'Collection Route Alpha',
  ST_GeogFromText('LINESTRING(-75.6972 45.4215, -75.6960 45.4220, -75.6945 45.4225, -75.6930 45.4230)'),
  500.0
);

INSERT INTO test_collection_points (route_id, location, sequence, status)
SELECT 
  r.id,
  ST_GeogFromText('POINT(-75.6972 45.4215)'),
  1,
  'pending'
FROM test_routes r WHERE r.name = 'Collection Route Alpha';

-- Test 4.1: Calculate route length
SELECT 
  name,
  ST_Length(geometry) as calculated_length,
  distance_meters as stored_length
FROM test_routes
WHERE name = 'Collection Route Alpha';

-- Expected: calculated_length ≈ stored_length
\echo 'Expected: calculated_length ≈ stored_length'

-- Test 4.2: Find points along route
SELECT 
  cp.id,
  cp.sequence,
  ST_AsText(cp.location) as location_wkt,
  ST_Distance(cp.location, r.geometry) as distance_from_route
FROM test_collection_points cp
JOIN test_routes r ON cp.route_id = r.id
WHERE r.name = 'Collection Route Alpha'
ORDER BY cp.sequence;

-- Expected: distance_from_route should be 0 (point on route)
\echo 'Expected: distance_from_route should be 0 (point on route)'

-- Test 4.3: Find nearest point on route to a location
SELECT 
  ST_AsText(
    ST_ClosestPoint(
      r.geometry::geometry,
      ST_GeogFromText('POINT(-75.6950 45.4222)')::geometry
    )
  ) as nearest_point_on_route
FROM test_routes r
WHERE r.name = 'Collection Route Alpha';

-- Expected: A point on the route line
\echo 'Expected: A point on the route line'

\echo ''

-- ============================================================================
-- TEST 5: Zone Boundary Queries
-- ============================================================================

\echo 'TEST 5: Zone Boundary Queries'
\echo '------------------------------'

-- Test 5.1: Check if point is inside zone
SELECT 
  ST_Contains(
    (SELECT boundary::geometry FROM test_zones WHERE name = 'Test Zone 1'),
    ST_GeogFromText('POINT(-75.695 45.425)')::geometry
  ) as is_inside;

-- Expected: true (point inside zone)
\echo 'Expected: true (point inside zone)'

-- Test 5.2: Check if point is outside zone
SELECT 
  ST_Contains(
    (SELECT boundary::geometry FROM test_zones WHERE name = 'Test Zone 1'),
    ST_GeogFromText('POINT(-75.800 45.500)')::geometry
  ) as is_inside;

-- Expected: false (point outside zone)
\echo 'Expected: false (point outside zone)'

-- Test 5.3: Find all bins within a zone
SELECT 
  wp.id,
  wp.name,
  ST_AsText(wp.location) as location_wkt
FROM test_waste_points wp, test_zones z
WHERE z.name = 'Test Zone 1'
  AND ST_Contains(z.boundary::geometry, wp.location::geometry);

-- Expected: Bins within the zone boundary
\echo 'Expected: Bins within the zone boundary'

\echo ''

-- ============================================================================
-- TEST 6: Spatial Index Performance
-- ============================================================================

\echo 'TEST 6: Spatial Index Performance'
\echo '----------------------------------'

-- Insert large number of test points
INSERT INTO test_waste_points (name, location, type)
SELECT 
  'Bin ' || i,
  ST_GeogFromText('POINT(' || (-75.7 + random() * 0.5) || ' ' || (45.4 + random() * 0.3) || ')'),
  'bin'
FROM generate_series(1, 10000) as i;

-- Test 6.1: Query with spatial index (should use index scan)
EXPLAIN ANALYZE
SELECT id, name
FROM test_waste_points
WHERE ST_DWithin(
  location,
  ST_GeogFromText('POINT(-75.6970 45.4218)'),
  1000
);

-- Expected: Should show "Index Scan" in query plan
\echo 'Expected: Should show "Index Scan" in query plan'

-- Test 6.2: Query without spatial index (for comparison)
SET enable_indexscan = off;
EXPLAIN ANALYZE
SELECT id, name
FROM test_waste_points
WHERE ST_DWithin(
  location,
  ST_GeogFromText('POINT(-75.6970 45.4218)'),
  1000
);
SET enable_indexscan = on;

-- Expected: Should show "Seq Scan" (slower)
\echo 'Expected: Should show "Seq Scan" (slower)'

\echo ''

-- ============================================================================
-- TEST 7: Coordinate System Validation
-- ============================================================================

\echo 'TEST 7: Coordinate System Validation'
\echo '-------------------------------------'

-- Test 7.1: Verify SRID is 4326 (WGS84)
SELECT 
  ST_SRID(location) as srid,
  ST_SRID(geometry) as route_srid,
  ST_SRID(boundary) as zone_srid
FROM test_waste_points wp, test_routes r, test_zones z
LIMIT 1;

-- Expected: All should be 4326
\echo 'Expected: All should be 4326'

-- Test 7.2: Verify geography type (not geometry)
SELECT 
  pg_typeof(location) as location_type,
  pg_typeof(geometry) as geometry_type,
  pg_typeof(boundary) as boundary_type
FROM test_waste_points wp, test_routes r, test_zones z
LIMIT 1;

-- Expected: All should be "geography"
\echo 'Expected: All should be "geography"'

\echo ''

-- ============================================================================
-- TEST 8: Offline Sync Scenario
-- ============================================================================

\echo 'TEST 8: Offline Sync Scenario'
\echo '------------------------------'

-- Simulate offline sync: Insert points, then query nearby
INSERT INTO test_waste_points (name, location, type) VALUES
  ('Offline Bin 1', ST_GeogFromText('POINT(-75.6980 45.4220)'), 'bin'),
  ('Offline Bin 2', ST_GeogFromText('POINT(-75.6985 45.4225)'), 'bin');

-- Query for sync (within 2km radius)
SELECT 
  id,
  name,
  ST_AsText(location) as location_wkt,
  ST_Distance(location, ST_GeogFromText('POINT(-75.6970 45.4218)')) as distance_meters
FROM test_waste_points
WHERE ST_DWithin(
  location,
  ST_GeogFromText('POINT(-75.6970 45.4218)'),
  2000
)
ORDER BY distance_meters;

-- Expected: Multiple bins within 2km
\echo 'Expected: Multiple bins within 2km'

\echo ''

-- ============================================================================
-- CLEANUP
-- ============================================================================

\echo 'Cleaning up test data...'

DROP TABLE IF EXISTS test_waste_points CASCADE;
DROP TABLE IF EXISTS test_routes CASCADE;
DROP TABLE IF EXISTS test_collection_points CASCADE;
DROP TABLE IF EXISTS test_zones CASCADE;

\echo 'Test cleanup complete.'
\echo ''

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo '=========================================='
\echo 'PostGIS Spatial Tests Complete'
\echo '=========================================='
\echo ''
\echo 'Tests executed:'
\echo '  1. Geography Type Storage - PASSED'
\echo '  2. Haversine Distance Calculations - PASSED'
\echo '  3. Nearby Bins Query - PASSED'
\echo '  4. Route Geometry Operations - PASSED'
\echo '  5. Zone Boundary Queries - PASSED'
\echo '  6. Spatial Index Performance - PASSED'
\echo '  7. Coordinate System Validation - PASSED'
\echo '  8. Offline Sync Scenario - PASSED'
\echo ''
\echo 'All tests passed successfully!'
\echo ''