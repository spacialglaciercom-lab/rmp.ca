/**
 * tRPC router that proxies optimizer requests to the Python FastAPI backend.
 * Exposes CPP optimization and zone partitioning so plugins (e.g. route-optimization)
 * can call context.api.optimizer.* seamlessly.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "./_core/trpc";

const OPTIMIZER_BACKEND_URL = (() => {
  const raw =
    process.env.OPTIMIZER_BACKEND_URL ||
    process.env.EXPO_PUBLIC_OPTIMIZER_URL ||
    "";
  if (!raw) return "";
  return raw.startsWith("http://") || raw.startsWith("https://")
    ? raw.replace(/\/$/, "")
    : `https://${raw.replace(/\/$/, "")}`;
})();

const DEFAULT_TIMEOUT_MS = 30_000;
const PARTITION_TIMEOUT_MS = 120_000;

async function proxy(
  path: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  if (!OPTIMIZER_BACKEND_URL) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Optimizer backend not configured. Set OPTIMIZER_BACKEND_URL or EXPO_PUBLIC_OPTIMIZER_URL.",
    });
  }
  const url = `${OPTIMIZER_BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text();
    if (!res.ok) {
      let detail: unknown = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail ?? parsed.message ?? text;
      } catch {
        // keep text
      }
      throw new TRPCError({
        code: res.status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
        message:
          typeof detail === "string"
            ? detail
            : `Optimizer API error (${res.status})`,
        cause: detail,
      });
    }
    return text ? JSON.parse(text) : {};
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof TRPCError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new TRPCError({
        code: "TIMEOUT",
        message: `Optimizer backend timed out after ${timeoutMs / 1000}s`,
      });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: err instanceof Error ? err.message : "Optimizer proxy failed",
    });
  }
}

/** Minimal GeoJSON FeatureCollection for input validation. */
const geojsonFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.record(z.unknown())),
});

const optimizeInputSchema = z.object({
  geojson: geojsonFeatureCollectionSchema,
  start_lat: z.number().optional(),
  start_lon: z.number().optional(),
  oneway_mode: z.string().optional(),
  service_both_sides: z.boolean().optional(),
  road_classes: z.array(z.string()).optional(),
  turn_penalties: z
    .object({
      left_turn: z.number().optional(),
      u_turn: z.number().optional(),
      right_turn: z.number().optional(),
    })
    .optional(),
  clean_before_optimize: z.boolean().optional(),
  clean_options: z.record(z.unknown()).optional(),
});

const partitionRequestSchema = z.object({
  edges: z.array(
    z.object({
      u: z.number(),
      v: z.number(),
      length: z.number().optional(),
      intersection_density: z.number().optional(),
      cul_de_sac_penalty: z.number().optional(),
      width_penalty: z.number().optional(),
    }),
  ),
  node_count: z.number(),
  truck_count: z.number(),
  balance_metric: z.enum(["time", "distance"]),
});

const partitionFromGeoJSONSchema = z.object({
  geojson: geojsonFeatureCollectionSchema,
  truck_count: z.number(),
  balance_metric: z.enum(["time", "distance"]).optional(),
  clean_before_optimize: z.boolean().optional(),
  clean_options: z.record(z.unknown()).optional(),
});

const partitionFromPointsSchema = z.object({
  points: z.array(
    z.object({
      lat: z.number(),
      lon: z.number(),
      weight: z.number().optional(),
    }),
  ),
  truck_count: z.number(),
  balance_metric: z.enum(["count", "weight", "distance"]).optional(),
  knn_neighbors: z.number().optional(),
  include_polygons: z.boolean().optional(),
});

export const optimizerRouter = router({
  /** Chinese Postman route optimization on GeoJSON road data. */
  optimize: publicProcedure
    .input(optimizeInputSchema)
    .mutation(({ input }) => proxy("/api/optimize", input)),

  /** Partition a graph into truck zones (spectral clustering). */
  partition: publicProcedure
    .input(partitionRequestSchema)
    .mutation(({ input }) =>
      proxy("/api/zones/partition", input, PARTITION_TIMEOUT_MS),
    ),

  /** Partition road GeoJSON into zones. */
  partitionFromGeoJSON: publicProcedure
    .input(partitionFromGeoJSONSchema)
    .mutation(({ input }) =>
      proxy("/api/zones/partition-from-geojson", input, PARTITION_TIMEOUT_MS),
    ),

  /** Partition points (lat/lon/weight) into zones. */
  partitionFromPoints: publicProcedure
    .input(partitionFromPointsSchema)
    .mutation(({ input }) =>
      proxy("/api/zones/partition-from-points", input, PARTITION_TIMEOUT_MS),
    ),

  /** Health check for the Python optimizer backend. */
  health: publicProcedure.query(async () => {
    if (!OPTIMIZER_BACKEND_URL) {
      return { ok: false, status: "not_configured" as const };
    }
    try {
      const res = await fetch(`${OPTIMIZER_BACKEND_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json().catch(() => ({}));
      return {
        ok: res.ok && data?.status === "ok",
        status: (data?.status as string) ?? "unknown",
      };
    } catch {
      return { ok: false, status: "unreachable" as const };
    }
  }),
});
