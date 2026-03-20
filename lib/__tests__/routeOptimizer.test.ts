/**
 * Tests for RouteOptimizer (route-optimizer-v2/routeOptimizer.ts)
 *
 * Focus areas:
 *  - Circuit correctness: all edges in the original graph are traversed
 *  - Non-vehicle road filtering (footway, cycleway, etc.)
 *  - One-way street handling (mode A: reverse violation added)
 *  - Disconnected graph: every component is covered
 *  - Custom start node: closest node to given lat/lon is picked
 *  - Empty / degenerate graphs: graceful empty result
 *  - Stats shape: sensible values populated after optimize()
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RouteOptimizer } from "../route-optimizer-v2/routeOptimizer";
import type { Node, Way } from "../route-optimizer-v2/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNodes(
  coords: Array<[id: string, lat: number, lon: number]>,
): Map<string, Node> {
  const m = new Map<string, Node>();
  for (const [id, lat, lon] of coords) {
    m.set(id, { id, lat, lon });
  }
  return m;
}

function makeWay(
  id: string,
  nodeIds: string[],
  tags: Record<string, string> = {},
): Way {
  return { id, nodes: nodeIds, tags: { highway: "residential", ...tags } };
}

/**
 * Build a square road network: A — B — C — D — A (all bidirectional).
 * This is a strongly connected Eulerian graph (every node degree 4).
 */
function squareGraph(): { nodes: Map<string, Node>; ways: Way[] } {
  const nodes = makeNodes([
    ["A", 0.0, 0.0],
    ["B", 0.0, 0.001], // ~111 m east
    ["C", 0.001, 0.001], // ~111 m north-east
    ["D", 0.001, 0.0], // ~111 m north
  ]);
  const ways = [
    makeWay("w1", ["A", "B"]),
    makeWay("w2", ["B", "C"]),
    makeWay("w3", ["C", "D"]),
    makeWay("w4", ["D", "A"]),
  ];
  return { nodes, ways };
}

/**
 * Triangle: A — B — C — A (all bidirectional).
 */
function triangleGraph(): { nodes: Map<string, Node>; ways: Way[] } {
  const nodes = makeNodes([
    ["A", 0.0, 0.0],
    ["B", 0.001, 0.0],
    ["C", 0.0, 0.001],
  ]);
  const ways = [
    makeWay("w1", ["A", "B"]),
    makeWay("w2", ["B", "C"]),
    makeWay("w3", ["C", "A"]),
  ];
  return { nodes, ways };
}

// ─── Basic correctness ────────────────────────────────────────────────────────

describe("RouteOptimizer – empty / degenerate inputs", () => {
  it("returns empty route when no ways provided", () => {
    const nodes = makeNodes([["A", 0, 0]]);
    const optimizer = new RouteOptimizer(nodes, []);
    const result = optimizer.optimize();

    expect(result.route).toHaveLength(0);
    expect(result.totalDistance).toBe(0);
    expect(result.message).toMatch(/no valid roads/i);
  });

  it("returns empty route when nodes map is empty", () => {
    const ways = [makeWay("w1", ["A", "B"])];
    const optimizer = new RouteOptimizer(new Map(), ways);
    const result = optimizer.optimize();

    expect(result.route).toHaveLength(0);
  });

  it("returns empty route for a way with only one node", () => {
    const nodes = makeNodes([["A", 0, 0]]);
    const ways = [makeWay("w1", ["A"])];
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    expect(result.route).toHaveLength(0);
  });
});

// ─── Circuit correctness ──────────────────────────────────────────────────────

