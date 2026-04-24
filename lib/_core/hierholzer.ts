/**
 * Core Hierholzer's algorithm for finding Eulerian circuits.
 *
 * This is the single, canonical implementation shared by all route optimizers.
 * Graph representation, edge selection strategy, and cycle detection are
 * injected via the interfaces below, keeping the core loop free of
 * domain-specific concerns (turn penalties, deadhead flags, plugins, etc.).
 *
 * Replaces three divergent inline implementations:
 *   - lib/turnAwareCpp.ts (turn-expanded graph)
 *   - lib/route-optimizer-v2/routeOptimizer.ts (node-based graph)
 *   - lib/offline-optimizer-v2/routeOptimizerSimple.ts (simple node graph)
 */

import type { CycleDetector } from "../cycleDetector";

// ── Interfaces ──────────────────────────────────────────────────

/** Adapter for different graph representations. */
export interface HierholzerGraph<TEdgeId> {
  /** Return available (unconsumed) edge IDs from a node. */
  getCandidates(node: string): TEdgeId[];

  /** Return the target node of an edge. */
  getTarget(edgeId: TEdgeId): string;

  /** Mark a single edge as consumed. */
  consumeEdge(node: string, edgeId: TEdgeId): void;

  /** Total remaining (unconsumed) edges across the entire graph. */
  remainingEdgeCount(): number;
}

/**
 * Strategy for choosing the next edge from a set of candidates.
 *
 * Implementations encapsulate domain-specific heuristics: turn-cost
 * scoring, tabu avoidance, dead-end handling, plugin costs, etc.
 */
export interface EdgeSelector<TEdgeId> {
  /**
   * @param current        Current node key.
   * @param candidates     Remaining edge IDs from `current` (never empty).
   * @param stack          Traversal stack (read-only; `stack[stack.length-1] === current`).
   * @param loopEscapeMode `true` when the cycle detector has flagged a loop.
   * @returns One of `candidates`.
   */
  select(
    current: string,
    candidates: TEdgeId[],
    stack: ReadonlyArray<string>,
    loopEscapeMode: boolean,
  ): TEdgeId;
}

/** Options for {@link hierholzer}. */
export interface HierholzerOptions<TEdgeId> {
  /** Edge selection strategy (default: first available). */
  edgeSelector?: EdgeSelector<TEdgeId>;

  /** Cycle detector for loop prevention (default: none). */
  cycleDetector?: CycleDetector | null;

  /**
   * Safety cap: max iterations = totalEdges × this multiplier.
   * Default 10.
   */
  maxIterationsMultiplier?: number;

  /**
   * Force-backtrack after this many stagnant iterations detected by the
   * cycle detector (default: 50).
   */
  stagnantBacktrackThreshold?: number;
}

/** Result returned by {@link hierholzer}. */
export interface HierholzerResult<TEdgeId> {
  /**
   * Node IDs in traversal order.
   * `nodeCircuit[i]` → `edgeCircuit[i]` → `nodeCircuit[i+1]`.
   * Length = |consumedEdges| + 1 for a complete Euler circuit.
   */
  nodeCircuit: string[];

  /** Edge IDs in traversal order. Length = |consumedEdges|. */
  edgeCircuit: TEdgeId[];

  /** `true` if the safety iteration cap was reached. */
  hitIterationCap: boolean;

  /** Edges not consumed (0 for a complete Euler circuit). */
  unconsumedEdges: number;

  /** Total main-loop iterations. */
  iterations: number;

  /** Present when a cycle detector was provided. */
  cycleDiagnostics?: {
    loopsDetected: number;
    escapeAttempts: number;
  };
}

// ── Algorithm ───────────────────────────────────────────────────

/**
 * Hierholzer's algorithm: find an Eulerian circuit by DFS with backtracking.
 *
 * The traversal pushes nodes onto a stack when advancing and pops them
 * into the circuit when backtracking (no remaining edges). The circuit
 * is reversed at the end to produce the correct traversal order.
 *
 * @param graph     Graph adapter.
 * @param startNode Node key to begin the circuit.
 * @param options   Edge selector, cycle detector, and safety limits.
 */
export function hierholzer<TEdgeId>(
  graph: HierholzerGraph<TEdgeId>,
  startNode: string,
  options: HierholzerOptions<TEdgeId> = {},
): HierholzerResult<TEdgeId> {
  const {
    edgeSelector,
    cycleDetector = null,
    maxIterationsMultiplier = 10,
    stagnantBacktrackThreshold = 50,
  } = options;

  const nodeStack: string[] = [startNode];
  const edgeIdStack: (TEdgeId | null)[] = [null]; // edge that led to each node
  const nodeCircuit: string[] = [];
  const edgeCircuit: TEdgeId[] = [];

  const maxIterations = graph.remainingEdgeCount() * maxIterationsMultiplier;
  let iterations = 0;
  let loopsDetected = 0;
  let escapeAttempts = 0;

  while (nodeStack.length > 0 && iterations < maxIterations) {
    iterations++;
    const current = nodeStack[nodeStack.length - 1]!;

    // ── Cycle detection ─────────────────────────────────────
    let loopEscapeMode = false;
    if (cycleDetector) {
      const detection = cycleDetector.enterNode(
        current,
        graph.remainingEdgeCount(),
      );
      if (detection.isLooping) {
        loopsDetected++;
        escapeAttempts++;
        loopEscapeMode = true;

        // Force backtrack if severely stuck
        if (
          detection.stagnantIterations > stagnantBacktrackThreshold &&
          nodeStack.length > 3
        ) {
          cycleDetector.leaveNode(current);
          const poppedNode = nodeStack.pop()!;
          const poppedEdge = edgeIdStack.pop()!;
          nodeCircuit.push(poppedNode);
          if (poppedEdge !== null) edgeCircuit.push(poppedEdge);
          continue;
        }
      }
    }

    // ── Forward or backtrack ────────────────────────────────
    const candidates = graph.getCandidates(current);

    if (candidates.length > 0) {
      const chosen = edgeSelector
        ? edgeSelector.select(current, candidates, nodeStack, loopEscapeMode)
        : candidates[0]!;

      const target = graph.getTarget(chosen);
      graph.consumeEdge(current, chosen);

      if (cycleDetector) {
        cycleDetector.updateLowlink(current, target);
      }

      nodeStack.push(target);
      edgeIdStack.push(chosen);
    } else {
      // Backtrack: no remaining edges at this node
      if (cycleDetector) {
        cycleDetector.leaveNode(current);
      }
      const poppedNode = nodeStack.pop()!;
      const poppedEdge = edgeIdStack.pop()!;
      nodeCircuit.push(poppedNode);
      if (poppedEdge !== null) edgeCircuit.push(poppedEdge);
    }
  }

  // Reverse to get correct traversal order
  nodeCircuit.reverse();
  edgeCircuit.reverse();

  const result: HierholzerResult<TEdgeId> = {
    nodeCircuit,
    edgeCircuit,
    hitIterationCap: iterations >= maxIterations,
    unconsumedEdges: graph.remainingEdgeCount(),
    iterations,
  };

  if (cycleDetector) {
    result.cycleDiagnostics = { loopsDetected, escapeAttempts };
  }

  return result;
}
