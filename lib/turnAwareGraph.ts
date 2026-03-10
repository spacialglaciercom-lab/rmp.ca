import type {
  StreetEdge,
  TurnNode,
  TurnEdge,
} from "@/types/turnAware";
import { DEFAULT_STATIC_PENALTIES } from "@/types/turnAware";

/** Yield control to the UI thread so React can paint updates. */
const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Progress callback for long-running pipeline steps. */
export type PipelineProgressCallback = (step: string, detail?: string) => void;

/** Calculate bearing between two coordinates (degrees 0–360). */
function calculateBearing(
  start: [number, number],
  end: [number, number]
): number {
  const lat1 = (start[0] * Math.PI) / 180;
  const lat2 = (end[0] * Math.PI) / 180;
  const dLon = ((end[1] - start[1]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/** Classify turn based on angle difference. */
function classifyTurn(
  incomingBearing: number,
  outgoingBearing: number
): keyof typeof DEFAULT_STATIC_PENALTIES {
  let angleDiff = (outgoingBearing - incomingBearing + 360) % 360;
  if (angleDiff >= 340 || angleDiff <= 20) return "straight";
  if (angleDiff > 20 && angleDiff <= 160) return "right";
  if (angleDiff > 160 && angleDiff <= 200) return "u-turn";
  return "left";
}

/** Lightweight reference to a street edge in the adjacency list.
 *  Avoids copying the full StreetEdge object (especially coordinates). */
interface AdjRef {
  /** Index into the streetEdges array. */
  idx: number;
  /** True when traversing the edge in reverse (bidirectional edge). */
  reversed: boolean;
}

/** Build adjacency list from street edges (node id -> outgoing edge refs).
 *  Uses lightweight index references instead of copying edge objects. */
function buildAdjacencyList(edges: StreetEdge[]): Map<string, AdjRef[]> {
  const adj = new Map<string, AdjRef[]>();
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    let fromList = adj.get(edge.from);
    if (!fromList) { fromList = []; adj.set(edge.from, fromList); }
    fromList.push({ idx: i, reversed: false });
    if (!edge.oneWay) {
      let toList = adj.get(edge.to);
      if (!toList) { toList = []; adj.set(edge.to, toList); }
      toList.push({ idx: i, reversed: true });
    }
  }
  return adj;
}

/**
 * Optional ML-derived penalties per OSM way id: baseTime is multiplied by (1 + penalty).
 * Used to bias the turn-aware CPP away from narrow / time-restricted edges.
 */
export type EdgePenaltyMultipliers = Map<string, number>;

/** Transform street graph to turn-expanded graph. */
export async function buildTurnExpandedGraph(
  streetEdges: StreetEdge[],
  penalties: typeof DEFAULT_STATIC_PENALTIES = DEFAULT_STATIC_PENALTIES,
  edgePenaltyMultipliers?: EdgePenaltyMultipliers,
  onProgress?: PipelineProgressCallback,
  avoidedIntersections?: Set<string>
): Promise<{ nodes: TurnNode[]; edges: TurnEdge[] }> {
  const adj = buildAdjacencyList(streetEdges);
  const turnNodes = new Map<string, TurnNode>();
  const turnEdges: TurnEdge[] = [];

  // Pre-compute bearings for each edge (avoids repeated trig).
  // forwardEntry[i] = bearing at first segment (coords[0]->coords[1])
  // forwardExit[i]  = bearing at last segment (coords[n-2]->coords[n-1])
  // Reverse bearings are just the opposite endpoints.
  const forwardEntry = new Float64Array(streetEdges.length);
  const forwardExit = new Float64Array(streetEdges.length);
  const reverseEntry = new Float64Array(streetEdges.length);
  const reverseExit = new Float64Array(streetEdges.length);

  for (let i = 0; i < streetEdges.length; i++) {
    const coords = streetEdges[i]!.coordinates;
    if (coords.length < 2) continue;
    const last = coords.length - 1;
    forwardEntry[i] = calculateBearing(coords[0]!, coords[1]!);
    forwardExit[i] = calculateBearing(coords[last - 1]!, coords[last]!);
    // Reverse: entry at last->last-1, exit at 1->0
    reverseEntry[i] = calculateBearing(coords[last]!, coords[last - 1]!);
    reverseExit[i] = calculateBearing(coords[1]!, coords[0]!);
  }

  // Pre-compute base time for each edge (avoids recomputing per turn edge)
  const baseTimeCache = new Float64Array(streetEdges.length);
  for (let i = 0; i < streetEdges.length; i++) {
    const e = streetEdges[i]!;
    const speedKmh = e.speed > 0 ? e.speed : 30; // fallback 30 km/h if missing
    let bt = (e.length / 1000) / (speedKmh / 3600); // seconds
    const mlPenalty = edgePenaltyMultipliers?.get(e.wayId ?? e.id) ?? 0;
    baseTimeCache[i] = bt * (1 + mlPenalty);
  }

  onProgress?.("build-graph", `Pre-computed bearings for ${streetEdges.length} edges`);
  await yieldToUI();

  // Create turn nodes: one for each (street, direction) pair
  for (let i = 0; i < streetEdges.length; i++) {
    const edge = streetEdges[i]!;
    turnNodes.set(`${edge.id}:forward`, {
      edgeId: edge.id,
      direction: "forward",
      intersectionId: edge.from,
    });
    if (!edge.oneWay) {
      turnNodes.set(`${edge.id}:backward`, {
        edgeId: edge.id,
        direction: "backward",
        intersectionId: edge.to,
      });
    }
  }

  // Helper to process outgoing edges from an intersection
  const processOutgoing = (
    incomingIdx: number,
    incomingReversed: boolean,
    incomingBearing: number,
    intersectionId: string,
    fromNode: TurnNode,
    idPrefix: string
  ) => {
    const outgoing = adj.get(intersectionId);
    if (!outgoing) return;
    const incomingId = streetEdges[incomingIdx]!.id;

    for (let j = 0; j < outgoing.length; j++) {
      const ref = outgoing[j]!;
      const outEdge = streetEdges[ref.idx]!;

      // Skip same-direction traversal of the same edge
      if (outEdge.id === incomingId && ref.reversed === incomingReversed) continue;

      if (outEdge.coordinates.length < 2) continue;

      // Outgoing bearing: entry bearing of the outgoing traversal direction
      const outgoingBearing = ref.reversed ? reverseEntry[ref.idx]! : forwardEntry[ref.idx]!;
      const turnType = classifyTurn(incomingBearing, outgoingBearing);
      const basePenalty = penalties[turnType];
      // If this intersection is in the avoided set, apply a prohibitive penalty
      // so the solver routes around it entirely (misclassified roads, etc.)
      const effectivePenalty = avoidedIntersections?.has(intersectionId)
        ? 999999
        : basePenalty;
      const baseTime = baseTimeCache[ref.idx]!;

      const outDirection: "forward" | "backward" = ref.reversed ? "backward" : "forward";
      const toIntersection = ref.reversed ? outEdge.to : outEdge.from;

      turnEdges.push({
        id: `${idPrefix}->${outEdge.id}${ref.reversed ? ":r" : ""}`,
        from: fromNode,
        to: {
          edgeId: outEdge.id,
          direction: outDirection,
          intersectionId: toIntersection,
        },
        turnType,
        staticPenalty: effectivePenalty,
        baseTime,
        totalCost: baseTime + effectivePenalty,
      });
    }
  };

  // Create turn edges for each street edge
  for (let i = 0; i < streetEdges.length; i++) {
    const incoming = streetEdges[i]!;
    if (incoming.coordinates.length < 2) continue;

    // Forward direction: exits at incoming.to
    processOutgoing(
      i,
      false,
      forwardExit[i]!,
      incoming.to,
      { edgeId: incoming.id, direction: "forward", intersectionId: incoming.to },
      incoming.id
    );

    // Backward direction if not one-way: exits at incoming.from
    if (!incoming.oneWay) {
      processOutgoing(
        i,
        true,
        reverseExit[i]!,
        incoming.from,
        { edgeId: incoming.id, direction: "backward", intersectionId: incoming.from },
        `${incoming.id}:b`
      );
    }

    // Yield every 200 edges to keep UI responsive
    if (i > 0 && i % 200 === 0) await yieldToUI();
  }

  return {
    nodes: Array.from(turnNodes.values()),
    edges: turnEdges,
  };
}

function nodeKey(n: TurnNode): string {
  return `${n.edgeId}:${n.direction}`;
}

/** Parse a turn-node key back into a TurnNode. */
function parseNodeKey(key: string): TurnNode {
  const idx = key.lastIndexOf(":");
  return {
    edgeId: key.slice(0, idx),
    direction: key.slice(idx + 1) as "forward" | "backward",
    intersectionId: "",
  };
}

/**
 * Compute SCCs using Kosaraju's algorithm (iterative DFS to avoid stack overflow
 * on large graphs). Uses numeric node indices internally for speed; returns
 * a Map from node key to SCC id.
 */
function computeSCCs(turnEdges: TurnEdge[]): Map<string, number> {
  // Map string keys to numeric indices for faster operations
  const keyToIdx = new Map<string, number>();
  let nextIdx = 0;
  const getIdx = (key: string): number => {
    let idx = keyToIdx.get(key);
    if (idx === undefined) { idx = nextIdx++; keyToIdx.set(key, idx); }
    return idx;
  };

  // Pre-compute all keys and indices
  const fromKeys = new Array<string>(turnEdges.length);
  const toKeys = new Array<string>(turnEdges.length);
  for (let i = 0; i < turnEdges.length; i++) {
    fromKeys[i] = nodeKey(turnEdges[i]!.from);
    toKeys[i] = nodeKey(turnEdges[i]!.to);
    getIdx(fromKeys[i]!);
    getIdx(toKeys[i]!);
  }

  const n = nextIdx;
  // Build adjacency using arrays of arrays (faster than Map<string, string[]>)
  const outAdj: number[][] = new Array(n);
  const inAdj: number[][] = new Array(n);
  for (let i = 0; i < n; i++) { outAdj[i] = []; inAdj[i] = []; }

  for (let i = 0; i < turnEdges.length; i++) {
    const fromI = keyToIdx.get(fromKeys[i]!)!;
    const toI = keyToIdx.get(toKeys[i]!)!;
    outAdj[fromI]!.push(toI);
    inAdj[toI]!.push(fromI);
  }

  // Iterative DFS pass 1: compute finish order
  const order: number[] = [];
  const visited = new Uint8Array(n); // 0 = unvisited
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    const stack: Array<{ node: number; idx: number }> = [{ node: start, idx: 0 }];
    visited[start] = 1;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = outAdj[frame.node]!;
      if (frame.idx < neighbors.length) {
        const next = neighbors[frame.idx++]!;
        if (!visited[next]) {
          visited[next] = 1;
          stack.push({ node: next, idx: 0 });
        }
      } else {
        order.push(frame.node);
        stack.pop();
      }
    }
  }

  // Iterative DFS pass 2: assign SCC ids in reverse finish order
  const sccIdArr = new Int32Array(n).fill(-1);
  let currentId = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const start = order[i]!;
    if (sccIdArr[start] !== -1) continue;
    const stack = [start];
    sccIdArr[start] = currentId;
    while (stack.length > 0) {
      const u = stack.pop()!;
      const neighbors = inAdj[u]!;
      for (let j = 0; j < neighbors.length; j++) {
        const v = neighbors[j]!;
        if (sccIdArr[v] === -1) {
          sccIdArr[v] = currentId;
          stack.push(v);
        }
      }
    }
    currentId++;
  }

  // Convert back to string-keyed Map for API compatibility
  const sccId = new Map<string, number>();
  keyToIdx.forEach((idx, key) => { sccId.set(key, sccIdArr[idx]!); });
  return sccId;
}