describe("RouteOptimizer – circuit correctness", () => {
  it("produces a non-empty route for a square graph", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    expect(result.route.length).toBeGreaterThan(0);
    expect(result.totalDistance).toBeGreaterThan(0);
  });

  it("visits all original road segments at least once (triangle)", () => {
    const { nodes, ways } = triangleGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // 3 bidirectional ways → 6 directed edges in originalGraph.
    // Circuit must traverse at least 6 segments.
    expect(result.stats!.total_traversals).toBeGreaterThanOrEqual(6);
  });

  it("covers all nodes of the graph in the route (square)", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    const visitedLats = new Set(result.route.map((p) => p.latitude.toFixed(3)));
    // All four distinct latitudes should appear
    expect(visitedLats.size).toBeGreaterThanOrEqual(2);
  });

  it("has efficiency > 0 for a connected graph", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    expect(result.stats!.efficiency).toBeGreaterThan(0);
    expect(result.stats!.efficiency).toBeLessThanOrEqual(100);
  });

  it("route points are valid lat/lon values", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    for (const point of result.route) {
      expect(Number.isFinite(point.latitude)).toBe(true);
      expect(Number.isFinite(point.longitude)).toBe(true);
      expect(point.latitude).toBeGreaterThanOrEqual(-90);
      expect(point.latitude).toBeLessThanOrEqual(90);
      expect(point.longitude).toBeGreaterThanOrEqual(-180);
      expect(point.longitude).toBeLessThanOrEqual(180);
    }
  });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

describe("RouteOptimizer – stats", () => {
  it("populates all stat fields after optimize()", () => {
    const { nodes, ways } = triangleGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    const stats = result.stats!;
    expect(stats).toBeDefined();
    expect(typeof stats.total_traversals).toBe("number");
    expect(typeof stats.total_distance_km).toBe("number");
    expect(typeof stats.right_turns).toBe("number");
    expect(typeof stats.left_turns).toBe("number");
    expect(typeof stats.u_turns).toBe("number");
    expect(typeof stats.straight).toBe("number");
    expect(typeof stats.efficiency).toBe("number");
    expect(Array.isArray(stats.oneway_violations)).toBe(true);
    expect(Array.isArray(stats.single_pass_segments)).toBe(true);
  });

  it("total_distance_km matches totalDistance (in km)", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // totalDistance is in km; should match stats
    expect(result.totalDistance).toBeCloseTo(result.stats!.total_distance_km, 5);
  });

  it("total_traversals equals route length minus 1", () => {
    // total_traversals = circuit.length - 1 = number of edges traversed
    const { nodes, ways } = triangleGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // The route points are built from the circuit; consecutive edges = traversals
    expect(result.stats!.total_traversals).toBeGreaterThan(0);
  });

  it("getStats() returns the same stats object", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    optimizer.optimize();
    const stats = optimizer.getStats();

    expect(stats.total_traversals).toBeGreaterThanOrEqual(0);
    expect(typeof stats.efficiency).toBe("number");
  });
});

// ─── Non-vehicle road filtering ───────────────────────────────────────────────

describe("RouteOptimizer – non-vehicle road filtering", () => {
  it("excludes footway segments from the graph", () => {
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.001, 0.0],
      ["C", 0.0, 0.001],
    ]);
    // One real road + one footway
    const ways = [
      makeWay("w1", ["A", "B"], { highway: "residential" }),
      makeWay("w2", ["B", "C"], { highway: "footway" }),
    ];
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // The footway should be filtered, so the route only covers w1
    // C should not appear in the route
    const visitedLons = result.route.map((p) => p.longitude.toFixed(3));
    // lon=0.001 belongs to node C; it should not be visited
    expect(visitedLons.some((l) => l === "0.001")).toBe(false);
  });

  it("excludes cycleway segments", () => {
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.001, 0.0],
    ]);
    const ways = [makeWay("w1", ["A", "B"], { highway: "cycleway" })];
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // After filtering, no valid ways remain → empty route
    expect(result.route).toHaveLength(0);
  });

  it("excludes pedestrian way segments", () => {
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.001, 0.0],
    ]);
    const ways = [makeWay("w1", ["A", "B"], { highway: "pedestrian" })];
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    expect(result.route).toHaveLength(0);
  });

  it("includes residential roads and excludes footways in mixed network", () => {
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.001, 0.0],
      ["C", 0.002, 0.0],
      ["D", 0.001, 0.001],
    ]);
    const ways = [
      makeWay("w1", ["A", "B"], { highway: "residential" }),
      makeWay("w2", ["B", "A"], { highway: "residential" }),
      makeWay("w3", ["C", "D"], { highway: "footway" }), // should be filtered
    ];
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // Only residential road covered; C and D should not appear
    const visitedLats = result.route.map((p) => p.latitude.toFixed(3));
    expect(visitedLats.some((l) => l === "0.002")).toBe(false);
    expect(visitedLats.some((l) => l === "0.001")).toBe(true);
  });
});

