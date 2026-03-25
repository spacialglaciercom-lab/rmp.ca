/**
 * Graph Debugging Utilities for Route Optimizer
 * 
 * Targeted debugging to expose graph construction and trace loop formation.
 * Import and call these functions to diagnose routing issues.
 */

import type { Node, Way } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdjEntry {
  target: string;
  data: {
    length: number;
    oneway: boolean;
    direction?: "forward" | "reverse";
    oneway_violation?: boolean;
    wayId?: string;
    geometry?: Array<[number, number]>;
  };
  edgeId: string;
}

export type AdjGraph = Map<string, AdjEntry[]>;

export interface GraphDebugSnapshot {
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{ id: string; lat: number; lon: number; degree: number }>;
  edges: Array<{
    edgeId: string;
    from: string;
    to: string;
    length: number;
    oneway: boolean;
    wayId?: string;
  }>;
  adjacencyList: Map<string, string[]>;
  duplicateEdges: Array<{ from: string; to: string; count: number }>;
  selfLoops: Array<{ nodeId: string; edgeId: string }>;
  disconnectedComponents: number;
}

export interface TraversalStep {
  step: number;
  from: string;
  to: string;
  edgeId: string;
  wayId?: string;
  remainingEdges: number;
  stackSize: number;
  isBacktrack: boolean;
}

export interface LoopDetection {
  found: boolean;
  loopNodes: string[];
  loopEdges: string[];
  loopLength: number;
  position: { step: number; from: string; to: string };
}

// ─── Graph Snapshot ────────────────────────────────────────────────────────

/**
 * Create a complete snapshot of the graph structure.
 * Use this to inspect how the graph was built from OSM data.
 */
