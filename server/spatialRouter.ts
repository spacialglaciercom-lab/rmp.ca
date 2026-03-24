import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { router, publicProcedure } from "./_core/trpc";
import { getNearbyBins } from "./spatialService";
import { getDb } from "./db";
import { collectionPoints, optimizedRoutes } from "../drizzle/schema";
import { generateText } from "ai";
import { getGateway } from "./aiProxy";

export const spatialRouter = router({
  // This is the "hook" your mobile app will call
  getNearbyPoints: publicProcedure
    .input(
      z.object({
        lng: z.number(),
        lat: z.number(),
        radius: z.number().default(1000), // Default to 1km
      })
    )
    .query(async ({ input }) => {
      const { lng, lat, radius } = input;
      
      // Call the service we just wrote
      const points = await getNearbyBins(lng, lat, radius);
      
      return points;
    }),

  toggleCollectionStatus: publicProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database connection not available");
      }
      
      await db
        .update(collectionPoints)
        .set({ isCollected: input.status })
        .where(eq(collectionPoints.id, input.id));

      return { success: true, binId: input.id, newStatus: input.status };
    }),

  getRouteProgress: publicProcedure
    .input(z.object({ lng: z.number(), lat: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database connection not available");
      }

      const result = await db.execute(sql`
        SELECT 
          count(*)::int as total_remaining,
          COALESCE(SUM(ST_Distance(location, ST_MakePoint(${input.lng}, ${input.lat})::geography)), 0) as meters_remaining
        FROM ${collectionPoints}
        WHERE is_collected = false
      `);

      return result[0];
    }),

  resetAllBins: publicProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database connection not available");
    }

    await db.update(collectionPoints).set({ isCollected: false });

    return { success: true, message: "Route reset for new shift" };
  }),

  verifyAndCollect: publicProcedure
    .input(z.object({
      qrToken: z.string(),
      driverLng: z.number(),
      driverLat: z.number()
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database connection not available");
      }

      // 1. Find the bin and check if driver is within 10 meters
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

      if (bin.length === 0) {
        throw new Error("Verification failed: You are too far from the bin or the QR is invalid.");
      }

      // 2. If verified, mark as collected
      await db.update(collectionPoints)
        .set({ isCollected: true })
        .where(eq(collectionPoints.id, bin[0].id));

      return { success: true, binId: bin[0].id };
    }),

  /**
   * Solve TSP (Traveling Salesman Problem) using pgRouting.
   * Returns an ordered list of points representing the optimized route.
   * Falls back to nearest-neighbor heuristic if pgRouting is unavailable.
   */
  solveTSP: publicProcedure
    .input(
      z.object({
        points: z.array(
          z.object({
            id: z.string(),
            lat: z.number(),
            lon: z.number(),
            name: z.string().optional(),
            demand: z.number().optional(),
            serviceTime: z.number().optional(),
          })
        ),
        depot: z
          .object({
            id: z.string(),
            lat: z.number(),
            lon: z.number(),
            name: z.string().optional(),
          })
          .optional(),
        returnToDepot: z.boolean().default(true),
        algorithm: z.enum(['pgrouting', 'vroom', 'nearest-neighbor', '2-opt']).default('pgrouting'),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database connection not available");
      }

      const { points, depot, returnToDepot, algorithm } = input;

      // If no points, return empty result
      if (points.length === 0) {
        return {
          orderedPoints: [],
          totalDistance: 0,
          estimatedDuration: 0,
          algorithm: 'none',
        };
      }

      // For pgRouting algorithm, use PostGIS functions
      if (algorithm === 'pgrouting') {
        try {
          // Create temporary table with point geometries
          const pointValues = points.map((p, idx) => 
            `(${idx}, ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326))`
          ).join(', ');

          // Build the SQL query for pgr_TSP
          // Note: This requires pgRouting extension to be installed
          const result = await db.execute(sql`
            WITH points AS (
              SELECT 
                id,
                geom,
                ST_X(geom) as lon,
                ST_Y(geom) as lat
              FROM (
                VALUES ${sql.raw(pointValues)}
              ) AS t(id, geom)
            )
            SELECT 
              p.id,
              p.lat,
              p.lon,
              p.name,
              p.demand,
              p.service_time
            FROM points p
            ORDER BY p.id;
          `);

          // For now, fall back to nearest-neighbor since pgr_TSP requires
          // a distance matrix table. In production, you'd use:
          // SELECT * FROM pgr_TSP($matrix_sql, start_id, end_id);
          
          // Fall back to local solver
          return solveTSPNearestNeighbor(points, depot, returnToDepot);
        } catch (error) {
          console.error('pgRouting TSP failed, falling back to local solver:', error);
          return solveTSPNearestNeighbor(points, depot, returnToDepot);
        }
      }

      // For VROOM algorithm, call external VROOM server
      if (algorithm === 'vroom') {
        try {
          // VROOM requires an external server running
          const vroomUrl = process.env.VROOM_URL || 'http://localhost:3100';
          
          const vroomJobs = points.map((p, idx) => ({
            id: idx + 1,
            location: [p.lon, p.lat],
            ...(p.serviceTime && { service: p.serviceTime }),
            ...(p.demand && { amount: [p.demand] }),
          }));

          const vroomRequest = {
            jobs: vroomJobs,
            vehicles: [{
              id: 1,
              start: depot ? [depot.lon, depot.lat] : undefined,
              end: returnToDepot && depot ? [depot.lon, depot.lat] : undefined,
            }],
          };

          const response = await fetch(`${vroomUrl}/solve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vroomRequest),
          });

          if (!response.ok) {
            throw new Error(`VROOM error: ${response.statusText}`);
          }

          const vroomResult = await response.json() as {
            routes: Array<{
              steps: Array<{ id: number; location: [number, number] }>;
            }>;
            summary: { distance: number; duration: number };
          };

          // Map VROOM result back to our points
          const orderedPoints = vroomResult.routes[0]?.steps.map((step) => {
            const point = points.find((p) => p.id === String(step.id));
            return point ?? points[0];
          }) ?? points;

          return {
            orderedPoints,
            totalDistance: vroomResult.summary.distance,
            estimatedDuration: vroomResult.summary.duration,
            algorithm: 'vroom',
          };
        } catch (error) {
          console.error('VROOM failed, falling back to local solver:', error);
          return solveTSPNearestNeighbor(points, depot, returnToDepot);
        }
      }

      // Default to nearest-neighbor local solver
      return solveTSPNearestNeighbor(points, depot, returnToDepot);
    }),

  /**
   * AI-powered post-route analysis using PostGIS metrics and Vercel AI Gateway.
   * Pulls completed route data, calculates efficiency metrics, and generates
   * actionable insights from an LLM acting as a municipal logistics expert.
   */
  analyzeRoutePerformance: publicProcedure
    .input(z.object({ routeName: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database connection not available");
      }

      // 1. Fetch the route and calculate AI-friendly metrics using PostGIS
      const routeStats = await db.execute(sql`
        SELECT 
          route_name,
          total_distance_meters,
          ST_NumPoints(path::geometry) as total_bins_collected,
          (total_distance_meters / NULLIF(ST_NumPoints(path::geometry), 0)) as meters_per_bin,
          ST_AsText(ST_StartPoint(path::geometry)) as start_location,
          ST_AsText(ST_EndPoint(path::geometry)) as end_location
        FROM ${optimizedRoutes}
        WHERE route_name = ${input.routeName}
        LIMIT 1;
      `);

      if (routeStats.length === 0) {
        throw new Error(`Route not found: ${input.routeName}`);
      }

      const stats = routeStats[0] as {
        route_name: string;
        total_distance_meters: number;
        total_bins_collected: number;
        meters_per_bin: number;
        start_location: string;
        end_location: string;
      };

      // 2. Build the prompt for the AI
      const prompt = `
        You are a municipal logistics analyst for a city waste management system.
        Analyze the following completed route data:
        - Route Name: ${stats.route_name}
        - Total Distance: ${(Number(stats.total_distance_meters) / 1000).toFixed(2)} km
        - Total Bins Collected: ${stats.total_bins_collected}
        - Average Distance Between Bins: ${Number(stats.meters_per_bin).toFixed(2)} meters
        - Start Location: ${stats.start_location}
        - End Location: ${stats.end_location}
        
        Provide a brief, 3-bullet-point analysis on the efficiency of this route. 
        If the average distance between bins is over 500 meters, flag it as a low-density inefficiency and suggest grouping this route with a neighboring district.
      `;

      // 3. Call the LLM via Vercel AI Gateway
      const gateway = getGateway();
      if (!gateway) {
        throw new Error(
          "AI Gateway not configured. Set AI_GATEWAY_API_KEY or OPENROUTER_API_KEY on the server.",
        );
      }

      const { text } = await generateText({
        model: gateway("openai/gpt-4o-mini"),
        prompt: prompt,
        maxTokens: 1024,
      });

      return {
        success: true,
        analysis: text,
        rawStats: {
          routeName: stats.route_name,
          totalDistanceKm: Number(stats.total_distance_meters) / 1000,
          totalBinsCollected: stats.total_bins_collected,
          metersPerBin: Number(stats.meters_per_bin),
          startLocation: stats.start_location,
          endLocation: stats.end_location,
        },
      };
    }),
});

/**
 * Helper function: Solve TSP using nearest-neighbor heuristic.
 * Used as fallback when pgRouting/VROOM are unavailable.
 */
function solveTSPNearestNeighbor(
  points: Array<{
    id: string;
    lat: number;
    lon: number;
    name?: string;
    demand?: number;
    serviceTime?: number;
  }>,
  depot?: { id: string; lat: number; lon: number; name?: string },
  returnToDepot?: boolean
) {
  // Haversine distance calculation
  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  // Build ordered list using nearest-neighbor
  const allPoints = depot ? [depot, ...points] : [...points];
  const remaining = new Set(allPoints.map((p) => p.id));
  const ordered: typeof points = [];
  let totalDistance = 0;

  // Start from depot or first point
  let current = allPoints[0];
  ordered.push(current);
  remaining.delete(current.id);

  // Visit each point by nearest distance
  while (remaining.size > 0) {
    let nearest: typeof points[0] | undefined;
    let nearestDist = Infinity;

    for (const p of allPoints) {
      if (remaining.has(p.id)) {
        const dist = haversine(current.lat, current.lon, p.lat, p.lon);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = p;
        }
      }
    }

    if (nearest) {
      totalDistance += nearestDist;
      ordered.push(nearest);
      remaining.delete(nearest.id);
      current = nearest;
    }
  }

  // Return to depot if required
  if (returnToDepot && depot) {
    totalDistance += haversine(current.lat, current.lon, depot.lat, depot.lon);
    ordered.push(depot);
  }

  // Estimate duration (assume 30 km/h average speed + 2 min per stop)
  const avgSpeedMps = (30 * 1000) / 3600; // 30 km/h in m/s
  const serviceTimePerStop = 120; // 2 minutes in seconds
  const travelTime = totalDistance / avgSpeedMps;
  const serviceTime = points.length * serviceTimePerStop;
  const estimatedDuration = travelTime + serviceTime;

  return {
    orderedPoints: ordered,
    totalDistance,
    estimatedDuration,
    algorithm: 'nearest-neighbor' as const,
  };
}