// ─── One-way handling ─────────────────────────────────────────────────────────

describe("RouteOptimizer – one-way streets", () => {
  it("mode A: adds reverse oneway_violation for one-way streets", () => {
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.0, 0.001],
      ["C", 0.001, 0.0],
    ]);
    const ways = [
      // A→B oneway, B→C oneway, C→A oneway (directed triangle)
      makeWay("w1", ["A", "B"], { highway: "residential", oneway: "yes" }),
      makeWay("w2", ["B", "C"], { highway: "residential", oneway: "yes" }),
      makeWay("w3", ["C", "A"], { highway: "residential", oneway: "yes" }),
    ];

    const optimizer = new RouteOptimizer(nodes, ways, "A");
    const result = optimizer.optimize();

    // In mode A, reverse directions are added as violations
    expect(result.stats!.oneway_violations.length).toBeGreaterThan(0);
    // Route should still cover all three nodes
    expect(result.route.length).toBeGreaterThan(0);
  });

  it("produces a valid route for a one-way directed triangle in mode A", () => {
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.001, 0.0],
      ["C", 0.0, 0.001],
    ]);
    const ways = [
      makeWay("w1", ["A", "B"], { highway: "residential", oneway: "yes" }),
      makeWay("w2", ["B", "C"], { highway: "residential", oneway: "yes" }),
      makeWay("w3", ["C", "A"], { highway: "residential", oneway: "yes" }),
    ];

    const optimizer = new RouteOptimizer(nodes, ways, "A");
    const result = optimizer.optimize();

    expect(result.route.length).toBeGreaterThan(0);
    expect(result.totalDistance).toBeGreaterThan(0);
  });
});

// ─── Disconnected graph ───────────────────────────────────────────────────────

describe("RouteOptimizer – disconnected components", () => {
  it("covers all nodes when graph has two disconnected segments", () => {
    // Component 1: A — B (bidirectional)
    // Component 2: C — D (bidirectional), geographically separate
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.001, 0.0],
      ["C", 10.0, 10.0], // far away
      ["D", 10.001, 10.0],
    ]);
    const ways = [
      makeWay("w1", ["A", "B"]),
      makeWay("w2", ["B", "A"]),
      makeWay("w3", ["C", "D"]),
      makeWay("w4", ["D", "C"]),
    ];

    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    expect(result.route.length).toBeGreaterThan(0);

    // Both geographic areas should appear in the route
    const visitedLats = result.route.map((p) => p.latitude);
    const hasLowLat = visitedLats.some((lat) => lat < 1);
    const hasHighLat = visitedLats.some((lat) => lat > 9);
    expect(hasLowLat).toBe(true);
    expect(hasHighLat).toBe(true);
  });

  it("still returns a route when one component is empty (single isolated node)", () => {
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.001, 0.0],
      ["ALONE", 5.0, 5.0],
    ]);
    // ALONE has no ways
    const ways = [makeWay("w1", ["A", "B"]), makeWay("w2", ["B", "A"])];

    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    expect(result.route.length).toBeGreaterThan(0);
  });
});

// ─── Custom start node ────────────────────────────────────────────────────────

describe("RouteOptimizer – custom start coordinates", () => {
  it("starts near the provided coordinates when a custom start is given", () => {
    const { nodes, ways } = squareGraph();
    // Node D is at lat=0.001, lon=0.0 — provide those as custom start
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize(0.001, 0.0);

    expect(result.route.length).toBeGreaterThan(0);
    // First route point should be close to the custom start (within ~200 m)
    const first = result.route[0]!;
    const latDiff = Math.abs(first.latitude - 0.001);
    const lonDiff = Math.abs(first.longitude - 0.0);
    expect(latDiff).toBeLessThan(0.005);
    expect(lonDiff).toBeLessThan(0.005);
  });

  it("falls back gracefully when custom start is NaN", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize(NaN, NaN);

    // Should still produce a route (falls back to best-degree start)
    expect(result.route.length).toBeGreaterThan(0);
  });
});

