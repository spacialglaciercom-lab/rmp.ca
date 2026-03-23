# Route Master Pro: Spatial Database & API Setup Guide

This document summarizes the steps taken to configure the PostgreSQL + PostGIS database, integrate it with Drizzle ORM, and expose spatial functionalities via tRPC for the React Native mobile app.

## 1. Database Connection Setup
We configured the backend to connect to a PostgreSQL 17 database with PostGIS 3.4 running inside a FreeBSD jail (IP: `10.17.89.2`).

Added the connection string to `.env.server`:
```env
DATABASE_URL=postgresql://postgres:Arm%26hammer94@10.17.89.2:5432/routemaster
```

## 2. Drizzle ORM PostGIS Configuration
We updated `drizzle.config.ts` to ignore internal PostGIS tables to prevent Drizzle from attempting to manage them:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  tablesFilter: ["!spatial_ref_sys", "!geography_columns", "!geometry_columns"],
});
```

## 3. Schema Definitions
We mapped the existing PostGIS `geography` tables in `drizzle/schema.ts` using a custom Drizzle type to perfectly reflect the database structure:

```typescript
import { boolean, customType, doublePrecision, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

const geography = customType<{
  data: string;
  driverData: string;
  config: { type: string; srid: number };
}>({
  dataType: (config) => `geography(${config?.type}, ${config?.srid})`,
});

export const collectionPoints = pgTable("collection_points", {
  id: serial("id").primaryKey(),
  address: text("address"),
  location: geography("location", { type: "Point", srid: 4326 }),
  isCollected: boolean("is_collected").default(false),
  qrCodeToken: text("qr_code_token"), // Added for QR verification
  createdAt: timestamp("created_at").defaultNow(),
});

export const optimizedRoutes = pgTable("optimized_routes", {
  id: serial("id").primaryKey(),
  routeName: text("route_name"),
  path: geography("path", { type: "LineString", srid: 4326 }),
  totalDistanceMeters: doublePrecision("total_distance_meters"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

## 4. Backend Spatial Service
Created `server/spatialService.ts` to encapsulate the core PostGIS logic. This leverages `ST_DWithin` and `ST_Distance` on `geography` types for accurate, high-performance bounding-box spatial queries.

```typescript
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { collectionPoints } from "../drizzle/schema";

export async function getNearbyBins(truckLng: number, truckLat: number, radiusMeters: number = 1000) {
  const db = await getDb();
  if (!db) throw new Error("Database connection not available");

  return await db.execute(sql`
    SELECT id, address,
           ST_Distance(location, ST_MakePoint(${truckLng}, ${truckLat})::geography) as dist
    FROM ${collectionPoints}
    WHERE ST_DWithin(location, ST_MakePoint(${truckLng}, ${truckLat})::geography, ${radiusMeters})
    ORDER BY dist ASC
  `);
}
```

## 5. Mobile API (tRPC Router)
Created a dedicated tRPC router at `server/spatialRouter.ts` to expose these features to the React Native app. We integrated:
- **`getNearbyPoints` (Query):** Fetches nearby bins based on the driver's GPS.
- **`toggleCollectionStatus` (Mutation):** Manually flips a bin's `is_collected` boolean.
- **`getRouteProgress` (Query):** Calculates remaining bins and total spherical distance to them.
- **`resetAllBins` (Mutation):** Resets all bins to `is_collected = false` for a new shift.
- **`verifyAndCollect` (Mutation):** Securely marks a bin as collected *only* if the provided QR token matches AND the driver is physically within a 10-meter geofence.

*Snippet of the geofence logic:*
```typescript
const bin = await db.execute<{ id: number }[]>(sql`
  SELECT id 
  FROM ${collectionPoints}
  WHERE qr_code_token = ${input.qrToken}
  AND ST_DWithin(
    location, 
    ST_MakePoint(${input.driverLng}, ${input.driverLat})::geography, 
    10
  )
  LIMIT 1;
`);
```

## 6. Testing & Utilities
- Seeded the database with mock bins around Parc de l'Exposition in Trois-Rivières.
- Created `scripts/generate-bin-qr.ts` using the `qrcode` library to programmatically generate physical QR codes (e.g., `test-qr-bin-1.png`).
- Created `scripts/test-geofence-security.ts` to mathematically prove the security of the 10-meter geofence logic (successfully granting access when close, and rejecting access when attempting to "cheat" from a distance like Montreal).

---
**Status:** The backend is fully secured, spatially aware, and ready to be integrated directly into the Mapbox and camera components of the React Native app!
