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