/**
 * Restrict to the largest strongly connected component so the Eulerian circuit
 * covers one coherent area and does not skip segments in other components.
 */
export function restrictToLargestSCC(turnEdges: TurnEdge[]): TurnEdge[] {
  const sccId = computeSCCs(turnEdges);

  const sccSizes = new Map<number, number>();
  sccId.forEach((id) => sccSizes.set(id, (sccSizes.get(id) ?? 0) + 1));
  let maxId = 0;
  let maxSize = 0;
  sccSizes.forEach((size, id) => {
    if (size > maxSize) {
      maxSize = size;
      maxId = id;
    }
  });
  const inLargest = new Set<string>();
  sccId.forEach((id, node) => {
    if (id === maxId) inLargest.add(node);
  });

  return turnEdges.filter(
    (e) => inLargest.has(nodeKey(e.from)) && inLargest.has(nodeKey(e.to))
  );
}

/** High cost for deadhead edges (seconds). */
const DEADHEAD_COST = 60;

/**
 * Bridge all SCCs into one connected component by finding actual shortest paths
 * through the existing turn-edge graph (Dijkstra on an undirected view).
 * Unlike the old approach which added synthetic "crow-flies" bridge edges,
 * this version duplicates real edges as deadhead connections so the route
 * never leaves the allowed OSM road network.
 *
 * Falls back to dropping small SCCs if no real path can be found (e.g. truly
 * disconnected road segments at the edge of an OSM export area).
 */
