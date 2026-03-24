/**
 * Sync Router — WatermelonDB Synchronization Endpoints
 * 
 * Handles bidirectional sync between mobile SQLite (WatermelonDB) and PostgreSQL.
 * Supports push (local changes to server) and pull (server changes to local).
 */
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { 
  wastePoints, routes, routeStops, zones, favorites, syncStatus,
  users, organizations
} from "@/drizzle/schema";
import { eq, and, gt, inArray, sql, isNotNull } from "drizzle-orm";

// Sync change schema for incoming changes
const SyncChangeSchema = z.object({
  id: z.string(), // Local WatermelonDB ID
  table: z.string(), // Table name
  action: z.enum(["create", "update", "delete"]),
  data: z.record(z.string(), z.unknown()), // Record data
  timestamp: z.number().optional(), // Client timestamp
});

// Push request schema
const PushRequestSchema = z.object({
  changes: z.array(SyncChangeSchema),
  lastPulledAt: z.number().optional(), // Last pull timestamp
});

// Pull request schema
const PullRequestSchema = z.object({
  tables: z.array(z.string()), // Tables to sync
  since: z.number().optional(), // Last sync timestamp
  limit: z.number().min(1).max(1000).default(100),
});

// Schema for location-based sync
const LocationSyncSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusKm: z.number().min(0.1).max(50).default(10),
  limit: z.number().min(1).max(500).default(100),
});

// Table name to Drizzle table mapping
const SYNC_TABLES = {
  waste_points: wastePoints,
  routes: routes,
  route_stops: routeStops,
  zones: zones,
  favorites: favorites,
} as const;

type SyncTableName = keyof typeof SYNC_TABLES;

