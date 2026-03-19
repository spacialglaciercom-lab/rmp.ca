/**
 * Tests for the weather plugin: registration, getFeatures shape, and dataProviderForRoute.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerPlugin, getPlugin, unloadPlugin } from "../registry";
import { weatherPlugin } from "../weather";
import type { PluginContext } from "../types";

const mockAddLayer = vi.fn();
const mockRemoveLayer = vi.fn();

vi.mock("@/stores/mapLayerStore", () => ({
  useMapLayerStore: {
    getState: () => ({ addLayer: mockAddLayer, removeLayer: mockRemoveLayer }),
  },
}));

const mockFetchWeather = vi.fn();
vi.mock("../weather/fetchWeather", () => ({
  fetchWeather: (lat: number, lon: number) => mockFetchWeather(lat, lon),
}));

const mockContext: PluginContext = {
  api: null,
  stores: {
    mapLayer: { addLayer: vi.fn(), removeLayer: vi.fn() },
  },
};

describe("weather plugin", () => {
  beforeEach(() => {
    unloadPlugin("weather");
    mockAddLayer.mockClear();
    mockRemoveLayer.mockClear();
    mockFetchWeather.mockReset();
  });

  it("registers and is retrievable from registry", () => {
    registerPlugin(weatherPlugin, mockContext);
    expect(getPlugin("weather")).toBe(weatherPlugin);
    unloadPlugin("weather");
    expect(getPlugin("weather")).toBeUndefined();
  });

  it("initialize calls mapLayer.addLayer with weather overlay", () => {
    registerPlugin(weatherPlugin, mockContext);
    expect(mockContext.stores.mapLayer?.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "weather-overlay",
        name: "Weather",
        type: "overlay",
        category: "collection",
      }),
    );
    unloadPlugin("weather");
  });

  it("getFeatures returns dataProvider, dataProviderForRoute, widget, mapOverlay", () => {
    registerPlugin(weatherPlugin, mockContext);
    const plugin = getPlugin("weather");
    expect(plugin).toBeDefined();
    const features = plugin!.getFeatures();
    expect(features).toHaveProperty("dataProvider");
    expect(features).toHaveProperty("dataProviderForRoute");
    expect(features).toHaveProperty("widget");
    expect(features).toHaveProperty("mapOverlay");
    expect(typeof features.dataProvider).toBe("function");
    expect(typeof features.dataProviderForRoute).toBe("function");
    unloadPlugin("weather");
  });

  it("dataProviderForRoute with no bbox or coords returns empty avoidZones", async () => {
    registerPlugin(weatherPlugin, mockContext);
    const features = getPlugin("weather")!.getFeatures() as {
      dataProviderForRoute: (opts: {
        bbox?: [number, number, number, number];
        coords?: Array<{ lat: number; lon: number }>;
      }) => Promise<{ avoidZones?: Array<Array<[number, number]>> }>;
    };
    const result = await features.dataProviderForRoute({});
    expect(result).toEqual({ avoidZones: [] });
    const resultCoords = await features.dataProviderForRoute({ coords: [] });
    expect(resultCoords).toEqual({ avoidZones: [] });
    unloadPlugin("weather");
  });

  it("dataProviderForRoute with bbox samples points and returns avoidZones when rain", async () => {
    mockFetchWeather.mockResolvedValue({
      source: "openweather",
      data: { rain1h: 1 },
    } as any);
    registerPlugin(weatherPlugin, mockContext);
    const features = getPlugin("weather")!.getFeatures() as {
      dataProviderForRoute: (opts: {
        bbox: [number, number, number, number];
      }) => Promise<{ avoidZones?: Array<Array<[number, number]>> }>;
    };
    const result = await features.dataProviderForRoute({
      bbox: [-73.6, 45.4, -73.4, 45.6],
    });
    expect(mockFetchWeather.mock.calls.length).toBeGreaterThan(0);
    expect(result.avoidZones).toBeDefined();
    expect(Array.isArray(result.avoidZones)).toBe(true);
    expect(result.avoidZones!.length).toBeGreaterThan(0);
    unloadPlugin("weather");
  });
});
