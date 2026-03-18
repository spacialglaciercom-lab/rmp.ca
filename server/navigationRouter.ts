/**
 * tRPC router for server-side turn-by-turn instruction generation
 * from Hierholzer route optimizer output.
 */

import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  generateHierholzerInstructions,
  buildMatchedRouteFromHierholzer,
} from "../lib/hierholzerInstructions";
import type { RoutePoint } from "../lib/route-optimizer-v2/types";

const routePointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  nodeId: z.string().optional(),
});

export const navigationRouter = router({
  /**
   * Generate turn-by-turn instructions from an ordered sequence of
   * RoutePoints (Hierholzer output). Returns instructions with bearing
   * info, turn types, and human-readable text.
   */
  generateInstructions: publicProcedure
    .input(
      z.object({
        route: z.array(routePointSchema).min(2),
        minTurnAngle: z.number().min(5).max(90).optional(),
      }),
    )
    .mutation(({ input }) => {
      const routePoints: RoutePoint[] = input.route.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        nodeId: p.nodeId,
      }));

      const instructions = generateHierholzerInstructions(routePoints, {
        minTurnAngle: input.minTurnAngle,
      });

      return { instructions };
    }),

  /**
   * Build a full MatchedRoute (with steps, geometry, and instructions)
   * that can be fed into NavigationEngine on the client. This is the
   * server-side equivalent of buildMatchedRouteFromHierholzer.
   */
  buildMatchedRoute: publicProcedure
    .input(
      z.object({
        route: z.array(routePointSchema).min(2),
        minTurnAngle: z.number().min(5).max(90).optional(),
      }),
    )
    .mutation(({ input }) => {
      const routePoints: RoutePoint[] = input.route.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        nodeId: p.nodeId,
      }));

      const result = buildMatchedRouteFromHierholzer(routePoints, {
        minTurnAngle: input.minTurnAngle,
      });

      return result;
    }),
});