export async function bridgeAllSCCs(
  turnEdges: TurnEdge[],
  streetEdges: StreetEdge[],
  cachedSCCs?: Map<string, number>,
  onProgress?: PipelineProgressCallback
): Promise<TurnEdge[]> {
  const sccId = cachedSCCs ?? computeSCCs(turnEdges);
  onProgress?.("bridge", `Computed SCCs for ${sccId.size} nodes`);
  if (sccId.size === 0) return turnEdges;

  // Find largest SCC
  const sccSizes = new Map<number, number>();
  sccId.forEach((id) => sccSizes.set(id, (sccSizes.get(id) ?? 0) + 1));
  let maxId = 0;
  let maxSize = 0;
  sccSizes.forEach((size, id) => {
    if (size > maxSize) {
      maxSize = size;
      maxId = id;
    }
  });

  // If only one SCC, no bridging needed
  if (sccSizes.size <= 1) return turnEdges;

  // Group nodes by SCC
  const sccNodes = new Map<number, string[]>();
  sccId.forEach((id, node) => {
    if (!sccNodes.has(id)) sccNodes.set(id, []);
    sccNodes.get(id)!.push(node);
  });

  // Build undirected adjacency for Dijkstra across ALL turn edges.
  // We treat every turn edge as bidirectional for pathfinding so we can
  // reach disconnected SCCs via the real street network.
  const uAdj = new Map<string, Array<{ edge: TurnEdge; toKey: string }>>();
  for (const e of turnEdges) {
    const fk = nodeKey(e.from);
    const tk = nodeKey(e.to);
    let fList = uAdj.get(fk);
    if (!fList) { fList = []; uAdj.set(fk, fList); }
    fList.push({ edge: e, toKey: tk });
    // Reverse direction for undirected pathfinding
    let tList = uAdj.get(tk);
    if (!tList) { tList = []; uAdj.set(tk, tList); }
    tList.push({ edge: e, toKey: fk });
  }

  const largestNodeSet = new Set(sccNodes.get(maxId) ?? []);

  await yieldToUI();

  const bridgeEdges: TurnEdge[] = [];
  let bridgeCount = 0;
  let droppedSCCs = 0;

  // For each non-largest SCC, find shortest real path to any node in largest SCC
  sccNodes.forEach((nodes, id) => {
    if (id === maxId || nodes.length === 0) return;

    // Dijkstra from all nodes in this small SCC to any node in largest SCC
    const dist = new Map<string, number>();
    const prev = new Map<string, { node: string; edge: TurnEdge; reversed: boolean }>();
    // Simple priority queue (array-based, adequate for bridge pathfinding)
    const pq: Array<{ key: string; cost: number }> = [];

    // Seed with all nodes from this small SCC (multi-source Dijkstra)
    for (const startKey of nodes) {
      dist.set(startKey, 0);
      pq.push({ key: startKey, cost: 0 });
    }
    // Sort initial PQ
    pq.sort((a, b) => a.cost - b.cost);

    let found: string | null = null;
    let steps = 0;
    // Increased from 10000 to 50000 to handle larger graphs with more disconnected
    // components (e.g., cul-de-sacs and dead-end streets that form "islands")
    const MAX_DIJKSTRA_STEPS = 50000;

    while (pq.length > 0 && steps < MAX_DIJKSTRA_STEPS) {
      steps++;
      const { key: u, cost: uCost } = pq.shift()!;
      if (uCost > (dist.get(u) ?? Infinity)) continue; // stale entry

      if (largestNodeSet.has(u)) {
        found = u;
        break;
      }

      const neighbors = uAdj.get(u);
      if (!neighbors) continue;
      for (const { edge, toKey: v } of neighbors) {
        const newCost = uCost + edge.totalCost;
        if (newCost < (dist.get(v) ?? Infinity)) {
          dist.set(v, newCost);
          // Track whether we used this edge in reverse direction
          const fk = nodeKey(edge.from);
          prev.set(v, { node: u, edge, reversed: fk !== u });
          // Insert sorted (simple linear insert for moderate sizes)
          let ins = pq.length;
          for (let k = 0; k < pq.length; k++) {
            if (pq[k]!.cost > newCost) { ins = k; break; }
          }
          pq.splice(ins, 0, { key: v, cost: newCost });
        }
      }
    }

    if (!found) {
      // No real path exists — drop this SCC (truly disconnected, e.g. at export boundary)
      droppedSCCs++;
      const totalEdgesInSCC = turnEdges.filter(e => 
        nodes.includes(nodeKey(e.from)) || nodes.includes(nodeKey(e.to))
      ).length;
      console.warn(
        `[bridgeAllSCCs] Dropping SCC ${id} (${nodes.length} nodes, ~${totalEdgesInSCC} edges) — ` +
        `no real path to main component after ${steps} Dijkstra steps`
      );
      return;
    }

    // Reconstruct path and add as deadhead edges
    let cur = found;
    const pathEdges: Array<{ edge: TurnEdge; reversed: boolean }> = [];
    while (prev.has(cur)) {
      const info = prev.get(cur)!;
      pathEdges.push({ edge: info.edge, reversed: info.reversed });
      cur = info.node;
    }
    pathEdges.reverse();

    for (const { edge, reversed } of pathEdges) {
      if (reversed) {
        // Add a reverse copy of the edge
        bridgeEdges.push({
          id: `bridge-${bridgeCount++}`,
          from: edge.to,
          to: edge.from,
          turnType: edge.turnType,
          staticPenalty: edge.staticPenalty,
          baseTime: edge.baseTime,
          totalCost: edge.totalCost,
          deadhead: true,
        });
      } else {
        bridgeEdges.push({
          id: `bridge-${bridgeCount++}`,
          from: edge.from,
          to: edge.to,
          turnType: edge.turnType,
          staticPenalty: edge.staticPenalty,
          baseTime: edge.baseTime,
          totalCost: edge.totalCost,
          deadhead: true,
        });
      }
    }
  });

  if (droppedSCCs > 0) {
    // Remove edges belonging to dropped SCCs
    const droppedNodes = new Set<string>();
    sccNodes.forEach((nodes, id) => {
      if (id === maxId) return;
      // Check if this SCC was dropped (no bridge edges connect to it)
      const sccNodeSet = new Set(nodes);
      const hasBridge = bridgeEdges.some(e =>
        sccNodeSet.has(nodeKey(e.from)) || sccNodeSet.has(nodeKey(e.to))
      );
      if (!hasBridge) {
        for (const n of nodes) droppedNodes.add(n);
      }
    });
    if (droppedNodes.size > 0) {
      const filtered = turnEdges.filter(e =>
        !droppedNodes.has(nodeKey(e.from)) && !droppedNodes.has(nodeKey(e.to))
      );
      // Replace turnEdges contents
      turnEdges.length = 0;
      for (const e of filtered) turnEdges.push(e);
    }
  }

  // Append bridge (deadhead) edges
  for (let i = 0; i < bridgeEdges.length; i++) {
    turnEdges.push(bridgeEdges[i]!);
  }
  onProgress?.("bridge", `Bridged ${sccSizes.size - 1 - droppedSCCs} SCCs with ${bridgeEdges.length} real-path edges (dropped ${droppedSCCs} unreachable SCCs)`);
  return turnEdges;
}

