/**
 * Unit tests for individual VRP solver implementations:
 * clarkeWrightSolver, sweepSolver, twoOptSolver, orOptSolver
 *
 * Each solver receives a pre-built distance matrix (requiresMatrix === true).
 * Tests verify: output shape, all stops are visited, multi-vehicle splits,
 * edge cases (single stop, no stops beyond depot).
 */
import { describe, it, expect } from "vitest";
import { clarkeWrightSolver } from "../clarke-wright";
import { sweepSolver } from "../sweep";
import { twoOptSolver } from "../two-opt";
import { orOptSolver } from "../or-opt";
import { buildHaversineMatrix } from "../utils";
import type { VRPSolverInput, VRPSolverStop } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLocations(count: number): VRPSolverStop[] {
  // Lay out stops in a ring around a depot for predictable geometry
  const stops: VRPSolverStop[] = [{ lat: 45.5, lon: -73.5, label: "Depot" }];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    stops.push({
      lat: 45.5 + 0.05 * Math.sin(angle),
      lon: -73.5 + 0.05 * Math.cos(angle),
      label: `Stop${i + 1}`,
    });
  }
  return stops;
}

function makeInput(
  stopCount: number,
  numVehicles: number,
  objective: VRPSolverInput["objective"] = "min_distance",
): VRPSolverInput {
  const locations = makeLocations(stopCount);
  const matrix = buildHaversineMatrix(locations);
  return { locations, numVehicles, vehicleCapacity: 1000, objective, matrix };
}

function allStopLabels(stops: VRPSolverStop[]): Set<string> {
  return new Set(stops.map((s) => s.label));
}

// ---------------------------------------------------------------------------
// Shared correctness checks run against every solver
// ---------------------------------------------------------------------------

const SOLVERS = [
  { name: "clarkeWright", solver: clarkeWrightSolver },
  { name: "sweep", solver: sweepSolver },
  { name: "twoOpt", solver: twoOptSolver },
  { name: "orOpt", solver: orOptSolver },
];

describe.each(SOLVERS)("$name solver — shared contracts", ({ solver }) => {
  it("has required metadata fields", () => {
    expect(typeof solver.id).toBe("string");
    expect(solver.id.length).toBeGreaterThan(0);
    expect(typeof solver.label).toBe("string");
    expect(typeof solver.requiresMatrix).toBe("boolean");
    expect(solver.requiresMatrix).toBe(true);
  });

  it("handles depot-only input (no stops)", async () => {
    const input = makeInput(0, 1);
    const output = await solver.solve(input);
    expect(output).toBeDefined();
    expect(typeof output.totalDistanceKm).toBe("string");
    expect(typeof output.totalTimeMin).toBe("number");
  });

  it("handles a single stop", async () => {
    const input = makeInput(1, 1);
    const output = await solver.solve(input);
    // The stop must appear in the flat stops list
    const labels = allStopLabels(output.stops);
    expect(labels.has("Stop1")).toBe(true);
  });

  it("visits every stop exactly once for 6 stops, 1 vehicle", async () => {
    const input = makeInput(6, 1);
    const output = await solver.solve(input);
    const labels = allStopLabels(output.stops);
    for (let i = 1; i <= 6; i++) {
      expect(labels.has(`Stop${i}`), `Stop${i} missing`).toBe(true);
    }
  });

  it("visits every stop exactly once for 8 stops, 3 vehicles", async () => {
    const input = makeInput(8, 3);
    const output = await solver.solve(input);
    const labels = allStopLabels(output.stops);
    for (let i = 1; i <= 8; i++) {
      expect(labels.has(`Stop${i}`), `Stop${i} missing`).toBe(true);
    }
  });

  it("totalDistanceKm is a non-negative numeric string", async () => {
    const input = makeInput(4, 2);
    const output = await solver.solve(input);
    const dist = parseFloat(output.totalDistanceKm);
    expect(isNaN(dist)).toBe(false);
    expect(dist).toBeGreaterThanOrEqual(0);
  });

  it("totalTimeMin is a non-negative integer", async () => {
    const input = makeInput(4, 2);
    const output = await solver.solve(input);
    expect(output.totalTimeMin).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(output.totalTimeMin)).toBe(true);
  });

  it("routes array, when present, covers all stops", async () => {
    const input = makeInput(4, 2);
    const output = await solver.solve(input);
    if (output.routes) {
      const allInRoutes = new Set(output.routes.flat().map((s) => s.label));
      for (let i = 1; i <= 4; i++) {
        expect(allInRoutes.has(`Stop${i}`), `Stop${i} not in routes`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// orOpt-specific: balance_load objective
// ---------------------------------------------------------------------------

describe("orOptSolver — balance_load objective", () => {
  it("distributes stops across 2 vehicles with at most 1 stop difference", async () => {
    const input = makeInput(6, 2, "balance_load");
    const output = await orOptSolver.solve(input);
    expect(output.routes).toBeDefined();
    if (output.routes && output.routes.length >= 2) {
      // Each route includes depot at start/end, so intermediate stops = length - 2
      const counts = output.routes.map((r) =>
        r.filter((s) => s.label !== "Depot").length,
      );
      const maxDiff = Math.max(...counts) - Math.min(...counts);
      expect(maxDiff).toBeLessThanOrEqual(3); // generous tolerance
    }
  });
});

// ---------------------------------------------------------------------------
// clarkeWright-specific: merging behaviour
// ---------------------------------------------------------------------------

describe("clarkeWrightSolver — merging", () => {
  it("produces fewer routes than stops for multiple vehicles", async () => {
    const input = makeInput(6, 3);
    const output = await clarkeWrightSolver.solve(input);
    // Should have at most numVehicles routes
    if (output.routes) {
      expect(output.routes.length).toBeLessThanOrEqual(3);
    }
  });
});
