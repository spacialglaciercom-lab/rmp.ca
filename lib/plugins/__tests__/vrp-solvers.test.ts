/**
 * Tests for VRP solver plugin and registry: dynamic registration, getSolverList, getAlgorithmOptions.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/shared/oauth", () => ({ getApiBaseUrl: () => "http://test" }));

import {
  registerSolver,
  unregisterSolver,
  getSolver,
  getSolverList,
  getAlgorithmOptions,
  setSolverListConfig,
  VRP_SOLVER_LIST,
} from "@/lib/vrp-solvers";
import type { VRPSolver, VRPSolverInput, VRPSolverOutput } from "@/lib/vrp-solvers";

const mockSolver: VRPSolver = {
  id: "test-custom-solver",
  label: "Test Custom Solver",
  requiresMatrix: true,
  async solve(_input: VRPSolverInput): Promise<VRPSolverOutput> {
    return {
      stops: [],
      totalDistanceKm: "0",
      totalTimeMin: 0,
    };
  },
};

describe("vrp-solvers registry", () => {
  beforeEach(() => {
    setSolverListConfig(null);
    unregisterSolver("test-custom-solver");
  });

  it("getSolverList returns built-in solvers by default", () => {
    const list = getSolverList();
    expect(list.length).toBeGreaterThanOrEqual(VRP_SOLVER_LIST.length);
    const ids = list.map((s) => s.id);
    expect(ids).toContain("clarke_wright");
    expect(ids).toContain("ortools");
  });

  it("registerSolver adds a custom solver and getSolver returns it", () => {
    registerSolver(mockSolver);
    const solver = getSolver("test-custom-solver");
    expect(solver).toBe(mockSolver);
    expect(solver.id).toBe("test-custom-solver");
    expect(solver.label).toBe("Test Custom Solver");
  });

  it("getSolverList includes custom solver after registration", () => {
    registerSolver(mockSolver);
    const list = getSolverList();
    const ids = list.map((s) => s.id);
    expect(ids).toContain("test-custom-solver");
  });

  it("getAlgorithmOptions includes custom solver", () => {
    registerSolver(mockSolver);
    const opts = getAlgorithmOptions();
    const found = opts.find((o) => o.value === "test-custom-solver");
    expect(found).toEqual({ value: "test-custom-solver", label: "Test Custom Solver" });
  });

  it("unregisterSolver removes custom solver but not built-ins", () => {
    registerSolver(mockSolver);
    const removed = unregisterSolver("test-custom-solver");
    expect(removed).toBe(true);
    const list = getSolverList();
    expect(list.map((s) => s.id)).not.toContain("test-custom-solver");
    const builtInRemoved = unregisterSolver("clarke_wright");
    expect(builtInRemoved).toBe(false);
    expect(getSolver("clarke_wright")).toBeDefined();
  });

  it("getSolver returns default solver for unknown id", () => {
    const solver = getSolver("nonexistent-id");
    expect(solver).toBeDefined();
    expect(solver.id).toBe("default");
  });
});
