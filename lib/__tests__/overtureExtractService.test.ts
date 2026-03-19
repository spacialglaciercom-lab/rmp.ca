/**
 * Unit tests for overtureExtractService cache-key discrimination.
 *
 * The cache key must be derived from the full polygon coordinates, not just the
 * bounding box. Two polygons that share the same bbox but differ in shape must
 * produce different cache keys so stale data is never returned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// expo-constants imports react-native (Flow-typed) which Rollup/Vite cannot parse.
// Stub it out at the module level before any import of overtureExtractService.
vi.mock("expo-constants", () => ({ default: { expoConfig: null } }));

// react-native uses syntax Rollup cannot parse (e.g. typeOf). Mock it so the extract
// service never loads the real module.
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

// shared/oauth pulls in expo-linking and react-native; mock it to avoid the Expo chain.
vi.mock("@/shared/oauth", () => ({ getApiBaseUrl: () => "http://localhost:3000" }));

// __DEV__ is a React Native / Metro global not defined in the Node test environment.
vi.stubGlobal("__DEV__", false);

// ---------------------------------------------------------------------------
// Minimal AsyncStorage mock (in-memory, synchronous resolution)
// ---------------------------------------------------------------------------
const store: Record<string, string> = {};
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => store[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
  },
}));

// ---------------------------------------------------------------------------
// WebSocket mock – always fires onopen then a "complete" message
// ---------------------------------------------------------------------------
const MOCK_GEOJSON = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [0, 0],
          [1, 1],
        ] as [number, number][],
      },
      properties: {},
    },
  ],
};

vi.stubGlobal(
  "WebSocket",
  vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.readyState = 1; // OPEN
    this.send = vi.fn();
    this.close = vi.fn();
    setTimeout(() => {
      (this.onopen as (() => void) | undefined)?.();
      setTimeout(() => {
        (this.onmessage as ((e: { data: string }) => void) | undefined)?.({
          data: JSON.stringify({
            stage: "complete",
            geojson_url: "/geojson/testhash",
            nodes: 2,
            edges: 1,
            segments: 1,
          }),
        });
      }, 0);
    }, 0);
  }),
);

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => null },
    json: async () => MOCK_GEOJSON,
  }),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePolygon(
  coords: [number, number][],
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords] },
    properties: {},
  };
}

// Two polygons with the *same* bounding box [-1,-1 → 1,1] but different shapes.
const RECTANGLE = makePolygon([
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
]);

const TRIANGLE = makePolygon([
  [-1, -1],
  [1, -1],
  [0, 1],
  [-1, -1],
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("extractOverture cache-key discrimination", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    vi.clearAllMocks();
  });

  it("rectangle and triangle with the same bbox produce different cache keys", async () => {
    const { extractOverture } = await import("../overtureExtractService");

    await extractOverture(RECTANGLE, "roads");
    await extractOverture(TRIANGLE, "roads");

    const { default: AsyncStorage } =
      await import("@react-native-async-storage/async-storage");
    const setCalls = vi.mocked(AsyncStorage.setItem).mock.calls;

    // Both results should have been cached under distinct keys
    expect(setCalls.length).toBe(2);
    const [key1] = setCalls[0];
    const [key2] = setCalls[1];
    expect(key1).not.toBe(key2);
  });

  it("identical polygon hits the cache on the second call", async () => {
    const { extractOverture } = await import("../overtureExtractService");

    await extractOverture(RECTANGLE, "roads");
    await extractOverture(RECTANGLE, "roads");

    const { default: AsyncStorage } =
      await import("@react-native-async-storage/async-storage");
    // Only one write – the second call should return from cache
    expect(vi.mocked(AsyncStorage.setItem).mock.calls.length).toBe(1);
  });

  it("same polygon, different theme, produces different cache keys", async () => {
    const { extractOverture } = await import("../overtureExtractService");

    await extractOverture(RECTANGLE, "roads");
    await extractOverture(RECTANGLE, "buildings");

    const { default: AsyncStorage } =
      await import("@react-native-async-storage/async-storage");
    const setCalls = vi.mocked(AsyncStorage.setItem).mock.calls;
    expect(setCalls.length).toBe(2);
    expect(setCalls[0][0]).not.toBe(setCalls[1][0]);
  });
});
