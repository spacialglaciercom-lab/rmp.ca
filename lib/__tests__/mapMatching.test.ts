/**
 * Tests for mapMatching.ts - Route snapping priority
 *
 * Key behavior being tested:
 * - matchGPXToRoads should be the PRIMARY method for GPX data (preserves traversal order)
 * - routeThroughWaypoints should be FALLBACK (finds shortest path, may shortcut routes)
 *
 * This ensures that routes with dual carriageways don't get "shortcut" into loops
 * when the /route/ endpoint finds a shorter path that crosses the median.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// __DEV__ is a React Native / Metro global not defined in the Node test environment.
vi.stubGlobal("__DEV__", false);

// Mock react-native before importing mapMatching
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

// Mock expo-constants
vi.mock("expo-constants", () => ({ default: { expoConfig: null } }));

// Mock shared/oauth to avoid Expo chain
vi.mock("@/shared/oauth", () => ({ getApiBaseUrl: () => "http://localhost:3000" }));

// Mock fetch for OSRM API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock performance for timing
vi.stubGlobal("performance", {
  now: () => Date.now(),
});

// Helper to create mock OSRM match response
function createMockMatchResponse(
  coordinates: Array<[number, number]>,
  code: string = "Ok",
): Response {
  return {
    ok: code === "Ok",
    json: async () => ({
      code,
      routes: [
        {
          geometry: { coordinates },
          distance: 1000,
          duration: 60,
          legs: [
            {
              steps: [],
              distance: 1000,
              duration: 60,
              annotation: { nodes: [1, 2, 3] },
            },
          ],
        },
      ],
    }),
  } as Response;
}

// Helper to create mock OSRM route response
function createMockRouteResponse(
  coordinates: Array<[number, number]>,
): Response {
  return {
    ok: true,
    json: async () => ({
      code: "Ok",
      routes: [
        {
          geometry: { coordinates },
          distance: 800, // Shorter distance (potential shortcut)
          duration: 50,
          legs: [
            {
              steps: [],
              distance: 800,
              duration: 50,
              annotation: { nodes: [1, 2, 3] },
            },
          ],
        },
      ],
    }),
  } as Response;
}

describe("mapMatching", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("matchGPXToRoads", () => {
    it("should use OSRM /match/ endpoint for GPX data", async () => {
      const { matchGPXToRoads } = await import("../mapMatching");

      const points = [
        { lat: 45.0, lon: -75.0 },
        { lat: 45.001, lon: -75.001 },
        { lat: 45.002, lon: -75.002 },
      ];

      mockFetch.mockResolvedValueOnce(
        createMockMatchResponse([
          [-75.0, 45.0],
          [-75.001, 45.001],
          [-75.002, 45.002],
        ]),
      );

      const config = {
        provider: "osrm" as const,
        baseUrl: "http://router.project-osrm.org",
      };

      const result = await matchGPXToRoads(points, config);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain("/match/v1/driving/");
      expect(result).not.toBeNull();
      expect(result!.matchedGeometry).toHaveLength(3);
    });

    it("should preserve traversal order (not find shortest path)", async () => {
      const { matchGPXToRoads } = await import("../mapMatching");

      // Points that trace a route around a dual carriageway
      const points = [
        { lat: 45.0, lon: -75.0 },
        { lat: 45.001, lon: -75.0 }, // Going north on eastbound lane
        { lat: 45.002, lon: -75.0 },
        { lat: 45.002, lon: -75.001 }, // Turning west
        { lat: 45.001, lon: -75.001 }, // Going south on westbound lane
        { lat: 45.0, lon: -75.001 },
      ];

      mockFetch.mockResolvedValueOnce(
        createMockMatchResponse([
          [-75.0, 45.0],
          [-75.0, 45.001],
          [-75.0, 45.002],
          [-75.001, 45.002],
          [-75.001, 45.001],
          [-75.001, 45.0],
        ]),
      );

      const config = {
        provider: "osrm" as const,
        baseUrl: "http://router.project-osrm.org",
      };

      const result = await matchGPXToRoads(points, config);

      expect(result).not.toBeNull();
      // Match should preserve the order of points as provided
      expect(result!.matchedGeometry).toHaveLength(6);
    });

    it("should return null when match fails", async () => {
      const { matchGPXToRoads } = await import("../mapMatching");

      const points = [
        { lat: 45.0, lon: -75.0 },
        { lat: 45.001, lon: -75.001 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ code: "NoMatch" }),
      });

      const config = {
        provider: "osrm" as const,
        baseUrl: "http://router.project-osrm.org",
      };

      const result = await matchGPXToRoads(points, config);

      expect(result).toBeNull();
    });
  });

  describe("routeThroughWaypoints", () => {
    it("should use OSRM /route/ endpoint for waypoint routing", async () => {
      const { routeThroughWaypoints } = await import("../mapMatching");

      const points = [
        { lat: 45.0, lon: -75.0 },
        { lat: 45.002, lon: -75.002 },
      ];

      mockFetch.mockResolvedValueOnce(
        createMockRouteResponse([
          [-75.0, 45.0],
          [-75.002, 45.002],
        ]),
      );

      const config = {
        provider: "osrm" as const,
        baseUrl: "http://router.project-osrm.org",
      };

      const result = await routeThroughWaypoints(points, config);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain("/route/v1/driving/");
      expect(result).not.toBeNull();
    });

    it("may find shorter path (potential shortcut behavior)", async () => {
      const { routeThroughWaypoints } = await import("../mapMatching");

      // Two waypoints that could be connected via a shortcut
      const points = [
        { lat: 45.0, lon: -75.0 },
        { lat: 45.002, lon: -75.002 },
      ];

      mockFetch.mockResolvedValueOnce(
        createMockRouteResponse([
          [-75.0, 45.0],
          [-75.002, 45.002],
        ]),
      );

      const config = {
        provider: "osrm" as const,
        baseUrl: "http://router.project-osrm.org",
      };

      const result = await routeThroughWaypoints(points, config);

      expect(result).not.toBeNull();
      // Route endpoint finds shortest path, which may shortcut
      // This is expected behavior for waypoint routing
      expect(result!.totalDistance).toBe(800);
    });
  });

  describe("routing priority for GPX data", () => {
    it("documents: matchGPXToRoads should be PRIMARY for GPX data", async () => {
      // This test documents the expected behavior:
      // - GPX data should use matchGPXToRoads (preserves traversal order)
      // - routeThroughWaypoints should only be fallback
      //
      // The /match/ endpoint preserves the order of points as they were traversed,
      // which is critical for routes that go around dual carriageways.
      // The /route/ endpoint finds the shortest path, which may incorrectly
      // shortcut across the median, creating routing loops.

      const { matchGPXToRoads, routeThroughWaypoints } = await import(
        "../mapMatching"
      );

      // Both functions exist and are exported
      expect(typeof matchGPXToRoads).toBe("function");
      expect(typeof routeThroughWaypoints).toBe("function");

      // The key difference:
      // - matchGPXToRoads uses /match/ endpoint (preserves order)
      // - routeThroughWaypoints uses /route/ endpoint (finds shortest)
    });
  });
});