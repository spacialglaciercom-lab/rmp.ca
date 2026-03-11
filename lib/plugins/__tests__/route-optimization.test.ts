import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerPlugin, getPlugin, unloadPlugin } from "../registry";
import { routeOptimizationPlugin } from "../route-optimization";
import type { PluginContext } from "../types";

const mockOptimize = vi.fn();
const mockPartition = vi.fn();

vi.mock("@/services/overtureOptimizerService", () => ({
  optimizeRoute: (params: unknown) => mockOptimize(params),
  partitionZonesFromGeoJSON: (params: unknown) => mockPartition(params),
}));

const mockContext: PluginContext = {
  api: null,
  stores: {},
};

function smallGeoJSON() {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        properties: {},
      },
    ],
  };
}

function manyFeatures(count: number) {
  return {
    type: "FeatureCollection" as const,
    features: Array.from({ length: count }, (_, i) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [i * 0.01, i * 0.01],
          [i * 0.01 + 1, i * 0.01 + 1],
        ],
      },
      properties: {},
    })),
  };
}

describe("route-optimization plugin", () => {
  beforeEach(() => {
    unloadPlugin("routeOptimization");
    mockOptimize.mockReset();
    mockPartition.mockReset();
  });

  it("exposes routeOptimizer with optimizer, partitioner, chunkedOptimizer", () => {
    registerPlugin(routeOptimizationPlugin, mockContext);
    const plugin = getPlugin("routeOptimization");
    expect(plugin).toBeDefined();
    const features = plugin!.getFeatures();
    expect(features).toHaveProperty("routeOptimizer");
    const ro = (features as { routeOptimizer?: Record<string, unknown> })
      .routeOptimizer;
    expect(ro).toHaveProperty("optimizer");
    expect(ro).toHaveProperty("partitioner");
    expect(ro).toHaveProperty("chunkedOptimizer");
    expect(typeof ro!.optimizer).toBe("function");
    expect(typeof ro!.partitioner).toBe("function");
    expect(typeof ro!.chunkedOptimizer).toBe("function");
    unloadPlugin("routeOptimization");
  });

  it("optimizer calls backend and returns result", async () => {
    const geojson = smallGeoJSON();
    mockOptimize.mockResolvedValue({
      route: [
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 1 },
      ],
      total_distance_km: 1.5,
      message: "ok",
      stats: {},
      route_geojson: { type: "FeatureCollection", features: [] },
    });
    registerPlugin(routeOptimizationPlugin, mockContext);
    const ro = (
      getPlugin("routeOptimization")!.getFeatures() as {
        routeOptimizer: {
          optimizer: (g: unknown, o?: unknown) => Promise<unknown>;
        };
      }
    ).routeOptimizer;
    const result = await ro.optimizer(geojson, { clean_before_optimize: true });
    expect(mockOptimize).toHaveBeenCalledWith(
      expect.objectContaining({ geojson, clean_before_optimize: true }),
    );
    expect(result).toHaveProperty("route");
    expect(result).toHaveProperty("total_distance_km", 1.5);
    unloadPlugin("routeOptimization");
  });

  it("partitioner delegates to partitionZonesFromGeoJSON", async () => {
    mockPartition.mockResolvedValue({
      zones: [{ zone_id: 0, node_ids: [0, 1], estimated_time: 10 }],
    });
    registerPlugin(routeOptimizationPlugin, mockContext);
    const ro = (
      getPlugin("routeOptimization")!.getFeatures() as {
        routeOptimizer: { partitioner: (p: unknown) => Promise<unknown> };
      }
    ).routeOptimizer;
    const result = await ro.partitioner({
      geojson: smallGeoJSON(),
      truck_count: 1,
      balance_metric: "time",
    });
    expect(mockPartition).toHaveBeenCalledWith(
      expect.objectContaining({ truck_count: 1, balance_metric: "time" }),
    );
    expect(result).toHaveProperty("zones");
    unloadPlugin("routeOptimization");
  });

  it("chunkedOptimizer with small GeoJSON calls backend once", async () => {
    const geojson = smallGeoJSON();
    mockOptimize.mockResolvedValue({
      route: [
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 1 },
      ],
      total_distance_km: 1,
      message: "ok",
      stats: {},
      route_geojson: { type: "FeatureCollection", features: [] },
    });
    registerPlugin(routeOptimizationPlugin, mockContext);
    const ro = (
      getPlugin("routeOptimization")!.getFeatures() as {
        routeOptimizer: {
          chunkedOptimizer: (g: unknown, o?: unknown) => Promise<unknown>;
        };
      }
    ).routeOptimizer;
    await ro.chunkedOptimizer(geojson);
    expect(mockOptimize).toHaveBeenCalledTimes(1);
    unloadPlugin("routeOptimization");
  });

  it("chunkedOptimizer with many features splits into chunks and merges", async () => {
    const CHUNK_FEATURE_LIMIT = 5000;
    const geojson = manyFeatures(CHUNK_FEATURE_LIMIT + 100);
    mockOptimize.mockImplementation(
      (arg: { geojson: { features: unknown[] } }) =>
        Promise.resolve({
          route: arg.geojson.features
            .slice(0, 2)
            .map((_, i) => ({ latitude: i, longitude: i })),
          total_distance_km: 1,
          message: "ok",
          stats: {},
          route_geojson: { type: "FeatureCollection", features: [] },
        }),
    );
    registerPlugin(routeOptimizationPlugin, mockContext);
    const ro = (
      getPlugin("routeOptimization")!.getFeatures() as {
        routeOptimizer: {
          chunkedOptimizer: (
            g: unknown,
          ) => Promise<{ route: unknown[]; total_distance_km: number }>;
        };
      }
    ).routeOptimizer;
    const result = await ro.chunkedOptimizer(geojson);
    expect(mockOptimize).toHaveBeenCalledTimes(2);
    expect(result.route.length).toBeGreaterThan(0);
    expect(result.total_distance_km).toBe(2);
    unloadPlugin("routeOptimization");
  });
});
