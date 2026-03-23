import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { collectionPoints } from "../drizzle/schema";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.server") });

async function testGeofence(lng: number, lat: number, token: string) {
  const db = await getDb();
  if (!db) {
    console.error("Database not available");
    return;
  }

  console.log(`\nTesting Geofence: Lng=${lng}, Lat=${lat}, Token=${token}`);

  const bin = await db.execute<{ id: number }[]>(sql`
    SELECT id 
    FROM ${collectionPoints}
    WHERE qr_code_token = ${token}
    AND ST_DWithin(
      location, 
      ST_MakePoint(${lng}, ${lat})::geography, 
      10
    )
    LIMIT 1;
  `);

  if (bin.length === 0) {
    console.log("❌ VERIFICATION FAILED: Access Denied. (Driver is too far or token is invalid)");
  } else {
    console.log("✅ VERIFICATION SUCCESS: Access Granted. (Driver is at the correct location)");
  }
}

async function runTests() {
  // Bin 2 (ID 3) is at: -72.5545, 46.3538
  
  // 1. Correct Location (approx 1 meter away)
  await testGeofence(-72.55451, 46.35381, 'BIN-TR-001');

  // 2. "Cheating" from Montreal (approx 120km away)
  await testGeofence(-73.5673, 45.5017, 'BIN-TR-001');
}

runTests();
