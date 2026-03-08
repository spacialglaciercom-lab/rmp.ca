/**
 * Route optimization plugin: CPP and zone partitioning via backend (or fallback).
 * Use getPlugin('routeOptimization')?.getFeatures().routeOptimizer in the Planner
 * for swappable optimization (e.g. add alternative algorithms later).
 */

import type { Plugin, PluginContext } from "../types";
import { getPlugin } from "../registry";
import {
  optimizeRoute as backendOptimize,
  partitionZonesFromGeoJSON,
  type OptimizeRouteParams,
  type OptimizeResponse,
  type ZonesPartitionFromGeoJSONRequest,
  type ZonesPartitionResponse,
} from "@/services/overtureOptimizerService";

/** Max features per chunk when processing large GeoJSON (backend may still limit body size). */
const CHUNK_FEATURE_LIMIT = 5000;

/** Stored context set in initialize for getFeatures and optional weather integration. */
let pluginContext: PluginContext | null = null;

export const routeOptimizationPlugin: Plugin = {
  id: "routeOptimization",
  name: "Route Optimizer",
  description: "CPP, turn-aware optimization, Overture/OSM route generation, zone partitioning",
  version: "1.0.0",

  initialize(context: PluginContext) {
    pluginContext = context;
  },

  destroy() {
    pluginContext = null;
  },

  getFeatures() {

    return {
      /** Route optimizer feature: optimize GeoJSON road network (CPP). Optionally avoid rainy zones if weather plugin provides data. */
      routeOptimizer: {
        /**
         * Optimize route from road GeoJSON (Chinese Postman). Calls Python backend via proxy/direct URL.
         * For large GeoJSON, consider chunking (see chunkedOptimizer) or ensure backend timeout is sufficient.
         */
        optimizer: async (
          geojson: OptimizeRouteParams["geojson"],
          options?: Partial<Omit<OptimizeRouteParams, "geojson">>
        ): Promise<OptimizeResponse> => {
          const params: OptimizeRouteParams = { geojson, ...options };
          const weather = getPlugin("weather")?.getFeatures?.();
          const routeWeather = weather?.dataProviderForRoute as
            | ((opts: {
                bbox?: [number, number, number, number];
                coords?: Array<{ lat: number; lon: number }>;
              }) => Promise<{ avoidZones?: Array<Array<[number, number]>> }>)
            | undefined;
          if (routeWeather && typeof routeWeather === "function") {
            try {
              const bbox = bboxFromGeoJSON(geojson);
              const weatherData = await (routeWeather as (opts: any) => Promise<any>)({ bbox });
              if (weatherData?.avoidZones?.length) {
                (params as Record<string, unknown>)._weatherAvoidZones =
                  weatherData.avoidZones;
              }
            } catch {
              // Non-fatal: proceed without weather
            }
          }
          return backendOptimize(params);
        },

        /**
         * Partition road GeoJSON into zones (spectral clustering). Uses same backend as optimizer.
         */
        partitioner: async (
          zonesParams: ZonesPartitionFromGeoJSONRequest
        ): Promise<ZonesPartitionResponse> => {
          return partitionZonesFromGeoJSON(zonesParams);
        },

        /**
         * Process large GeoJSON in chunks and merge route points (order may be suboptimal across chunks).
         * Use when feature count exceeds CHUNK_FEATURE_LIMIT to avoid timeouts or payload limits.
         */
        chunkedOptimizer: async (
          geojson: OptimizeRouteParams["geojson"],
          options?: Partial<Omit<OptimizeRouteParams, "geojson">>
        ): Promise<OptimizeResponse> => {
          const features = geojson?.features ?? [];
          if (features.length <= CHUNK_FEATURE_LIMIT) {
            return backendOptimize({ geojson, ...options });
          }
          const chunks: OptimizeRouteParams["geojson"][] = [];
          for (let i = 0; i < features.length; i += CHUNK_FEATURE_LIMIT) {
            chunks.push({
              type: "FeatureCollection",
              features: features.slice(i, i + CHUNK_FEATURE_LIMIT),
            });
          }
          const results = await Promise.all(
            chunks.map((fc) => backendOptimize({ geojson: fc, ...options }))
          );
          const route: OptimizeResponse["route"] = [];
          let total_distance_km = 0;
          const stats = results[0]?.stats;
          for (const r of results) {
            route.push(...(r.route ?? []));
            total_distance_km += r.total_distance_km ?? 0;
          }
          return {
            route,
            route_geojson: {
              type: "FeatureCollection",
              features: results.flatMap((r) => r.route_geojson?.features ?? []),
            },
            total_distance_km,
            message: `Chunked (${chunks.length} chunks)`,
            stats: stats ?? ({} as OptimizeResponse["stats"]),
          };
        },
      },
    };
  },
};

function bboxFromGeoJSON(
  geojson: OptimizeRouteParams["geojson"]
): [number, number, number, number] | undefined {
  const features = geojson?.features ?? [];
  if (features.length === 0) return undefined;
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const f of features) {
    const g = (f as { geometry?: { type?: string; coordinates?: [number, number][] } }).geometry;
    if (!g || g.type !== "LineString") continue;
    const coords = g.coordinates ?? [];
    for (const c of coords) {
      const lon = c[0],
        lat = c[1];
      if (typeof lon === "number" && typeof lat === "number") {
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  if (minLon === Infinity) return undefined;
  return [minLon, minLat, maxLon, maxLat];
}