export function snapshotGraph(graph: AdjGraph): GraphDebugSnapshot {
  const nodes: GraphDebugSnapshot["nodes"] = [];
  const edges: GraphDebugSnapshot["edges"] = [];
  const adjacencyList = new Map<string, string[]>();
  const edgeCounts = new Map<string, number>(); // "from->to" -> count
  const selfLoops: GraphDebugSnapshot["selfLoops"] = [];

  let totalEdges = 0;

  for (const [nodeId, adjList] of graph.entries()) {
    const degree = adjList.length;
    nodes.push({
      id: nodeId,
      lat: 0, // Will be filled by caller if needed
      lon: 0,
      degree,
    });

    const neighbors: string[] = [];
    for (const entry of adjList) {
      totalEdges++;
      edges.push({
        edgeId: entry.edgeId,
        from: nodeId,
        to: entry.target,
        length: entry.data.length,
        oneway: entry.data.oneway,
        wayId: entry.data.wayId,
      });
      neighbors.push(entry.target);

      // Track duplicate edges (parallel edges between same nodes)
      const key = `${nodeId}->${entry.target}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);

      // Detect self-loops
      if (nodeId === entry.target) {
        selfLoops.push({ nodeId, edgeId: entry.edgeId });
      }
    }
    adjacencyList.set(nodeId, neighbors);
  }

  // Find duplicate edges
  const duplicateEdges: GraphDebugSnapshot["duplicateEdges"] = [];
  for (const [key, count] of edgeCounts.entries()) {
    if (count > 1) {
      const [from, to] = key.split("->");
      duplicateEdges.push({ from, to, count });
    }
  }

  // Count disconnected components using BFS
  const visited = new Set<string>();
  let components = 0;
  for (const nodeId of graph.keys()) {
    if (!visited.has(nodeId)) {
      components++;
      const queue = [nodeId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const neighbors = adjacencyList.get(current) ?? [];
        for (const n of neighbors) {
          if (!visited.has(n)) queue.push(n);
        }
      }
    }
  }

  return {
    nodeCount: nodes.length,
    edgeCount: totalEdges,
    nodes,
    edges,
    adjacencyList,
    duplicateEdges,
    selfLoops,
    disconnectedComponents: components,
  };
}

// ─── Traversal Tracer ───────────────────────────────────────────────────────

/**
 * Create a tracer for Hierholzer traversal.
 * Call recordStep() at each step of the algorithm.
 */
export function createTraversalTracer() {
  const steps: TraversalStep[] = [];
  const visitedEdges = new Set<string>();
  const nodeVisits = new Map<string, number>();
  let loopDetected: LoopDetection | null = null;

  return {
    /**
     * Record a single step in the traversal.
     */
    recordStep(
      step: number,
      from: string,
      to: string,
      edgeId: string,
      remainingEdges: number,
      stackSize: number,
      isBacktrack: boolean,
      wayId?: string,
    ): void {
      // Track node visits
      nodeVisits.set(from, (nodeVisits.get(from) ?? 0) + 1);

      // Check for loop: if we've visited this edge before
      if (visitedEdges.has(edgeId) && !isBacktrack) {
        loopDetected = {
          found: true,
          loopNodes: [from, to],
          loopEdges: [edgeId],
          loopLength: 1,
          position: { step, from, to },
        };
      }

      visitedEdges.add(edgeId);

      steps.push({
        step,
        from,
        to,
        edgeId,
        wayId,
        remainingEdges,
        stackSize,
        isBacktrack,
      });
    },

    /**
     * Get all recorded steps.
     */
    getSteps(): TraversalStep[] {
      return steps;
    },

    /**
     * Get node visit counts (high counts may indicate loops).
     */
    getNodeVisits(): Map<string, number> {
      return nodeVisits;
    },

    /**
     * Get nodes visited more than N times (potential loop indicators).
     */
    getFrequentlyVisitedNodes(threshold: number = 3): Array<{ nodeId: string; visits: number }> {
      const result: Array<{ nodeId: string; visits: number }> = [];
      for (const [nodeId, visits] of nodeVisits.entries()) {
        if (visits > threshold) {
          result.push({ nodeId, visits });
        }
      }
      return result.sort((a, b) => b.visits - a.visits);
    },

    /**
     * Check if a loop was detected during traversal.
     */
    getLoopDetection(): LoopDetection | null {
      return loopDetected;
    },

    /**
     * Find oscillation patterns (A->B->A->B) in the traversal.
     */
    findOscillations(): Array<{ nodes: [string, string]; count: number; steps: number[] }> {
      const oscillations: Array<{ nodes: [string, string]; count: number; steps: number[] }> = [];
      const pairVisits = new Map<string, number[]>();

      for (let i = 0; i < steps.length - 1; i++) {
        const curr = steps[i]!;
        const next = steps[i + 1]!;
        if (!curr.isBacktrack && !next.isBacktrack) {
          // Check if we're oscillating between two nodes
          if (curr.to === next.to && curr.from === next.from) {
            const key = `${curr.from}<->${curr.to}`;
            const stepList = pairVisits.get(key) ?? [];
            stepList.push(curr.step);
            pairVisits.set(key, stepList);
          }
          // Check for A->B followed by B->A
          if (curr.to === next.from && curr.from === next.to) {
            const key = `${curr.from}<->${curr.to}`;
            const stepList = pairVisits.get(key) ?? [];
            stepList.push(curr.step);
            pairVisits.set(key, stepList);
          }
        }
      }

      for (const [key, stepList] of pairVisits.entries()) {
        if (stepList.length >= 2) {
          const nodes = key.split("<->") as [string, string];
          oscillations.push({ nodes, count: stepList.length, steps: stepList });
        }
      }

      return oscillations.sort((a, b) => b.count - a.count);
    },
  };
}

// ─── Edge Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze edges for potential loop-causing patterns.
 */
export function analyzeEdgePatterns(graph: AdjGraph): {
  bidirectionalPairs: Array<{ nodeA: string; nodeB: string; edges: string[] }>;
  oneWayStreets: Array<{ from: string; to: string; wayId?: string }>;
  potentialUturnPoints: string[];
} {
  const bidirectionalPairs: Array<{ nodeA: string; nodeB: string; edges: string[] }> = [];
  const oneWayStreets: Array<{ from: string; to: string; wayId?: string }> = [];
  const potentialUturnPoints: string[] = [];

  // Find bidirectional pairs (A->B and B->A both exist)
  const forwardEdges = new Map<string, string[]>();
  for (const [from, adjList] of graph.entries()) {
    for (const entry of adjList) {
      const key = `${from}->${entry.target}`;
      forwardEdges.set(key, [...(forwardEdges.get(key) ?? []), entry.edgeId]);
    }
  }

  const seen = new Set<string>();
  for (const [from, adjList] of graph.entries()) {
    for (const entry of adjList) {
      const reverseKey = `${entry.target}->${from}`;
      const pairKey = [from, entry.target].sort().join("<->");
      if (forwardEdges.has(reverseKey) && !seen.has(pairKey)) {
        seen.add(pairKey);
        const forwardIds = forwardEdges.get(`${from}->${entry.target}`) ?? [];
        const reverseIds = forwardEdges.get(reverseKey) ?? [];
        bidirectionalPairs.push({
          nodeA: from,
          nodeB: entry.target,
          edges: [...forwardIds, ...reverseIds],
        });
      }
    }
  }

  // Find one-way streets (only A->B, no B->A)
  for (const [from, adjList] of graph.entries()) {
    for (const entry of adjList) {
      if (entry.data.oneway) {
        oneWayStreets.push({
          from,
          to: entry.target,
          wayId: entry.data.wayId,
        });
      }
    }
  }

  // Find potential U-turn points (nodes with degree 2 on same way)
  for (const [nodeId, adjList] of graph.entries()) {
    if (adjList.length === 2) {
      const wayIds = new Set(adjList.map((e) => e.data.wayId).filter(Boolean));
      if (wayIds.size === 1) {
        potentialUturnPoints.push(nodeId);
      }
    }
  }

  return { bidirectionalPairs, oneWayStreets, potentialUturnPoints };
}

// ─── Console Output Helpers ─────────────────────────────────────────────────

/**
 * Print a human-readable graph summary.
 */
export function printGraphSummary(snapshot: GraphDebugSnapshot): void {
  console.log("\n=== GRAPH DEBUG SNAPSHOT ===");
  console.log(`Nodes: ${snapshot.nodeCount}`);
  console.log(`Edges: ${snapshot.edgeCount}`);
  console.log(`Disconnected components: ${snapshot.disconnectedComponents}`);
  console.log(`Self-loops: ${snapshot.selfLoops.length}`);
  console.log(`Duplicate edges (parallel): ${snapshot.duplicateEdges.length}`);

  if (snapshot.selfLoops.length > 0) {
    console.log("\n⚠️  SELF-LOOPS (potential bugs):");
    for (const sl of snapshot.selfLoops.slice(0, 5)) {
      console.log(`  Node ${sl.nodeId} -> itself (edge ${sl.edgeId})`);
    }
  }

  if (snapshot.duplicateEdges.length > 0) {
    console.log("\n⚠️  DUPLICATE EDGES (parallel edges):");
    for (const de of snapshot.duplicateEdges.slice(0, 5)) {
      console.log(`  ${de.from} -> ${de.to}: ${de.count} edges`);
    }
  }

  // Degree distribution
  const degreeCounts = new Map<number, number>();
  for (const node of snapshot.nodes) {
    degreeCounts.set(node.degree, (degreeCounts.get(node.degree) ?? 0) + 1);
  }
  console.log("\nDegree distribution:");
  const sortedDegrees = Array.from(degreeCounts.entries()).sort((a, b) => a[0] - b[0]);
  for (const [deg, count] of sortedDegrees) {
    console.log(`  Degree ${deg}: ${count} nodes`);
  }
}

/**
 * Print traversal trace for debugging.
 */
export function printTraversalTrace(
  tracer: ReturnType<typeof createTraversalTracer>,
  maxSteps: number = 50,
): void {
  const steps = tracer.getSteps();
  const loop = tracer.getLoopDetection();
  const frequentNodes = tracer.getFrequentlyVisitedNodes(3);
  const oscillations = tracer.findOscillations();

  console.log("\n=== TRAVERSAL TRACE ===");
  console.log(`Total steps: ${steps.length}`);

  if (loop) {
    console.log("\n🔴 LOOP DETECTED:");
    console.log(`  At step ${loop.position.step}: ${loop.position.from} -> ${loop.position.to}`);
  }

  if (frequentNodes.length > 0) {
    console.log("\n⚠️  FREQUENTLY VISITED NODES (potential loops):");
    for (const fn of frequentNodes.slice(0, 10)) {
      console.log(`  Node ${fn.nodeId}: ${fn.visits} visits`);
    }
  }

  if (oscillations.length > 0) {
    console.log("\n⚠️  OSCILLATION PATTERNS (A<->B):");
    for (const osc of oscillations.slice(0, 5)) {
      console.log(`  ${osc.nodes[0]} <-> ${osc.nodes[1]}: ${osc.count} times`);
    }
  }

  console.log(`\nFirst ${Math.min(maxSteps, steps.length)} steps:`);
  for (const step of steps.slice(0, maxSteps)) {
    const backtrack = step.isBacktrack ? " [BACKTRACK]" : "";
    console.log(
      `  ${step.step}: ${step.from} -> ${step.to} (edge ${step.edgeId}) remaining=${step.remainingEdges} stack=${step.stackSize}${backtrack}`,
    );
  }
}

// ─── Export for use in routeOptimizer.ts ─────────────────────────────────────

/**
 * Wrap a graph with debug instrumentation.
 * Returns the original graph plus debug utilities.
 */
export function instrumentGraph(graph: AdjGraph): {
  graph: AdjGraph;
  snapshot: GraphDebugSnapshot;
  tracer: ReturnType<typeof createTraversalTracer>;
  printSummary: () => void;
} {
  const snapshot = snapshotGraph(graph);
  const tracer = createTraversalTracer();

  return {
    graph,
    snapshot,
    tracer,
    printSummary: () => {
      printGraphSummary(snapshot);
    },
  };
}
