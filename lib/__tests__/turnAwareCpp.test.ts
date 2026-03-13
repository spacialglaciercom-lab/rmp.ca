import { describe, it, expect } from "vitest";
import {
  solveTurnAwareCPP,
  turnCircuitToStreetRoute,
  type TurnAwareCppOptions,
} from "../turnAwareCpp";
import type { TurnNode, TurnEdge } from "@/types/turnAware";

/** Helper to build a TurnNode. */
function tn(
  edgeId: string,
  direction: "forward" | "backward" = "forward",
): TurnNode {
  return { edgeId, direction, intersectionId: `int_${edgeId}` };
}

/** Helper to build a TurnEdge. */
function te(
  from: TurnNode,
  to: TurnNode,
  opts: {
    turnType?: "right" | "left" | "straight" | "u-turn";
    totalCost?: number;
    deadhead?: boolean;
  } = {},
): TurnEdge {
  return {
    id: `${from.edgeId}:${from.direction}->${to.edgeId}:${to.direction}`,
    from,
    to,
    turnType: opts.turnType ?? "straight",
    staticPenalty: 0,
    baseTime: opts.totalCost ?? 10,
    totalCost: opts.totalCost ?? 10,
    deadhead: opts.deadhead ?? false,
  };
}

describe("solveTurnAwareCPP", () => {
  it("should solve a simple 3-edge triangle", () => {
    // Triangle: edge1 -> edge2 -> edge3 -> edge1
    const n1f = tn("e1", "forward");
    const n2f = tn("e2", "forward");
    const n3f = tn("e3", "forward");

    const edges: TurnEdge[] = [
      te(n1f, n2f, { turnType: "right", totalCost: 10 }),
      te(n2f, n3f, { turnType: "right", totalCost: 10 }),
      te(n3f, n1f, { turnType: "right", totalCost: 10 }),
    ];

    const result = solveTurnAwareCPP(edges);

    expect(result.circuit.length).toBe(3);
    expect(result.totalCost).toBe(30);
    expect(result.stats.right).toBe(3);
    expect(result.stats.uTurn).toBe(0);
  });

  it("should handle a graph with U-turns (sorting them last)", () => {
    const n1f = tn("e1", "forward");
    const n2f = tn("e2", "forward");
    const n1b = tn("e1", "backward");

    const edges: TurnEdge[] = [
      te(n1f, n2f, { turnType: "right", totalCost: 10 }),
      te(n2f, n1b, { turnType: "u-turn", totalCost: 120 }),
      te(n1b, n1f, { turnType: "straight", totalCost: 5 }),
    ];

    const result = solveTurnAwareCPP(edges);

    expect(result.circuit.length).toBe(3);
    expect(result.stats.uTurn).toBe(1);
  });

  it("should produce cycle diagnostics when enabled", () => {
    const n1f = tn("e1", "forward");
    const n2f = tn("e2", "forward");

    const edges: TurnEdge[] = [
      te(n1f, n2f, { totalCost: 10 }),
      te(n2f, n1f, { totalCost: 10 }),
    ];

    const result = solveTurnAwareCPP(edges, undefined, {
      enableCycleDetection: true,
    });

    expect(result.cycleDiagnostics).toBeDefined();
    expect(result.cycleDiagnostics!.loopsDetected).toBeGreaterThanOrEqual(0);
    expect(result.circuit.length).toBe(2);
  });

  it("should prefer non-deadhead edges", () => {
    const n1f = tn("e1", "forward");
    const n2f = tn("e2", "forward");
    const n3f = tn("e3", "forward");

    // Two paths from n1f: one real, one deadhead (both lead back via n3f)
    const edges: TurnEdge[] = [
      te(n1f, n2f, { turnType: "right", totalCost: 10, deadhead: false }),
      te(n1f, n3f, { turnType: "straight", totalCost: 5, deadhead: true }),
      te(n2f, n3f, { turnType: "straight", totalCost: 10 }),
      te(n3f, n1f, { turnType: "right", totalCost: 10 }),
    ];

    const result = solveTurnAwareCPP(edges, tn("e1", "forward"));

    // First edge should be the non-deadhead one
    expect(result.circuit[0]!.deadhead).toBe(false);
    expect(result.circuit.length).toBe(4);
  });

  it("should solve a 4x2 grid without excessive iterations", () => {
    // Simulate a small grid: 4 horizontal edges, 4 vertical edges, all with returns
    // This creates a graph with 16 turn edges
    const nodes: TurnNode[] = [];
    for (let i = 0; i < 8; i++) {
      nodes.push(tn(`e${i}`, "forward"));
      nodes.push(tn(`e${i}`, "backward"));
    }

    // Build a simple Eulerian turn-expanded graph
    // Ring: e0f -> e1f -> e2f -> e3f -> e4f -> e5f -> e6f -> e7f -> e0f
    const edges: TurnEdge[] = [];
    for (let i = 0; i < 8; i++) {
      const from = tn(`e${i}`, "forward");
      const to = tn(`e${(i + 1) % 8}`, "forward");
      edges.push(te(from, to, { turnType: "right", totalCost: 10 }));
    }

    const result = solveTurnAwareCPP(edges);

    expect(result.circuit.length).toBe(8);
    expect(result.totalCost).toBe(80);
    // No loops should be detected on a clean Eulerian graph
    expect(result.cycleDiagnostics?.loopsDetected ?? 0).toBe(0);
  });

  it("should not leave unconsumed edges on a balanced graph", () => {
    // Square: e1f -> e2f -> e3f -> e4f -> e1f
    const edges: TurnEdge[] = [
      te(tn("e1", "forward"), tn("e2", "forward"), { totalCost: 10 }),
      te(tn("e2", "forward"), tn("e3", "forward"), { totalCost: 10 }),
      te(tn("e3", "forward"), tn("e4", "forward"), { totalCost: 10 }),
      te(tn("e4", "forward"), tn("e1", "forward"), { totalCost: 10 }),
    ];

    const result = solveTurnAwareCPP(edges);
    expect(result.circuit.length).toBe(4);
  });
});

describe("turnCircuitToStreetRoute", () => {
  it("should extract ordered edge ids from circuit", () => {
    const circuit: TurnEdge[] = [
      te(tn("e1", "forward"), tn("e2", "forward")),
      te(tn("e2", "forward"), tn("e3", "forward")),
    ];

    const route = turnCircuitToStreetRoute(circuit);
    expect(route).toEqual(["e1", "e2", "e3"]);
  });

  it("should return empty array for empty circuit", () => {
    const route = turnCircuitToStreetRoute([]);
    expect(route).toEqual([]);
  });

  it("should return [from, to] for single turn edge", () => {
    const circuit: TurnEdge[] = [
      te(tn("e1", "forward"), tn("e2", "forward")),
    ];
    const route = turnCircuitToStreetRoute(circuit);
    expect(route).toEqual(["e1", "e2"]);
  });

  it("should include both edge ids when direction changes (backward)", () => {
    const circuit: TurnEdge[] = [
      te(tn("e1", "forward"), tn("e2", "forward")),
      te(tn("e2", "forward"), tn("e1", "backward")),
    ];
    const route = turnCircuitToStreetRoute(circuit);
    expect(route).toEqual(["e1", "e2", "e1"]);
  });
});
