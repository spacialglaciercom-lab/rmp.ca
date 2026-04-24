import type { TurnNode, TurnEdge, StreetEdge } from "@/types/turnAware";
import {
  CycleDetector,
  type CycleDetectorConfig,
  DEFAULT_CYCLE_CONFIG,
} from "./cycleDetector";
import {
  hierholzer,
  type HierholzerGraph,
  type EdgeSelector,
} from "./_core/hierholzer";

export interface TurnAwareCppResult {
  circuit: TurnEdge[];
  totalCost: number;
  stats: { right: number; left: number; uTurn: number; straight: number };
  /** Diagnostics from cycle detection (if enabled) */
  cycleDiagnostics?: {
    loopsDetected: number;
    escapeAttempts: number;
    tabuNodesUsed: number;
  };
}

export interface TurnAwareCppOptions {
  /** Enable cycle detection to prevent infinite loops (default: true) */
  enableCycleDetection?: boolean;
  /** Configuration for cycle detector */
  cycleConfig?: Partial<CycleDetectorConfig>;
}

/** Hierholzer's algorithm adapted for turn-expanded graph.
 *  Edges are appended on backtrack so sub-tours are properly spliced.
 *  Includes Tarjan-inspired cycle detection to prevent infinite loops. */
export function solveTurnAwareCPP(
  turnEdges: TurnEdge[],
  startNode?: TurnNode,
  options: TurnAwareCppOptions = {},
): TurnAwareCppResult {
  const { enableCycleDetection = true, cycleConfig = {} } = options;

  // Pre-compute "from" and "to" keys for every edge once (avoids string
  // concatenation inside the hot Hierholzer loop).
  const fromKeyArr = new Array<string>(turnEdges.length);
  const toKeyArr = new Array<string>(turnEdges.length);
  const adj = new Map<string, number[]>(); // key -> indices into turnEdges
  for (let i = 0; i < turnEdges.length; i++) {
    const edge = turnEdges[i]!;
    const fk = `${edge.from.edgeId}:${edge.from.direction}`;
    const tk = `${edge.to.edgeId}:${edge.to.direction}`;
    fromKeyArr[i] = fk;
    toKeyArr[i] = tk;
    let list = adj.get(fk);
    if (!list) {
      list = [];
      adj.set(fk, list);
    }
    list.push(i);
  }

  // Initialize cycle detector
  const cycleDetector = enableCycleDetection
    ? new CycleDetector({ ...DEFAULT_CYCLE_CONFIG, ...cycleConfig })
    : null;

  // ── Graph adapter ────────────────────────────────────────────
  // Track consumed edges via a Set so each consumeEdge is O(1) and
  // getCandidates filters the original adj list in O(k) where k is small.
  const consumed = new Set<number>();
  let remaining = turnEdges.length;

  const graph: HierholzerGraph<number> = {
    getCandidates(node: string): number[] {
      const indices = adj.get(node);
      if (!indices) return [];
      return indices.filter((i) => !consumed.has(i));
    },
    getTarget(edgeIdx: number): string {
      return toKeyArr[edgeIdx]!;
    },
    consumeEdge(_node: string, edgeIdx: number): void {
      consumed.add(edgeIdx);
      remaining--;
    },
    remainingEdgeCount(): number {
      return remaining;
    },
  };

  // ── Edge selector ────────────────────────────────────────────
  // Scoring mirrors the original sortAdjacency comparator, converted to an
  // additive score with weights that preserve the same priority ordering:
  //   tabu > recent-stack (escape) > cycle-penalty > deadhead > u-turn > degree > cost
  //
  // The weights are chosen so each level dominates all lower levels combined.
  const edgeSelector: EdgeSelector<number> = {
    select(
      current: string,
      candidates: number[],
      stack: ReadonlyArray<string>,
      loopEscapeMode: boolean,
    ): number {
      if (candidates.length === 1) return candidates[0]!;

      // Build recent-stack set once per escape-mode call
      const recentStackNodes = new Set<string>();
      if (loopEscapeMode && stack.length > 5) {
        for (
          let i = Math.max(0, stack.length - 20);
          i < stack.length;
          i++
        ) {
          recentStackNodes.add(stack[i]!);
        }
      }

      let bestIdx = candidates[0]!;
      let bestScore = Infinity;
      let allTabu = true;

      for (const idx of candidates) {
        const edge = turnEdges[idx]!;
        const targetKey = toKeyArr[idx]!;
        let score = 0;

        // Tabu — absolute priority (1e8 isolates it from all other factors)
        const isTabu = cycleDetector?.isTabu(targetKey) ?? false;
        if (isTabu) {
          score += 1e8;
        } else {
          allTabu = false;
        }

        // Escape mode: penalise recently-visited stack nodes (below tabu)
        if (loopEscapeMode && recentStackNodes.has(targetKey)) {
          score += 1e7;
        }

        // Cycle-detector frequency penalty
        if (cycleDetector) {
          // Multiplier 2000 means a penalty diff of 50 ≈ deadhead weight,
          // preserving the original sort's ">50 diff" significance threshold.
          score += cycleDetector.getPenalty(targetKey) * 2000;
        }

        // Deadhead edges: traverse last
        if (edge.deadhead) score += 1e5;

        // U-turn avoidance; extra penalty to dead-ends
        if (edge.turnType === "u-turn") {
          score += 1e4;
          const deg = adj.get(targetKey)?.length ?? 0;
          if (deg <= 1) score += 5e3;
        }

        // Prefer destinations with more outgoing edges (original degree)
        const deg = adj.get(targetKey)?.length ?? 0;
        score -= deg * 100;

        // Cost as final tiebreaker
        score += edge.totalCost * 0.01;

        if (score < bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }

      // If every candidate leads to a tabu node, clear tabu for the best
      // and take it — same fallback as the original implementation.
      if (allTabu && cycleDetector) {
        cycleDetector.clearTabu(toKeyArr[bestIdx]!);
      }

      return bestIdx;
    },
  };

  const startKey: string = startNode
    ? `${startNode.edgeId}:${startNode.direction}`
    : (adj.keys().next().value ?? "");

  // ── Run core Hierholzer ──────────────────────────────────────
  const result = hierholzer(graph, startKey, {
    edgeSelector,
    cycleDetector,
    maxIterationsMultiplier: 10,
    stagnantBacktrackThreshold: 50,
  });

  // Map edge-index circuit back to TurnEdge objects
  const circuit = result.edgeCircuit.map((idx) => turnEdges[idx]!);

  if (result.hitIterationCap) {
    console.error(
      `[TurnAwareCPP] Hit iteration cap (${result.iterations}). ` +
        `Circuit has ${circuit.length} edges, graph has ${turnEdges.length}.`,
    );
    if (cycleDetector) {
      console.error(
        `[TurnAwareCPP] Diagnostics:`,
        cycleDetector.getDiagnostics(),
      );
    }
  }

  if (result.unconsumedEdges > 0) {
    console.warn(
      `[TurnAwareCPP] Hierholzer left ${result.unconsumedEdges} unconsumed edges — graph may not be Eulerian or fully connected`,
    );
  }

  // Tally turn stats
  const stats = { right: 0, left: 0, uTurn: 0, straight: 0 };
  for (const edge of circuit) {
    if (edge.turnType === "u-turn") stats.uTurn++;
    else stats[edge.turnType]++;
  }

  const totalCost = circuit.reduce((sum, e) => sum + e.totalCost, 0);

  const cppResult: TurnAwareCppResult = { circuit, totalCost, stats };
  if (enableCycleDetection && result.cycleDiagnostics) {
    cppResult.cycleDiagnostics = {
      loopsDetected: result.cycleDiagnostics.loopsDetected,
      escapeAttempts: result.cycleDiagnostics.escapeAttempts,
      tabuNodesUsed: cycleDetector
        ? cycleDetector.getDiagnostics().tabuListSize
        : 0,
    };
  }
  return cppResult;
}

/** Convert turn circuit back to ordered street edge ids for display/routing. */
export function turnCircuitToStreetRoute(circuit: TurnEdge[]): string[] {
  const route: string[] = [];
  circuit.forEach((turn, idx) => {
    if (idx === 0 || turn.from.edgeId !== circuit[idx - 1]!.to.edgeId) {
      route.push(turn.from.edgeId);
    }
    route.push(turn.to.edgeId);
  });
  return route;
}

/** Iterate coordinates in traversal order without copying/reversing the array. */
function coordAt(
  coords: [number, number][],
  index: number,
  forward: boolean,
): [number, number] {
  return forward ? coords[index]! : coords[coords.length - 1 - index]!;
}

/** Convert turn circuit to route points (lat/lon, nodeId) using street edges.
 *  Bridge edges (synthetic connections between SCCs) are skipped since they have
 *  no real street geometry and would cause the route to scribble across the map. */
export function turnCircuitToRoutePoints(
  streetEdges: StreetEdge[],
  circuit: TurnEdge[],
): { latitude: number; longitude: number; nodeId?: string }[] {
  const edgeMap = new Map<string, StreetEdge>();
  for (let i = 0; i < streetEdges.length; i++) {
    const e = streetEdges[i]!;
    edgeMap.set(e.id, e);
  }

  const points: { latitude: number; longitude: number; nodeId?: string }[] = [];
  let prevWasBridge = false;
  let addedFirstFrom = false;
  for (let i = 0; i < circuit.length; i++) {
    const turn = circuit[i]!;

    if (turn.bridge) {
      prevWasBridge = true;
      continue;
    }

    // Add the first non-bridge edge's "from" street coordinates
    if (!addedFirstFrom) {
      addedFirstFrom = true;
      const fromEdge = edgeMap.get(turn.from.edgeId);
      if (fromEdge && fromEdge.coordinates.length >= 2) {
        const isFwd = turn.from.direction === "forward";
        const startNode = isFwd ? fromEdge.from : fromEdge.to;
        const endNode = isFwd ? fromEdge.to : fromEdge.from;
        const len = fromEdge.coordinates.length;
        for (let j = 0; j < len; j++) {
          const [lat, lon] = coordAt(fromEdge.coordinates, j, isFwd);
          const nodeId =
            j === 0 ? startNode : j === len - 1 ? endNode : undefined;
          if (nodeId != null) {
            points.push({ latitude: lat, longitude: lon, nodeId });
          } else {
            points.push({ latitude: lat, longitude: lon });
          }
        }
      }
    }

    const edge = edgeMap.get(turn.to.edgeId);
    if (!edge || !edge.coordinates.length) continue;
    const isForward = turn.to.direction === "forward";
    const len = edge.coordinates.length;
    const startNodeId = isForward ? edge.from : edge.to;
    const endNodeId = isForward ? edge.to : edge.from;
    const skipFirst = points.length > 0 && !prevWasBridge;
    prevWasBridge = false;
    for (let j = skipFirst ? 1 : 0; j < len; j++) {
      const [lat, lon] = coordAt(edge.coordinates, j, isForward);
      const nodeId =
        j === 0 ? startNodeId : j === len - 1 ? endNodeId : undefined;
      if (nodeId != null) {
        points.push({ latitude: lat, longitude: lon, nodeId });
      } else {
        points.push({ latitude: lat, longitude: lon });
      }
    }
  }
  return points;
}
