/**
 * Unit tests for VRP solver shared utilities:
 * haversineKm, buildHaversineMatrix, clusterByZones,
 * orderClustersByStart, nearestNeighborRoute, twoOptImprove
 */
import { describe, it, expect } from "vitest";
import {
  haversineKm,
  buildHaversineMatrix,
  clusterByZones,
  orderClustersByStart,
  nearestNeighborRoute,
  twoOptImprove,
} from "../utils";
import type { VRPSolverStop } from "../types";

// A small set of stops roughly on a grid (depot + 4 stops)
const depot: VRPSolverStop = { lat: 45.5, lon: -73.5, label: "Depot" };
const stopA: VRPSolverStop = { lat: 45.51, lon: -73.5, label: "A" }; // ~1.1 km north
const stopB: VRPSolverStop = { lat: 45.5, lon: -73.49, label: "B" };  // ~0.7 km east
const stopC: VRPSolverStop = { lat: 45.49, lon: -73.5, label: "C" };  // ~1.1 km south
const stopD: VRPSolverStop = { lat: 45.5, lon: -73.51, label: "D" };  // ~0.7 km west
const locations: VRPSolverStop[] = [depot, stopA, stopB, stopC, stopD];

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(45.5, -73.5, 45.5, -73.5)).toBe(0);
  });

  it("returns a positive distance for distinct coordinates", () => {
    const d = haversineKm(45.5, -73.5, 45.51, -73.5);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(1.11, 1); // ~1.11 km per 0.01° lat
  });

  it("is symmetric", () => {
    const d1 = haversineKm(45.5, -73.5, 45.6, -73.6);
    const d2 = haversineKm(45.6, -73.6, 45.5, -73.5);
    expect(d1).toBeCloseTo(d2, 8);
  });

  it("matches known distance for 1° of longitude at equator (~111 km)", () => {
    const d = haversineKm(0, 0, 0, 1);
    expect(d).toBeCloseTo(111.19, 0);
  });
});

describe("buildHaversineMatrix", () => {
  it("builds an n×n matrix", () => {
    const matrix = buildHaversineMatrix(locations);
    expect(matrix).toHaveLength(locations.length);
    for (const row of matrix) {
      expect(row).toHaveLength(locations.length);
    }
  });

  it("diagonal entries are {distance:0, time:0}", () => {
    const matrix = buildHaversineMatrix(locations);
    for (let i = 0; i < locations.length; i++) {
      expect(matrix[i]![i]!.distance).toBe(0);
      expect(matrix[i]![i]!.time).toBe(0);
    }
  });

  it("is symmetric", () => {
    const matrix = buildHaversineMatrix(locations);
    for (let i = 0; i < locations.length; i++) {
      for (let j = 0; j < locations.length; j++) {
        expect(matrix[i]![j]!.distance).toBeCloseTo(matrix[j]![i]!.distance, 8);
      }
    }
  });

  it("time matches distance / 40 km/h in seconds", () => {
    const matrix = buildHaversineMatrix([depot, stopA]);
    const dist = matrix[0]![1]!.distance;
    const expectedTime = (dist / 40) * 3600;
    expect(matrix[0]![1]!.time).toBeCloseTo(expectedTime, 4);
  });
});

describe("clusterByZones", () => {
  it("returns each location as its own cluster when n <= numZones", () => {
    const clusters = clusterByZones(locations, 10);
    expect(clusters).toHaveLength(locations.length);
    clusters.forEach((c) => expect(c).toHaveLength(1));
  });

  it("returns the right total number of indices", () => {
    const clusters = clusterByZones(locations, 2);
    const allIndices = clusters.flat();
    expect(allIndices).toHaveLength(locations.length);
    // Each index appears exactly once
    const unique = new Set(allIndices);
    expect(unique.size).toBe(locations.length);
  });

  it("handles a single location", () => {
    const clusters = clusterByZones([depot], 1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toEqual([0]);
  });
});

describe("orderClustersByStart", () => {
  it("puts the cluster containing startIndex first", () => {
    const clusters = [[1, 2], [0, 3], [4]]; // cluster 1 contains index 0 (depot)
    const ordered = orderClustersByStart(clusters, locations, 0);
    expect(ordered[0]).toContain(0);
  });

  it("sorts remaining clusters by distance from start", () => {
    // Depot at index 0; stopA (idx 1) is north, stopC (idx 3) is south
    const clusters = [[1], [2], [3], [4]];
    const ordered = orderClustersByStart(clusters, locations, 0);
    // All clusters should still be present
    expect(ordered).toHaveLength(4);
    const allIndices = ordered.flat();
    expect(new Set(allIndices)).toEqual(new Set([1, 2, 3, 4]));
  });
});

describe("nearestNeighborRoute", () => {
  it("returns a single-element array when indices has one element", () => {
    const matrix = buildHaversineMatrix(locations);
    const route = nearestNeighborRoute(matrix, [0], 0);
    expect(route).toEqual([0]);
  });

  it("visits every provided index exactly once", () => {
    const matrix = buildHaversineMatrix(locations);
    const indices = [0, 1, 2, 3, 4];
    const route = nearestNeighborRoute(matrix, indices, 0);
    expect(route).toHaveLength(indices.length);
    expect(new Set(route)).toEqual(new Set(indices));
  });

  it("starts from the correct index", () => {
    const matrix = buildHaversineMatrix(locations);
    const route = nearestNeighborRoute(matrix, [0, 1, 2, 3], 2); // start at global index 2
    expect(route[0]).toBe(2);
  });
});

describe("twoOptImprove", () => {
  it("returns the same array for ≤3 nodes", () => {
    const matrix = buildHaversineMatrix([depot, stopA, stopB]);
    expect(twoOptImprove(matrix, [0])).toEqual([0]);
    expect(twoOptImprove(matrix, [0, 1])).toEqual([0, 1]);
    expect(twoOptImprove(matrix, [0, 1, 2])).toEqual([0, 1, 2]);
  });

  it("does not change a route that is already optimal", () => {
    // Build a straight line: depot → A → B → C
    const straight = [depot, stopA, stopB, stopC];
    const matrix = buildHaversineMatrix(straight);
    const route = [0, 1, 2, 3];
    const improved = twoOptImprove(matrix, route);
    // Total distance should not increase
    const distBefore = route.slice(0, -1).reduce(
      (s, _, i) => s + matrix[route[i]!]![route[i + 1]!]!.distance,
      0,
    );
    const distAfter = improved.slice(0, -1).reduce(
      (s, _, i) => s + matrix[improved[i]!]![improved[i + 1]!]!.distance,
      0,
    );
    expect(distAfter).toBeLessThanOrEqual(distBefore + 1e-6);
  });

  it("improves a known crossed route", () => {
    // 0→2→1→3 is crossed; 0→1→2→3 is shorter for a linear arrangement
    const linear = [
      { lat: 0, lon: 0, label: "0" },
      { lat: 0, lon: 1, label: "1" },
      { lat: 0, lon: 2, label: "2" },
      { lat: 0, lon: 3, label: "3" },
    ];
    const matrix = buildHaversineMatrix(linear);
    const crossed = [0, 2, 1, 3];
    const improved = twoOptImprove(matrix, crossed);
    const distCrossed = [0, 1, 2].reduce(
      (s, i) => s + matrix[crossed[i]!]![crossed[i + 1]!]!.distance,
      0,
    );
    const distImproved = [0, 1, 2].reduce(
      (s, i) => s + matrix[improved[i]!]![improved[i + 1]!]!.distance,
      0,
    );
    expect(distImproved).toBeLessThan(distCrossed);
  });
});
