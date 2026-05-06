/**
 * Spatial Query Examples for DEM Elevation Data
 * 
 * This module provides production-ready query functions for extracting
 * elevation data from the PostGIS database for route optimization and
 * fuel calculation.
 * 
 * @module elevationQueries
 */

import { db } from "../server/db";
import { demGranules, demElevation, elevationCache } from "../drizzle/schema/dem";
import { sql, eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface Point {
  lon: number;
  lat: number;
}

export interface ElevationResult {
  elevation: number | null;
  hasCoverage: boolean;
}

export interface RouteElevationPoint {
  distanceM: number;
  elevationM: number | null;
  point: Point;
}

export interface ElevationProfile {
  points: RouteElevationPoint[];
  totalAscent: number;
  totalDescent: number;
  maxElevation: number;
  minElevation: number;
  avgElevation: number;
  distanceKm: number;
}

export interface GeofenceStats {
  minElevation: number;
  maxElevation: number;
  avgElevation: number;
  coveragePercent: number;
  pixelCount: number;
}

export interface CoverageCheck {
  hasCoverage: boolean;
  coveragePercent: number;
  tileCount: number;
  granuleIds: string[];
}

// ============================================================================
// Point Elevation Query
// ============================================================================

/**
 * Get elevation at a single point
 * 
 * @param point WGS84 coordinate
 * @returns Elevation in meters or null if no coverage
 */
export async function getElevationAtPoint(point: Point): Promise<ElevationResult> {
  const result = await db.execute(sql`
    SELECT get_elevation(${point.lon}, ${point.lat}) AS elevation
  `);

  const elevation = result.rows[0]?.elevation as number | null;

  return {
    elevation,
    hasCoverage: elevation !== null,
  };
}

/**
 * Get elevations at multiple points efficiently
 * 
 * @param points Array of WGS84 coordinates
 * @returns Array of elevations (null where no coverage)
 */
export async function getElevationsAtPoints(points: Point[]): Promise<(number | null)[]> {
  if (points.length === 0) return [];

  // Build PostGIS point array
  const pointsArray = points
    .map((p) => `ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)`)
    .join(", ");

  const result = await db.execute(sql.raw(`
    SELECT get_elevations(ARRAY[${pointsArray}]) AS elevations
  `));

  const elevations = result.rows[0]?.elevations as (number | null)[];

  return elevations || [];
}

// ============================================================================
// Route Elevation Profile Query
// ============================================================================

/**
 * Get elevation profile along a route
 * 
 * @param routeLineString GeoJSON LineString coordinates
 * @param sampleIntervalM Distance between samples in meters (default: 10m)
 * @returns Detailed elevation profile
 */
export async function getRouteElevationProfile(
  routeLineString: number[][],
  sampleIntervalM: number = 10.0
): Promise<ElevationProfile> {
  // Convert coordinates to PostGIS LineString
  const coords = routeLineString.map((c) => `${c[0]} ${c[1]}`).join(", ");
  const lineStringWKT = `LINESTRING(${coords})`;

  const result = await db.execute(sql.raw(`
    SELECT * FROM get_elevation_profile(
      ST_SetSRID(ST_GeomFromText('${lineStringWKT}'), 4326),
      ${sampleIntervalM}
    )
  `));

  const rows = result.rows as {
    segment_id: number;
    distance_from_start_m: number;
    distance_segment_m: number;
    elevation_start_m: number | null;
    elevation_end_m: number | null;
    grade_percent: number;
    cumulative_ascent_m: number;
    cumulative_descent_m: number;
  }[];

  if (rows.length === 0) {
    return {
      points: [],
      totalAscent: 0,
      totalDescent: 0,
      maxElevation: 0,
      minElevation: 0,
      avgElevation: 0,
      distanceKm: 0,
    };
  }

  // Calculate total distance
  const lastRow = rows[rows.length - 1];
  const distanceKm = lastRow.distance_from_start_m / 1000;

  // Extract elevation values
  const elevations = rows
    .map((r) => r.elevation_end_m)
    .filter((e): e is number => e !== null);

  // Build points array
  const points: RouteElevationPoint[] = rows.map((row, idx) => {
    // Interpolate point position along route
    const progress = idx / (rows.length - 1);
    const pointIdx = Math.min(
      Math.floor(progress * (routeLineString.length - 1)),
      routeLineString.length - 2
    );
    const point: Point = {
      lon: routeLineString[pointIdx][0],
      lat: routeLineString[pointIdx][1],
    };

    return {
      distanceM: row.distance_from_start_m,
      elevationM: row.elevation_end_m,
      point,
    };
  });

  return {
    points,
    totalAscent: lastRow.cumulative_ascent_m,
    totalDescent: lastRow.cumulative_descent_m,
    maxElevation: Math.max(...elevations),
    minElevation: Math.min(...elevations),
    avgElevation: elevations.reduce((a, b) => a + b, 0) / elevations.length,
    distanceKm,
  };
}

/**
 * Get elevation profile with caching
 * 
 * @param routeLineString GeoJSON LineString coordinates
 * @param sampleIntervalM Distance between samples in meters
 * @returns Elevation profile (from cache if available)
 */
export async function getRouteElevationProfileCached(
  routeLineString: number[][],
  sampleIntervalM: number = 10.0
): Promise<ElevationProfile> {
  // Generate cache key
  const cacheKey = JSON.stringify({ routeLineString, sampleIntervalM });
  const queryHash = crypto.createHash("sha256").update(cacheKey).digest("hex");

  // Check cache
  const cached = await db
    .select()
    .from(elevationCache)
    .where(eq(elevationCache.queryHash, queryHash))
    .limit(1);

  if (cached.length > 0) {
    const result = cached[0].result as ElevationProfile;
    return result;
  }

  // Compute profile
  const profile = await getRouteElevationProfile(routeLineString, sampleIntervalM);

  // Store in cache (expires in 7 days)
  await db.insert(elevationCache).values({
    queryHash,
    queryType: "linestring",
    inputGeom: JSON.stringify(routeLineString),
    result: profile as unknown as Record<string, unknown>,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return profile;
}

// ============================================================================
// Geofence Elevation Query
// ============================================================================

/**
 * Get elevation statistics within a geofence (polygon)
 * 
 * @param polygon GeoJSON Polygon coordinates
 * @returns Elevation statistics for the geofence
 */
export async function getGeofenceElevationStats(
  polygon: number[][][]
): Promise<GeofenceStats> {
  // Convert GeoJSON polygon to WKT
  const rings = polygon
    .map((ring) => {
      const coords = ring.map((c) => `${c[0]} ${c[1]}`).join(", ");
      return `(${coords})`;
    })
    .join(", ");
  const polygonWKT = `POLYGON(${rings})`;

  const result = await db.execute(sql.raw(`
    SELECT * FROM get_geofence_elevation_stats(
      ST_SetSRID(ST_GeomFromText('${polygonWKT}'), 4326)
    )
  `));

  const row = result.rows[0];

  return {
    minElevation: row?.min_elevation ?? 0,
    maxElevation: row?.max_elevation ?? 0,
    avgElevation: row?.avg_elevation ?? 0,
    coveragePercent: row?.coverage_percent ?? 0,
    pixelCount: row?.pixel_count ?? 0,
  };
}

/**
 * Check elevation within a 10-meter geofence around a point
 * 
 * @param center Center point of the geofence
 * @param radiusM Radius in meters (default: 10m)
 * @returns Elevation statistics for the circular geofence
 */
export async function getElevationInGeofence(
  center: Point,
  radiusM: number = 10
): Promise<GeofenceStats> {
  // Create a circular geofence using ST_Buffer
  const result = await db.execute(sql.raw(`
    SELECT * FROM get_geofence_elevation_stats(
      ST_Buffer(
        ST_SetSRID(ST_MakePoint(${center.lon}, ${center.lat}), 4326)::geography,
        ${radiusM}
      )::geometry
    )
  `));

  const row = result.rows[0];

  return {
    minElevation: row?.min_elevation ?? 0,
    maxElevation: row?.max_elevation ?? 0,
    avgElevation: row?.avg_elevation ?? 0,
    coveragePercent: row?.coverage_percent ?? 0,
    pixelCount: row?.pixel_count ?? 0,
  };
}

// ============================================================================
// Coverage Query
// ============================================================================

/**
 * Check if DEM data covers a bounding box
 * 
 * @param bbox Bounding box coordinates
 * @returns Coverage information
 */
export async function checkDemCoverage(bbox: {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}): Promise<CoverageCheck> {
  const result = await db.execute(sql`
    SELECT * FROM check_dem_coverage(
      ${bbox.minLon},
      ${bbox.minLat},
      ${bbox.maxLon},
      ${bbox.maxLat}
    )
  `);

  const row = result.rows[0];

  return {
    hasCoverage: row?.has_coverage ?? false,
    coveragePercent: row?.coverage_percent ?? 0,
    tileCount: row?.tile_count ?? 0,
    granuleIds: (row?.granule_ids as string[]) ?? [],
  };
}

// ============================================================================
// Granule Management Queries
// ============================================================================

/**
 * Get all imported DEM granules
 */
export async function getImportedGranules() {
  return db
    .select()
    .from(demGranules)
    .where(eq(demGranules.status, "completed"))
    .orderBy(demGranules.importedAt);
}

/**
 * Get granules covering a specific area
 */
export async function getGranulesForArea(bbox: {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}) {
  const polygonWKT = `POLYGON((${bbox.minLon} ${bbox.minLat}, ${bbox.maxLon} ${bbox.minLat}, ${bbox.maxLon} ${bbox.maxLat}, ${bbox.minLon} ${bbox.maxLat}, ${bbox.minLon} ${bbox.minLat}))`;

  return db
    .select()
    .from(demGranules)
    .where(sql`
      ST_Intersects(
        coverage_geom,
        ST_SetSRID(ST_GeomFromText(${polygonWKT}), 4326)
      )
    `);
}

/**
 * Get elevation statistics for a granule
 */
export async function getGranuleStats(granuleId: string) {
  const result = await db
    .select({
      granuleId: demGranules.granuleId,
      title: demGranules.title,
      minElevation: demGranules.minElevation,
      maxElevation: demGranules.maxElevation,
      tileCount: demGranules.tileCount,
      importedAt: demGranules.importedAt,
    })
    .from(demGranules)
    .where(eq(demGranules.granuleId, granuleId))
    .limit(1);

  return result[0];
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear expired cache entries
 */
export async function clearExpiredCache(): Promise<number> {
  const result = await db.execute(sql`
    SELECT cleanup_old_cache_entries(30) AS deleted_count
  `);

  return (result.rows[0]?.deleted_count as number) ?? 0;
}

/**
 * Clear all cache entries
 */
export async function clearAllCache(): Promise<void> {
  await db.delete(elevationCache);
}

// ============================================================================
// Fuel-Aware Routing Query
// ============================================================================

/**
 * Calculate fuel consumption factor based on elevation profile
 * 
 * This is a simplified model that accounts for:
 * - Base fuel consumption (flat terrain)
 * - Additional consumption for uphill grades
 * - Reduced consumption for downhill grades
 * 
 * @param profile Elevation profile from getRouteElevationProfile
 * @param baseConsumption Base fuel consumption in L/km
 * @returns Adjusted fuel consumption factor
 */
export function calculateFuelConsumptionFactor(
  profile: ElevationProfile,
  baseConsumption: number = 0.35 // L/km for typical vehicle
): {
  totalFuelL: number;
  avgConsumptionLPerKm: number;
  elevationPenaltyL: number;
  elevationBenefitL: number;
} {
  let totalFuel = 0;
  let elevationPenalty = 0;
  let elevationBenefit = 0;

  for (let i = 1; i < profile.points.length; i++) {
    const prev = profile.points[i - 1];
    const curr = profile.points[i];

    if (prev.elevationM === null || curr.elevationM === null) continue;

    const distanceKm = (curr.distanceM - prev.distanceM) / 1000;
    const elevationChange = (curr.elevationM - prev.elevationM);
    const grade = distanceKm > 0 ? elevationChange / (distanceKm * 1000) : 0;

    // Base fuel for this segment
    const baseFuel = baseConsumption * distanceKm;

    // Elevation adjustment (simplified model)
    // Uphill: +15% fuel per 1% grade
    // Downhill: -5% fuel per 1% grade (limited to -20% total)
    let elevationFactor = 0;
    if (grade > 0) {
      elevationFactor = 0.15 * grade * 100; // Uphill penalty
      elevationPenalty += baseFuel * elevationFactor;
    } else {
      elevationFactor = Math.max(-0.20, 0.05 * grade * 100); // Downhill benefit (capped)
      elevationBenefit += Math.abs(baseFuel * elevationFactor);
    }

    totalFuel += baseFuel * (1 + elevationFactor);
  }

  return {
    totalFuelL: totalFuel,
    avgConsumptionLPerKm: profile.distanceKm > 0 ? totalFuel / profile.distanceKm : baseConsumption,
    elevationPenaltyL: elevationPenalty,
    elevationBenefitL: elevationBenefit,
  };
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example: Get elevation profile for a route and calculate fuel consumption
 */
export async function exampleRouteAnalysis() {
  // Montreal to Quebec City (simplified route)
  const route: number[][] = [
    [-73.5673, 45.5017], // Montreal
    [-73.5, 45.6],
    [-73.3, 45.8],
    [-73.1, 46.0],
    [-72.9, 46.2],
    [-72.7, 46.4],
    [-71.2, 46.8], // Quebec City
  ];

  // Get elevation profile
  const profile = await getRouteElevationProfileCached(route, 50); // 50m intervals


  // Calculate fuel consumption
  const fuel = calculateFuelConsumptionFactor(profile);

  return { profile, fuel };
}

/**
 * Example: Check DEM coverage for an area
 */
export async function exampleCoverageCheck() {
  // Check coverage for Montreal area
  const coverage = await checkDemCoverage({
    minLon: -73.9,
    minLat: 45.4,
    maxLon: -73.5,
    maxLat: 45.7,
  });


  return coverage;
}

/**
 * Example: Get elevation within a 10m geofence
 */
export async function exampleGeofenceElevation() {
  // Check elevation at a specific location with 10m radius
  const stats = await getElevationInGeofence(
    { lon: -73.5875, lat: 45.5041 }, // Montreal downtown
    10 // 10 meter radius
  );


  return stats;
}