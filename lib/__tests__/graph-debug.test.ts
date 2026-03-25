/**
 * Graph Debug Test - Exposes graph construction and loop detection
 * 
 * Run with: pnpm test lib/__tests__/graph-debug.test.ts
 * 
 * This test creates synthetic graphs with known loop patterns
 * to verify the debugging utilities work correctly.
 */

import { describe, it, expect } from "vitest";
import {
  snapshotGraph,
  createTraversalTracer,
  analyzeEdgePatterns,
  printGraphSummary,
  printTraversalTrace,
  type AdjGraph,
  type AdjEntry,
} from "../route-optimizer-v2/graph-debug";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeEdge(from: string, to: string, edgeId: string, length = 100): AdjEntry {
  return {
    target: to,
    edgeId,
    data: {
      length,
      oneway: false,
      wayId: `way_${from}_${to}`,
    },
  };
}

function makeGraph(edges: Array<[string, string, string]>): AdjGraph {
  const graph: AdjGraph = new Map();
  for (const [from, to, edgeId] of edges) {
    let list = graph.get(from);
    if (!list) {
      list = [];
      graph.set(from, list);
    }
    list.push(makeEdge(from, to, edgeId));
  }
  return graph;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("graph-debug utilities", () => {
  describe("snapshotGraph", () => {
    it("counts nodes and edges correctly", () => {
      const graph = makeGraph([
        ["A", "B", "e1"],
        ["B", "C", "e2"],
        ["C", "A", "e3"],
      ]);

      const snapshot = snapshotGraph(graph);

      expect(snapshot.nodeCount).toBe(3);
      expect(snapshot.edgeCount).toBe(3);
      expect(snapshot.disconnectedComponents).toBe(1);
    });

    it("detects self-loops", () => {
      const graph = makeGraph([
        ["A", "B", "e1"],
        ["B", "B", "e2"], // Self-loop!
        ["B", "C", "e3"],
      ]);

      const snapshot = snapshotGraph(graph);

      expect(snapshot.selfLoops).toHaveLength(1);
      expect(snapshot.selfLoops[0]!.nodeId).toBe("B");
      expect(snapshot.selfLoops[0]!.edgeId).toBe("e2");
    });

    it("detects duplicate/parallel edges", () => {
      const graph = makeGraph([
        ["A", "B", "e1"],
        ["A", "B", "e2"], // Parallel edge!
        ["B", "C", "e3"],
      ]);

      const snapshot = snapshotGraph(graph);

      expect(snapshot.duplicateEdges).toHaveLength(1);
      expect(snapshot.duplicateEdges[0]!.from).toBe("A");
      expect(snapshot.duplicateEdges[0]!.to).toBe("B");
      expect(snapshot.duplicateEdges[0]!.count).toBe(2);
    });

    it("detects disconnected components", () => {
      const graph = makeGraph([
        ["A", "B", "e1"],
        ["C", "D", "e2"], // Disconnected from A-B
      ]);

      const snapshot = snapshotGraph(graph);

      expect(snapshot.disconnectedComponents).toBe(2);
    });
  });

  describe("createTraversalTracer", () => {
    it("records traversal steps", () => {
      const tracer = createTraversalTracer();

      tracer.recordStep(1, "A", "B", "e1", 5, 1, false);
      tracer.recordStep(2, "B", "C", "e2", 4, 2, false);
      tracer.recordStep(3, "C", "A", "e3", 3, 3, false);

      const steps = tracer.getSteps();
      expect(steps).toHaveLength(3);
      expect(steps[0]!.from).toBe("A");
      expect(steps[1]!.to).toBe("C");
    });

    it("detects frequently visited nodes", () => {
      const tracer = createTraversalTracer();

      // Visit A multiple times (simulating a loop)
      tracer.recordStep(1, "A", "B", "e1", 5, 1, false);
      tracer.recordStep(2, "B", "A", "e2", 4, 2, false);
      tracer.recordStep(3, "A", "B", "e3", 3, 3, false); // A again!
      tracer.recordStep(4, "B", "A", "e4", 2, 4, false); // A again!

      // A is visited at steps 1, 3 (from A) = 2 times
      // B is visited at steps 2, 4 (from B) = 2 times
      // Use threshold 1 to catch nodes visited more than once
      const frequent = tracer.getFrequentlyVisitedNodes(1);
      expect(frequent.length).toBeGreaterThan(0);
      expect(frequent.find((n) => n.nodeId === "A")).toBeDefined();
    });

    it("detects oscillation patterns (A<->B)", () => {
      const tracer = createTraversalTracer();

      // Oscillate between A and B
      tracer.recordStep(1, "A", "B", "e1", 5, 1, false);
      tracer.recordStep(2, "B", "A", "e2", 4, 2, false);
      tracer.recordStep(3, "A", "B", "e3", 3, 3, false);
      tracer.recordStep(4, "B", "A", "e4", 2, 4, false);

      const oscillations = tracer.findOscillations();
      expect(oscillations.length).toBeGreaterThan(0);
      expect(oscillations[0]!.nodes).toContain("A");
      expect(oscillations[0]!.nodes).toContain("B");
    });
  });

  describe("analyzeEdgePatterns", () => {
    it("finds bidirectional pairs", () => {
      const graph = makeGraph([
        ["A", "B", "e1"],
        ["B", "A", "e2"], // Bidirectional!
        ["B", "C", "e3"],
      ]);

      const patterns = analyzeEdgePatterns(graph);

      expect(patterns.bidirectionalPairs.length).toBeGreaterThan(0);
      const pair = patterns.bidirectionalPairs[0]!;
      expect([pair.nodeA, pair.nodeB].sort()).toEqual(["A", "B"]);
    });

    it("finds one-way streets", () => {
      const graph: AdjGraph = new Map();
      graph.set("A", [
        {
          target: "B",
          edgeId: "e1",
          data: { length: 100, oneway: true, wayId: "way1" },
        },
      ]);
      graph.set("B", [
        {
          target: "C",
          edgeId: "e2",
          data: { length: 100, oneway: false },
        },
      ]);

      const patterns = analyzeEdgePatterns(graph);

      expect(patterns.oneWayStreets).toHaveLength(1);
      expect(patterns.oneWayStreets[0]!.from).toBe("A");
      expect(patterns.oneWayStreets[0]!.to).toBe("B");
    });

    it("finds potential U-turn points (degree 2 on same way)", () => {
      const graph: AdjGraph = new Map();
      // Node B has degree 2, both edges on same way
      graph.set("A", [
        {
          target: "B",
          edgeId: "e1",
          data: { length: 100, oneway: false, wayId: "way1" },
        },
      ]);
      graph.set("B", [
        {
          target: "A",
          edgeId: "e2",
          data: { length: 100, oneway: false, wayId: "way1" },
        },
        {
          target: "C",
          edgeId: "e3",
          data: { length: 100, oneway: false, wayId: "way1" },
        },
      ]);
      graph.set("C", [
        {
          target: "B",
          edgeId: "e4",
          data: { length: 100, oneway: false, wayId: "way1" },
        },
      ]);

      const patterns = analyzeEdgePatterns(graph);

      expect(patterns.potentialUturnPoints).toContain("B");
    });
  });

  describe("loop detection scenarios", () => {
    it("detects dual carriageway loop pattern", () => {
      // Simulate a dual carriageway:
      //   A --forward--> B --forward--> C
      //   A <--reverse-- B <--reverse-- C
      // If routing goes A->B->A->B, that's a loop!
      const tracer = createTraversalTracer();

      // Normal traversal
      tracer.recordStep(1, "A", "B", "e_forward_1", 6, 1, false);
      tracer.recordStep(2, "B", "C", "e_forward_2", 5, 2, false);

      // Then somehow we end up going back
      tracer.recordStep(3, "C", "B", "e_reverse_2", 4, 3, false);
      tracer.recordStep(4, "B", "A", "e_reverse_1", 3, 4, false);

      // And then forward again (LOOP!)
      tracer.recordStep(5, "A", "B", "e_forward_1", 2, 5, false); // Same edge as step 1!

      const loop = tracer.getLoopDetection();
      expect(loop?.found).toBe(true);
      expect(loop?.position.step).toBe(5);
    });

    it("detects figure-8 pattern (two loops sharing a node)", () => {
      const tracer = createTraversalTracer();

      // Loop 1: A -> B -> C -> A
      tracer.recordStep(1, "A", "B", "e1", 8, 1, false);
      tracer.recordStep(2, "B", "C", "e2", 7, 2, false);
      tracer.recordStep(3, "C", "A", "e3", 6, 3, false);

      // Loop 2: A -> D -> E -> A (shares node A)
      tracer.recordStep(4, "A", "D", "e4", 5, 4, false);
      tracer.recordStep(5, "D", "E", "e5", 4, 5, false);
      tracer.recordStep(6, "E", "A", "e6", 3, 6, false);

      // Node A is visited at steps 1, 4 (from A) = 2 times
      // Use threshold 1 to catch nodes visited more than once
      const frequent = tracer.getFrequentlyVisitedNodes(1);
      expect(frequent.find((n) => n.nodeId === "A")).toBeDefined();
    });
  });
});

// ─── Visual Debug Output (always runs — see terminal) ────────────────────────

describe("graph-debug visual output", () => {
  it("prints a graph summary with a dual carriageway pattern", () => {
    // Dual carriageway: two parallel edges between each pair of nodes
    const graph = makeGraph([
      ["A", "B", "e_fwd_1"],
      ["B", "A", "e_rev_1"],
      ["B", "C", "e_fwd_2"],
      ["C", "B", "e_rev_2"],
      ["C", "D", "e_fwd_3"],
      ["D", "C", "e_rev_3"],
      // Extra parallel edge (simulates OSM duplicate way)
      ["A", "B", "e_fwd_1_dup"],
    ]);

    const snapshot = snapshotGraph(graph);
    printGraphSummary(snapshot);

    // Assertions to confirm the output is meaningful
    expect(snapshot.nodeCount).toBe(4);
    expect(snapshot.duplicateEdges).toHaveLength(1); // A->B has 2 edges
    expect(snapshot.disconnectedComponents).toBe(1);
  });

  it("prints a traversal trace with an oscillation loop", () => {
    const tracer = createTraversalTracer();

    // Simulate a buggy traversal that oscillates on a dual carriageway
    tracer.recordStep(1, "A", "B", "e_fwd", 6, 1, false);
    tracer.recordStep(2, "B", "A", "e_rev", 5, 2, false);
    tracer.recordStep(3, "A", "B", "e_fwd", 4, 3, false); // loop!
    tracer.recordStep(4, "B", "A", "e_rev", 3, 4, false); // loop!
    tracer.recordStep(5, "A", "B", "e_fwd", 2, 5, false); // loop!

    printTraversalTrace(tracer);

    // Confirm the tracer caught the problem
    expect(tracer.getLoopDetection()?.found).toBe(true);
    expect(tracer.getFrequentlyVisitedNodes(1).length).toBeGreaterThan(0);
    expect(tracer.findOscillations().length).toBeGreaterThan(0);
  });

  it("prints a graph with self-loops and disconnected components", () => {
    const graph = makeGraph([
      ["A", "B", "e1"],
      ["B", "B", "e_self"], // self-loop
      ["B", "C", "e2"],
      // Disconnected island
      ["X", "Y", "e3"],
      ["Y", "X", "e4"],
    ]);

    const snapshot = snapshotGraph(graph);
    printGraphSummary(snapshot);

    expect(snapshot.selfLoops).toHaveLength(1);
    expect(snapshot.disconnectedComponents).toBe(2);
  });
});
