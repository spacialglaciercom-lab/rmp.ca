import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { collectionPoints } from "../drizzle/schema";

/**
 * Finds all collection points within a given radius in meters.
 * Uses PostGIS ST_DWithin on geography types for high-performance bounding-box spatial queries.
 *
 * @param truckLng Longitude of the truck's current position
 * @param truckLat Latitude of the truck's current position
 * @param radiusMeters Distance in meters to search within
 */
export async function getNearbyBins(
  truckLng: number,
  truckLat: number,
  radiusMeters: number = 1000
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database connection not available");
  }

  // Because the location column is a GEOGRAPHY type, PostGIS expects geographic
  // coordinates and calculates true spherical distances in meters.
  // Note: ST_MakePoint takes (Longitude, Latitude).
  const nearbyBins = await db.execute(sql`
    SELECT id, address,
           ST_Distance(location, ST_MakePoint(${truckLng}, ${truckLat})::geography) as dist
    FROM ${collectionPoints}
    WHERE ST_DWithin(location, ST_MakePoint(${truckLng}, ${truckLat})::geography, ${radiusMeters})
    ORDER BY dist ASC
  `);

  return nearbyBins;
}