/**
 * Make a directed graph Eulerian by adding minimum deadhead edges to balance
 * in-degree and out-degree at every node. Uses multi-target BFS from each
 * excess-out node to find nearest excess-in node efficiently.
 */
export async function makeEulerian(turnEdges: TurnEdge[], onProgress?: PipelineProgressCallback): Promise<TurnEdge[]> {
  // Compute in-degree and out-degree
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();

  turnEdges.forEach((e) => {
    const fromK = nodeKey(e.from);
    const toK = nodeKey(e.to);
    outDeg.set(fromK, (outDeg.get(fromK) ?? 0) + 1);
    inDeg.set(toK, (inDeg.get(toK) ?? 0) + 1);
    if (!inDeg.has(fromK)) inDeg.set(fromK, 0);
    if (!outDeg.has(toK)) outDeg.set(toK, 0);
  });

  // Find imbalanced nodes
  const excessOut: { key: string; surplus: number }[] = [];
  const excessInMap = new Map<string, number>(); // key -> remaining surplus

  const allNodes = new Set([...inDeg.keys(), ...outDeg.keys()]);
  allNodes.forEach((key) => {
    const inD = inDeg.get(key) ?? 0;
    const outD = outDeg.get(key) ?? 0;
    if (outD > inD) {
      excessOut.push({ key, surplus: outD - inD });
    } else if (inD > outD) {
      excessInMap.set(key, inD - outD);
    }
  });

  if (excessOut.length === 0 && excessInMap.size === 0) {
    return turnEdges; // Already Eulerian
  }

  // Build adjacency for BFS — store edge + pre-computed "to" key together
  // to avoid repeated nodeKey() calls inside the BFS loop.
  const adj = new Map<string, Array<{ edge: TurnEdge; toKey: string }>>();
  for (let i = 0; i < turnEdges.length; i++) {
    const e = turnEdges[i]!;
    const fromK = nodeKey(e.from);
    let list = adj.get(fromK);
    if (!list) { list = []; adj.set(fromK, list); }
    list.push({ edge: e, toKey: nodeKey(e.to) });
  }

  /** Dijkstra from src to nearest node in targetSet, weighted by totalCost.
   *  Returns the minimum-cost path as turn edges, or null if unreachable.
   *  Limited to maxSteps to avoid hanging on huge graphs. */
  function dijkstraToNearest(
    src: string,
    targetSet: Set<string>,
    maxSteps: number = 5000
  ): { target: string; path: TurnEdge[] } | null {
    if (targetSet.has(src)) return { target: src, path: [] };
    const dist = new Map<string, number>();
    const prev = new Map<string, { node: string; edge: TurnEdge }>();
    dist.set(src, 0);
    // Simple sorted array PQ (good enough for moderate graph sizes)
    const pq: Array<{ key: string; cost: number }> = [{ key: src, cost: 0 }];
    let steps = 0;

    while (pq.length > 0 && steps < maxSteps) {
      steps++;
      const { key: u, cost: uCost } = pq.shift()!;
      if (uCost > (dist.get(u) ?? Infinity)) continue; // stale

      if (u !== src && targetSet.has(u)) {
        // Reconstruct path
        const path: TurnEdge[] = [];
        let cur = u;
        while (cur !== src) {
          const info = prev.get(cur)!;
          path.push(info.edge);
          cur = info.node;
        }
        path.reverse();
        return { target: u, path };
      }

      const neighbors = adj.get(u);
      if (!neighbors) continue;
      for (let j = 0; j < neighbors.length; j++) {
        const { edge, toKey: v } = neighbors[j]!;
        const newCost = uCost + edge.totalCost;
        if (newCost < (dist.get(v) ?? Infinity)) {
          dist.set(v, newCost);
          prev.set(v, { node: u, edge });
          // Binary-ish insert to keep sorted
          let ins = pq.length;
          for (let k = 0; k < pq.length; k++) {
            if (pq[k]!.cost > newCost) { ins = k; break; }
          }
          pq.splice(ins, 0, { key: v, cost: newCost });
        }
      }
    }
    return null;
  }

  const deadheadEdges: TurnEdge[] = [];
  let deadheadId = 0;
  const targetSet = new Set(excessInMap.keys());

  const MAX_BALANCE_ITERATIONS = 500;
  const MAX_DEADHEAD_EDGES = turnEdges.length * 4;
  let totalIterations = 0;

  for (const out of excessOut) {
    let surplus = out.surplus;
    while (
      surplus > 0 &&
      targetSet.size > 0 &&
      totalIterations < MAX_BALANCE_ITERATIONS &&
      deadheadEdges.length < MAX_DEADHEAD_EDGES
    ) {
      totalIterations++;
      if (totalIterations % 50 === 0) await yieldToUI();
      const result = dijkstraToNearest(out.key, targetSet);
      if (!result) break;

      const pairCount = Math.min(surplus, excessInMap.get(result.target) ?? 1);

      for (let c = 0; c < pairCount; c++) {
        if (deadheadEdges.length >= MAX_DEADHEAD_EDGES) break;
        for (let p = 0; p < result.path.length; p++) {
          const edge = result.path[p]!;
          deadheadEdges.push({
            id: `deadhead-${deadheadId++}`,
            from: edge.from,
            to: edge.to,
            turnType: edge.turnType,
            staticPenalty: edge.staticPenalty,
            baseTime: edge.baseTime,
            totalCost: edge.totalCost,
            deadhead: true,
          });
        }
      }
      surplus -= pairCount;
      const remaining = (excessInMap.get(result.target) ?? 0) - pairCount;
      if (remaining <= 0) {
        excessInMap.delete(result.target);
        targetSet.delete(result.target);
      } else {
        excessInMap.set(result.target, remaining);
      }
    }
    if (totalIterations >= MAX_BALANCE_ITERATIONS || deadheadEdges.length >= MAX_DEADHEAD_EDGES) break;
  }

  if (totalIterations >= MAX_BALANCE_ITERATIONS || deadheadEdges.length >= MAX_DEADHEAD_EDGES) {
    console.warn(`[makeEulerian] Hit safety cap: ${totalIterations} iterations, ${deadheadEdges.length} deadhead edges — graph may be partially balanced`);
  }

  for (let i = 0; i < deadheadEdges.length; i++) {
    turnEdges.push(deadheadEdges[i]!);
  }
  onProgress?.("eulerian", `Balanced graph: ${deadheadEdges.length} deadhead edges added`);
  return turnEdges;
}

/**
 * Compute SCCs once and return the map for reuse by bridgeAllSCCs.
 * Avoids the double-computation that occurred when bridgeAllSCCs
 * recomputed SCCs internally.
 */
export function precomputeSCCs(turnEdges: TurnEdge[]): Map<string, number> {
  return computeSCCs(turnEdges);
}
