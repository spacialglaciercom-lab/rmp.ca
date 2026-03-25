/**
 * Org-scoped zones + waste points inside zone boundaries (PostGIS ST_Contains).
 * Used by Zones page TSP control panel.
 */
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { wastePoints, zones } from "@/drizzle/schema";

export const logisticsZonesRouter = router({
  /** List active zones for the user's organization (name, id, color). */
  listZones: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database connection failed" });
    }

    const orgId = ctx.user.orgId;
    if (!orgId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User does not belong to an organization" });
    }

    const rows = await db
      .select({
        id: zones.id,
        name: zones.name,
        color: zones.color,
      })
      .from(zones)
      .where(and(eq(zones.orgId, orgId), eq(zones.isActive, true)))
      .orderBy(desc(zones.updatedAt));

    return { zones: rows };
  }),

  /** Waste points whose coordinates fall inside the zone polygon boundary. */
  listWastePointsInZone: protectedProcedure
    .input(z.object({ zoneId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database connection failed" });
      }

      const orgId = ctx.user.orgId;
      if (!orgId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "User does not belong to an organization" });
      }

      const { zoneId } = input;

      const rows = await db
        .select({
          id: wastePoints.id,
          latitude: wastePoints.latitude,
          longitude: wastePoints.longitude,
          type: wastePoints.type,
          locationName: wastePoints.locationName,
          address: wastePoints.address,
          binNumber: wastePoints.externalId,
        })
        .from(wastePoints)
        .innerJoin(zones, eq(zones.id, zoneId))
        .where(
          and(
            eq(wastePoints.orgId, orgId),
            eq(zones.orgId, orgId),
            sql`COALESCE(${wastePoints.isActive}, true) = true`,
            sql`${zones.boundary} IS NOT NULL`,
            sql`ST_Contains(
              ${zones.boundary}::geometry,
              ST_SetSRID(ST_MakePoint(${wastePoints.longitude}, ${wastePoints.latitude}), 4326)
            )`
          )
        );

      return { points: rows };
    }),
});

export type LogisticsZoneRow = {
  id: string;
  name: string;
  color: string | null;
};

export type LogisticsWastePointRow = {
  id: string;
  latitude: number;
  longitude: number;
  type: string;
  locationName: string | null;
  address: string | null;
  binNumber: string | null;
};
