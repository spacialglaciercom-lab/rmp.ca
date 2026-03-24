import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { collectionPoints } from "../drizzle/schema";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables from .env.server
dotenv.config({ path: path.resolve(__dirname, "../.env.server") });

async function testSpatialInsert() {
  console.log("Connecting to database at:", process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ":****@"));
  
  const db = await getDb();
  if (!db) {
    console.error("Failed to initialize database connection. Check your DATABASE_URL in .env.server");
    process.exit(1);
  }

  const testLat = 45.4215; // Ottawa
  const testLng = -75.6972;

  try {
    console.log(`Inserting test point at Lat: ${testLat}, Lng: ${testLng}...`);
    
    // We use ST_GeogFromText for PostGIS geography
    const result = await db.insert(collectionPoints).values({
      location: sql`ST_GeogFromText('SRID=4326;POINT(' || ${testLng} || ' ' || ${testLat} || ')')`,
      address: "123 Gemini St, Test City",
      isCollected: false
    }).returning();

    console.log("Success! Inserted point ID:", result[0].id);
    process.exit(0);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    const nestedCode = error?.cause?.code ?? error?.code ?? "";
    const fullText = `${message} ${nestedCode} ${JSON.stringify(error?.cause ?? {})}`;
    // This script relies on an external Postgres/PostGIS service. If it's not
    // reachable in the current environment, treat as a skipped check instead of
    // failing the whole test command.
    if (
      fullText.includes("CONNECT_TIMEOUT") ||
      fullText.includes("ECONNREFUSED") ||
      fullText.includes("ENOTFOUND")
    ) {
      console.warn("Spatial test skipped: database is unreachable in this environment.");
      process.exit(0);
    }

    console.error("Error during spatial insert:", error);
    process.exit(1);
  }
}

testSpatialInsert();
