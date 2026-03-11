/**
 * Overture extraction plugin tests.
 * Mocks the extraction service to verify plugin API and GeoJSON output shape.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerPlugin, getPlugin, unloadPlugin } from "../registry";
import type { PluginContext } from "../types";

const mockContext: PluginContext = {
  api: null,
  stores: {},
};

const mockGeoJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-73.5, 45.5],
          [-73.51, 45.51],
        ],
      },
      properties: { class: "residential" },
    },
  ],
};

vi.mock("@/lib/overtureExtractService", () => ({
  extractOverture: vi.fn().mockResolvedValue({
    geojson: mockGeoJSON,
    stats: { points: 2, roads: 1, nodes: 2, edges: 1 },
    warnings: [],
  }),
}));

describe("overture-extraction plugin", () => {
  beforeEach(async () => {
    unloadPlugin("overture-extraction");
    vi.clearAllMocks();
    const { overtureExtractionPlugin } = await import("../overture-extraction");
    registerPlugin(overtureExtractionPlugin, mockContext);
  });

  it("exposes getFeatures().extractor and getFeatures().extractService", () => {
    const plugin = getPlugin("overture-extraction");
    expect(plugin).toBeDefined();
    const features = plugin!.getFeatures();
    expect(features.extractor).toBeDefined();
    expect(typeof features.extractor).toBe("function");
    expect(features.extractService).toBeDefined();
    expect(features.extractService.extractor).toBe(features.extractor);
  });

  it("extractor returns GeoJSON FeatureCollection and warnings", async () => {
    const plugin = getPlugin("overture-extraction");
    const extractor = plugin!.getFeatures().extractor as (
      polygon: GeoJSON.Feature<GeoJSON.Polygon>,
      theme?: string,
    ) => Promise<{
      geojson: GeoJSON.FeatureCollection;
      stats?: unknown;
      warnings: string[];
    }>;

    const polygon: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-73.6, 45.4],
            [-73.4, 45.4],
            [-73.4, 45.6],
            [-73.6, 45.6],
            [-73.6, 45.4],
          ],
        ],
      },
      properties: {},
    };

    const result = await extractor(polygon, "roads");

    expect(result).toHaveProperty("geojson");
    expect(result.geojson.type).toBe("FeatureCollection");
    expect(Array.isArray(result.geojson.features)).toBe(true);
    expect(result.geojson.features!.length).toBeGreaterThan(0);
    expect(result.geojson.features![0].geometry.type).toBe("LineString");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.stats).toMatchObject({ roads: 1, nodes: 2, edges: 1 });
  });

  it("extractor with invalid-feature response includes warnings", async () => {
    const { extractOverture } = await import("@/lib/overtureExtractService");
    vi.mocked(extractOverture).mockResolvedValueOnce({
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: {},
          },
          // Invalid: no geometry
          { type: "Feature", geometry: null as any, properties: {} },
        ],
      },
      stats: undefined,
      warnings: [
        "1 invalid feature(s) (50%) — check CRS (expected EPSG:4326) and geometry validity.",
      ],
    });

    const plugin = getPlugin("overture-extraction");
    const extractor = plugin!.getFeatures().extractor as (
      polygon: GeoJSON.Feature<GeoJSON.Polygon>,
      theme?: string,
    ) => Promise<{ geojson: GeoJSON.FeatureCollection; warnings: string[] }>;

    const polygon: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-73.6, 45.4],
            [-73.4, 45.4],
            [-73.4, 45.6],
            [-73.6, 45.6],
            [-73.6, 45.4],
          ],
        ],
      },
      properties: {},
    };

    const result = await extractor(polygon);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.geojson.type).toBe("FeatureCollection");
  });
});