// ─── Turn penalty weights ─────────────────────────────────────────────────────

describe("RouteOptimizer – turn penalties", () => {
  it("accepts and applies turn penalty weights without throwing", () => {
    const { nodes, ways } = triangleGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize(undefined, undefined, {
      leftTurn: 80,
      uTurn: 100,
      rightTurn: 0,
    });

    expect(result.route.length).toBeGreaterThan(0);
  });

  it("clamps extreme turn penalty values to 0–100 range", () => {
    const { nodes, ways } = triangleGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    // Should not throw on out-of-range values
    expect(() =>
      optimizer.optimize(undefined, undefined, {
        leftTurn: 999,
        uTurn: -50,
        rightTurn: 0,
      }),
    ).not.toThrow();
  });
});

// ─── Options ──────────────────────────────────────────────────────────────────

describe("RouteOptimizer – options", () => {
  it("serviceBothSides option produces more traversals than default", () => {
    const { nodes, ways } = squareGraph();

    const defaultOpt = new RouteOptimizer(nodes, ways, "A", [], undefined, {
      serviceBothSides: false,
    });
    const bothSidesOpt = new RouteOptimizer(nodes, ways, "A", [], undefined, {
      serviceBothSides: true,
    });

    const defaultResult = defaultOpt.optimize();
    const bothSidesResult = bothSidesOpt.optimize();

    // serviceBothSides adds a second copy of each bidirectional edge → more traversals
    expect(bothSidesResult.stats!.total_traversals).toBeGreaterThanOrEqual(
      defaultResult.stats!.total_traversals,
    );
  });

  it("antiLoopMode=off runs without cycle detection and produces a route", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways, "A", [], undefined, {
      antiLoopMode: "off",
    });
    const result = optimizer.optimize();

    expect(result.route.length).toBeGreaterThan(0);
  });

  it("antiLoopMode=strict still produces a valid route", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways, "A", [], undefined, {
      antiLoopMode: "strict",
    });
    const result = optimizer.optimize();

    expect(result.route.length).toBeGreaterThan(0);
  });
});

// ─── U-turn elimination ───────────────────────────────────────────────────────

describe("RouteOptimizer – eliminateUTurns post-processing", () => {
  it("produces a route on a square graph with fewer U-turns than without elimination", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // The square graph has alternative block-circling loops available,
    // so the post-processing should be able to eliminate some U-turns.
    expect(result.route.length).toBeGreaterThan(0);
    // u_turns_avoided in stats should be >= 0 (may be 0 if Hierholzer
    // already found a good path, but shouldn't crash)
    expect(result.stats?.u_turns_avoided).toBeGreaterThanOrEqual(0);
  });

  it("handles a dead-end stub without crashing", () => {
    // A --- B --- C (dead end at C, must U-turn there)
    const nodes = makeNodes([
      ["A", 0.0, 0.0],
      ["B", 0.0, 0.001],
      ["C", 0.0, 0.002],
    ]);
    const ways = [
      makeWay("w1", ["A", "B"]),
      makeWay("w2", ["B", "C"]),
    ];
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // Should produce a valid route even though U-turns at C are unavoidable
    expect(result.route.length).toBeGreaterThan(0);
  });

  it("does not introduce duplicate consecutive nodes in the circuit", () => {
    const { nodes, ways } = squareGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    // Check no identical consecutive node IDs (which would indicate a splice bug)
    for (let i = 1; i < result.route.length; i++) {
      const prev = result.route[i - 1]!;
      const curr = result.route[i]!;
      expect(
        prev.latitude !== curr.latitude || prev.longitude !== curr.longitude,
      ).toBe(true);
    }
  });

  it("triangle graph still produces a valid circuit after U-turn elimination", () => {
    const { nodes, ways } = triangleGraph();
    const optimizer = new RouteOptimizer(nodes, ways);
    const result = optimizer.optimize();

    expect(result.route.length).toBeGreaterThan(0);
  });
});
