/**
 * Tests for the native-dispatch layer in routeSolverLocal.
 *
 * Vitest always runs with Platform.OS === "web" (see vitest.config.ts stub)
 * so the native optimizer is never reachable here.  These tests verify that:
 *   1. the public solveLocal API still behaves identically on web, and
 *   2. the @/modules/route-optimizer public surface is stable enough to
 *      be consumed from TypeScript call sites without breaking.
 */
import { describe, it, expect, vi } from "vitest";
import { solveLocal } from "../routeSolverLocal";
import type { SolverPoint } from "../routeSolverLocal";
import * as routeOptimizerModule from "@/modules/route-optimizer";

// Re-mock react-native to assert the platform guard path explicitly.
vi.mock("react-native", () => ({ Platform: { OS: "web" as const } }));

const pts: SolverPoint[] = [
  { id: "a", lat: 45.0, lon: -73.0 },
  { id: "b", lat: 45.1, lon: -73.0 },
  { id: "c", lat: 45.1, lon: -73.1 },
  { id: "d", lat: 45.0, lon: -73.1 },
];

describe("route-optimizer public module surface", () => {
  it("exports isNativeAvailable()", () => {
    expect(typeof routeOptimizerModule.isNativeAvailable).toBe("function");
  });

  it("reports isNativeAvailable() === false on web/Node", () => {
    expect(routeOptimizerModule.isNativeAvailable()).toBe(false);
  });

  it("exports a default module object", () => {
    expect(routeOptimizerModule.default).toBeDefined();
  });
});

describe("solveLocal falls back to TypeScript on web", () => {
  it("produces a 2-opt result that visits every stop exactly once", async () => {
    const result = await solveLocal(pts, { algorithm: "2-opt" });
    const ids = result.orderedPoints.map((p) => p.id).sort();
    expect(ids).toEqual(["a", "b", "c", "d"]);
    expect(result.algorithm).toBe("2-opt");
  });

  it("nearest-neighbor path works without the native module", async () => {
    const result = await solveLocal(pts, { algorithm: "nearest-neighbor" });
    expect(result.orderedPoints).toHaveLength(4);
    expect(result.algorithm).toBe("nearest-neighbor");
  });

  it("totalDistance matches sum of segment distances", async () => {
    const result = await solveLocal(pts);
    const segTotal = result.segments.reduce((s, seg) => s + seg.distance, 0);
    expect(result.totalDistance).toBeCloseTo(segTotal, 5);
  });
});
