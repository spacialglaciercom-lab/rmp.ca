import type { TurnNode, TurnEdge, StreetEdge } from "@/types/turnAware";
import {
  CycleDetector,
  type CycleDetectorConfig,
  DEFAULT_CYCLE_CONFIG,
} from "./cycleDetector";

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
  options: TurnAwareCppOptions = {}
): TurnAwareCppResult {
  const {
    enableCycleDetection = true,
    cycleConfig = {},
  } = options;

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
    if (!list) { list = []; adj.set(fk, list); }
    list.push(i);
  }

  // Initialize cycle detector
  const cycleDetector = enableCycleDetection
    ? new CycleDetector({ ...DEFAULT_CYCLE_CONFIG, ...cycleConfig })
    : null;
  let loopsDetected = 0;
  let escapeAttempts = 0;
  let tabuNodesUsed = 0;

  // Sort adjacency lists to control Hierholzer traversal order.
  // Priority: non-deadhead first, then U-turns last (with extra penalty for
  // dead-end U-turns that would cause re-traversal), then prefer destinations
  // with higher out-degree (more unvisited territory), then by cost.
  const sortAdjacency = (indices: number[], currentKey?: string) => {
    indices.sort((a, b) => {
      const ea = turnEdges[a]!;
      const eb = turnEdges[b]!;
      
      // If cycle detection is active, apply tabu penalties
      if (cycleDetector) {
        const aTabu = cycleDetector.isTabu(toKeyArr[a]!) ? 1000 : 0;
        const bTabu = cycleDetector.isTabu(toKeyArr[b]!) ? 1000 : 0;
        if (aTabu !== bTabu) return aTabu - bTabu;
        
        const aPenalty = cycleDetector.getPenalty(toKeyArr[a]!);
        const bPenalty = cycleDetector.getPenalty(toKeyArr[b]!);
        if (Math.abs(aPenalty - bPenalty) > 50) return aPenalty - bPenalty;
      }
      
      const aDeadhead = ea.deadhead ? 1 : 0;
      const bDeadhead = eb.deadhead ? 1 : 0;
      if (aDeadhead !== bDeadhead) return aDeadhead - bDeadhead;
      
      // U-turn handling with dead-end awareness
      const aUturn = ea.turnType === "u-turn" ? 1 : 0;
      const bUturn = eb.turnType === "u-turn" ? 1 : 0;
      if (aUturn !== bUturn) return aUturn - bUturn;
      
      // For U-turns, prefer those that don't lead to dead-ends (degree 1)
      if (aUturn && bUturn) {
        const aDeg = adj.get(toKeyArr[a]!)?.length ?? 0;
        const bDeg = adj.get(toKeyArr[b]!)?.length ?? 0;
        if (aDeg <= 1 && bDeg > 1) return 1;
        if (bDeg <= 1 && aDeg > 1) return -1;
      }
      
      const aDeg = adj.get(toKeyArr[a]!)?.length ?? 0;
      const bDeg = adj.get(toKeyArr[b]!)?.length ?? 0;
      if (aDeg !== bDeg) return bDeg - aDeg;
      return ea.totalCost - eb.totalCost;
    });
  };

  // Initial sort
  adj.forEach((indices) => sortAdjacency(indices));

  // Use index pointers instead of shift() (O(1) vs O(n) per dequeue)
  const remainingIdx = new Map<string, number>();
  adj.forEach((_, key) => { remainingIdx.set(key, 0); });

  // Incremental counter — O(1) per edge consumption instead of O(V) per iteration
  let remainingEdgeCount = turnEdges.length;

  const stats = { right: 0, left: 0, uTurn: 0, straight: 0 };

  const startKey: string = startNode
    ? `${startNode.edgeId}:${startNode.direction}`
    : adj.keys().next().value ?? "";

  // Hierholzer's: use edge stack, append on backtrack
  const nodeStack: string[] = [startKey];
  const edgeIdxStack: number[] = [-1]; // edge index that led to this node (-1 = none)
  const circuit: TurnEdge[] = [];
  
  // Safety cap to prevent true infinite loops
  const maxIterations = turnEdges.length * 10;
  let iterations = 0;

  while (nodeStack.length > 0 && iterations < maxIterations) {
    iterations++;
    const key = nodeStack[nodeStack.length - 1]!;
    const indices = adj.get(key);
    const idx = remainingIdx.get(key) ?? 0;

    let loopEscapeMode = false;
    if (cycleDetector) {
      // Check for infinite loop patterns (remainingEdgeCount maintained incrementally)
      const detection = cycleDetector.enterNode(key, remainingEdgeCount);
      if (detection.isLooping) {
        loopsDetected++;
        // Only log every 10th loop to reduce spam
        if (loopsDetected % 10 === 1) {
          console.warn(
            `[TurnAwareCPP] Loop detected (${detection.loopType}) at ${key}, ` +
            `attempting escape. Tabu nodes: ${detection.tabuNodes.size}`
          );
        }
        loopEscapeMode = true;
        escapeAttempts++;
        tabuNodesUsed += detection.tabuNodes.size;
        
        // If severely stuck (50+ stagnant iterations), force backtrack
        if (detection.stagnantIterations > 50 && nodeStack.length > 3) {
          cycleDetector.leaveNode(key);
          nodeStack.pop();
          const edgeIdx = edgeIdxStack.pop()!;
          if (edgeIdx >= 0) {
            circuit.push(turnEdges[edgeIdx]!);
          }
          continue;
        }
        
        // Re-sort adjacency with stronger penalties in escape mode
        if (indices && idx < indices.length) {
          const remaining = indices.slice(idx);
          sortAdjacency(remaining, key);
          indices.splice(idx, indices.length - idx, ...remaining);
        }
      }
    }

    if (indices && idx < indices.length) {
      // Find best non-tabu edge
      let edgeIdx = indices[idx]!;
      let searchIdx = idx;
      
      // Build set of recent stack nodes to avoid in escape mode
      const recentStackNodes = new Set<string>();
      if (loopEscapeMode && nodeStack.length > 5) {
        for (let i = Math.max(0, nodeStack.length - 20); i < nodeStack.length; i++) {
          recentStackNodes.add(nodeStack[i]!);
        }
      }
      
      if (cycleDetector) {
        while (searchIdx < indices.length) {
          const candidateIdx = indices[searchIdx]!;
          const targetKey = toKeyArr[candidateIdx]!;
          const isTabu = cycleDetector.isTabu(targetKey);
          const isRecentStack = loopEscapeMode && recentStackNodes.has(targetKey);
          
          // In escape mode, also avoid recent stack nodes
          if (!isTabu && !isRecentStack) {
            edgeIdx = candidateIdx;
            break;
          }
          // If only avoiding recent stack (not tabu), still consider it
          if (!isTabu && isRecentStack && searchIdx === indices.length - 1) {
            edgeIdx = candidateIdx;
            break;
          }
          searchIdx++;
        }
        
        // If all edges lead to tabu nodes, clear tabu and take first available
        if (searchIdx >= indices.length && idx < indices.length) {
          edgeIdx = indices[idx]!;
          cycleDetector.clearTabu(toKeyArr[edgeIdx]!);
        }
        
        // Update lowlink for SCC tracking
        cycleDetector.updateLowlink(key, toKeyArr[edgeIdx]!);
      }
      
      // Decrement for all edges skipped (tabu or otherwise) plus the one consumed
      const edgesConsumed = searchIdx + 1 - (remainingIdx.get(key) ?? 0);
      remainingEdgeCount -= edgesConsumed;
      remainingIdx.set(key, searchIdx + 1);
      nodeStack.push(toKeyArr[edgeIdx]!);
      edgeIdxStack.push(edgeIdx);
    } else {
      // Backtrack
      if (cycleDetector) {
        cycleDetector.leaveNode(key);
      }
      nodeStack.pop();
      const edgeIdx = edgeIdxStack.pop()!;
      if (edgeIdx >= 0) {
        circuit.push(turnEdges[edgeIdx]!);
      }
    }
  }

  if (iterations >= maxIterations) {
    console.error(
      `[TurnAwareCPP] Hit iteration cap (${maxIterations}). ` +
      `Circuit has ${circuit.length} edges, graph has ${turnEdges.length}.`
    );
    if (cycleDetector) {
      const diag = cycleDetector.getDiagnostics();
      console.error(`[TurnAwareCPP] Diagnostics:`, diag);
    }
  }

  // Reverse to get correct traversal order
  circuit.reverse();

  // Warn if edges remain unconsumed (graph wasn't fully Eulerian/connected)
  if (remainingEdgeCount > 0) {
    console.warn(`[TurnAwareCPP] Hierholzer left ${remainingEdgeCount} unconsumed edges — graph may not be Eulerian or fully connected`);
  }

  // Tally turn stats
  for (const edge of circuit) {
    if (edge.turnType === "u-turn") stats.uTurn++;
    else stats[edge.turnType]++;
  }

  const totalCost = circuit.reduce((sum, e) => sum + e.totalCost, 0);
  
  const result: TurnAwareCppResult = { circuit, totalCost, stats };
  if (enableCycleDetection) {
    result.cycleDiagnostics = {
      loopsDetected,
      escapeAttempts,
      tabuNodesUsed,
    };
  }
  return result;
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
  forward: boolean
): [number, number] {
  return forward ? coords[index]! : coords[coords.length - 1 - index]!;
}

/** Convert turn circuit to route points (lat/lon, nodeId) using street edges.
 *  Bridge edges (synthetic connections between SCCs) are skipped since they have
 *  no real street geometry and would cause the route to scribble across the map. */
export function turnCircuitToRoutePoints(
  streetEdges: StreetEdge[],
  circuit: TurnEdge[]
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
          const nodeId = j === 0 ? startNode : j === len - 1 ? endNode : undefined;
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
      const nodeId = j === 0 ? startNodeId : j === len - 1 ? endNodeId : undefined;
      if (nodeId != null) {
        points.push({ latitude: lat, longitude: lon, nodeId });
      } else {
        points.push({ latitude: lat, longitude: lon });
      }
    }
  }
  return points;
}