export const syncRouter = router({
  /**
   * Push local changes to server
   * Receives batch of changes from mobile client
   */
  push: protectedProcedure
    .input(PushRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const { changes } = input;
      const userId = ctx.user.id;
      const orgId = ctx.user.orgId;

      if (!orgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "User must belong to an organization",
        });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Database not available",
        });
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [] as string[],
        mappedIds: [] as { localId: string; serverId: string; table: string }[],
      };

      // Process each change
      for (const change of changes) {
        try {
          const tableName = change.table as SyncTableName;
          const table = SYNC_TABLES[tableName];

          if (!table) {
            throw new Error(`Unknown table: ${change.table}`);
          }

          switch (change.action) {
            case "create": {
              // Insert new record with server-generated ID
              const insertData = {
                ...change.data,
                userId,
                orgId,
                createdAt: new Date(),
                updatedAt: new Date(),
              };

              const [inserted] = await db.insert(table).values(insertData as any).returning();
              results.mappedIds.push({
                localId: change.id,
                serverId: inserted.id,
                table: change.table,
              });
              break;
            }

            case "update": {
              // Update existing record - find by local ID mapping or server ID
              const serverId = (change.data as any).serverId || change.id;
              await db
                .update(table)
                .set({
                  ...change.data,
                  updatedAt: new Date(),
                } as any)
                .where(eq((table as any).id, serverId));
              break;
            }

            case "delete": {
              // Soft delete by setting deletedAt
              const serverId = (change.data as any).serverId || change.id;
              await db
                .update(table)
                .set({
                  deletedAt: new Date(),
                  updatedAt: new Date(),
                } as any)
                .where(eq((table as any).id, serverId));
              break;
            }
          }

          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${change.table}:${change.id} - ${error.message}`);
        }
      }

      // Update sync status
      await db
        .insert(syncStatus)
        .values({
          userId,
          tableName: "sync_push",
          lastSyncAt: new Date(),
          pendingCount: 0,
        })
        .onConflictDoUpdate({
          target: [syncStatus.userId, syncStatus.tableName],
          set: { lastSyncAt: new Date() },
        });

      return {
        success: true,
        processed: results.success,
        failed: results.failed,
        errors: results.errors,
        mappedIds: results.mappedIds,
        timestamp: Date.now(),
      };
    }),

  /**
   * Pull server changes to client
   * Returns changes since last sync timestamp
   */
  pull: protectedProcedure
    .input(PullRequestSchema)
    .query(async ({ ctx, input }) => {
      const { tables, since, limit } = input;
      const userId = ctx.user.id;
      const orgId = ctx.user.orgId;

      if (!orgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "User must belong to an organization",
        });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Database not available",
        });
      }

      const sinceTimestamp = since || 0;
      const sinceDate = new Date(sinceTimestamp);
      const allChanges: any[] = [];

      // Query each requested table for changes
      for (const tableName of tables) {
        const table = SYNC_TABLES[tableName as SyncTableName];

        if (!table) continue;

        try {
          // Fetch records modified since last sync
          const records = await db
            .select()
            .from(table)
            .where(
              and(
                eq((table as any).orgId, orgId),
                gt((table as any).updatedAt, sinceDate)
              )
            )
            .limit(limit);

          // Transform records for sync
          const changes = records.map((record: any) => ({
            id: record.id,
            table: tableName,
            data: record,
            deleted: isNotNull(record.deletedAt),
          }));

          allChanges.push(...changes);
        } catch (error) {
          console.error(`Error syncing table ${tableName}:`, error);
        }
      }

      // Update sync status
      await db
        .insert(syncStatus)
        .values({
          userId,
          tableName: "sync_pull",
          lastSyncAt: new Date(),
          pendingCount: 0,
        })
        .onConflictDoUpdate({
          target: [syncStatus.userId, syncStatus.tableName],
          set: { lastSyncAt: new Date() },
        });

      return {
        changes: allChanges,
        nextToken: Date.now().toString(),
        hasMore: allChanges.length >= limit,
      };
    }),

  /**
   * Sync nearby waste points based on location
   * Optimized for rural areas with limited connectivity
   */
  nearbyWastePoints: protectedProcedure
    .input(LocationSyncSchema)
    .query(async ({ ctx, input }) => {
      const { lat, lon, radiusKm, limit } = input;
      const orgId = ctx.user.orgId;

      if (!orgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "User must belong to an organization",
        });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Database not available",
        });
      }

      // PostGIS spatial query to find points within radius
      const radiusMeters = radiusKm * 1000;

      const points = await db.execute(sql`
        SELECT 
          id, name, type, capacity, fill_level, status,
          ST_X(location::geometry) as longitude,
          ST_Y(location::geometry) as latitude,
          created_at, updated_at
        FROM ${wastePoints}
        WHERE org_id = ${orgId}
        AND deleted_at IS NULL
        AND ST_DWithin(
          location,
          ST_MakePoint(${lon}, ${lat})::geography,
          ${radiusMeters}
        )
        ORDER BY ST_Distance(location, ST_MakePoint(${lon}, ${lat})::geography)
        LIMIT ${limit}
      `);

      return {
        points: Array.from(points),
        center: { lat, lon },
        radiusKm,
        count: Array.from(points).length,
      };
    }),

  /**
   * Get sync status for all tables
   * Returns pending changes count and last sync timestamps
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const orgId = ctx.user.orgId;

    if (!orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User must belong to an organization",
      });
    }

    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Database not available",
      });
    }

    // Get last sync status for each table
    const syncStatuses = await db
      .select()
      .from(syncStatus)
      .where(eq(syncStatus.userId, userId));

    // Count pending changes (records with updatedAt > lastSyncAt)
    const tableStatuses: Record<string, { pending: number; lastSync: number | null }> = {};

    for (const tableName of Object.keys(SYNC_TABLES)) {
      const table = SYNC_TABLES[tableName as SyncTableName];
      const lastSync = syncStatuses.find((s: any) => s.tableName === tableName);

      // Count records modified since last sync
      let pendingCount = 0;
      if (lastSync?.lastSyncAt) {
        const countResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(table)
          .where(
            and(
              eq((table as any).orgId, orgId),
              gt((table as any).updatedAt, lastSync.lastSyncAt)
            )
          );
        pendingCount = countResult[0]?.count || 0;
      } else {
        // No previous sync - count all records
        const countResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(table)
          .where(eq((table as any).orgId, orgId));
        pendingCount = countResult[0]?.count || 0;
      }

      tableStatuses[tableName] = {
        pending: pendingCount,
        lastSync: lastSync?.lastSyncAt?.getTime() || null,
      };
    }

    return {
      tables: tableStatuses,
      serverTime: Date.now(),
    };
  }),

  /**
   * Resolve sync conflicts
   * Called when automatic conflict resolution fails
   */
  resolveConflict: protectedProcedure
    .input(
      z.object({
        table: z.string(),
        localId: z.string(),
        serverId: z.string(),
        resolution: z.enum(["keep_local", "keep_server", "merge"]),
        mergedData: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { table, localId, serverId, resolution, mergedData } = input;
      const userId = ctx.user.id;

      const tableName = table as SyncTableName;
      const drizzleTable = SYNC_TABLES[tableName];

      if (!drizzleTable) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown table: ${table}`,
        });
      }

      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Database not available",
        });
      }

      switch (resolution) {
        case "keep_local": {
          // Fetch local version from client and overwrite server
          if (mergedData) {
            await db
              .update(drizzleTable)
              .set({
                ...mergedData,
                updatedAt: new Date(),
              } as any)
              .where(eq((drizzleTable as any).id, serverId));
          }
          break;
        }

        case "keep_server": {
          // Server version wins - no action needed
          // Client will receive server version on next pull
          break;
        }

        case "merge": {
          // Apply merged data
          if (mergedData) {
            await db
              .update(drizzleTable)
              .set({
                ...mergedData,
                updatedAt: new Date(),
              } as any)
              .where(eq((drizzleTable as any).id, serverId));
          }
          break;
        }
      }

      return {
        success: true,
        resolution,
        resolvedAt: Date.now(),
      };
    }),
});