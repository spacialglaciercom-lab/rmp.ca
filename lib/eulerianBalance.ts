import type { TurnEdge, StreetEdge } from "@/types/turnAware";
import { nodeKey } from "@/lib/_core/scc";
import { computeSCCs } from "@/lib/_core/scc";
import type { PipelineProgressCallback } from "@/lib/turnExpandedGraph";

const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));


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
  onProgress?: PipelineProgressCallback,
): Promise<TurnEdge[]> {
  const sccId = cachedSCCs ?? computeSCCs(turnEdges);
  onProgress?.("bridge", `Computed SCCs for ${sccId.size} nodes`);
  if (sccId.size === 0) return turnEdges;

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

  if (sccSizes.size <= 1) return turnEdges;

  const sccNodes = new Map<number, string[]>();
  sccId.forEach((id, node) => {
    if (!sccNodes.has(id)) sccNodes.set(id, []);
    sccNodes.get(id)!.push(node);
  });

  const uAdj = new Map<string, Array<{ edge: TurnEdge; toKey: string }>>();
  for (const e of turnEdges) {
    const fk = nodeKey(e.from);
    const tk = nodeKey(e.to);
    let fList = uAdj.get(fk);
    if (!fList) {
      fList = [];
      uAdj.set(fk, fList);
    }
    fList.push({ edge: e, toKey: tk });
    let tList = uAdj.get(tk);
    if (!tList) {
      tList = [];
      uAdj.set(tk, tList);
    }
    tList.push({ edge: e, toKey: fk });
  }

  const largestNodeSet = new Set(sccNodes.get(maxId) ?? []);

  await yieldToUI();

  const bridgeEdges: TurnEdge[] = [];
  let bridgeCount = 0;
  let droppedSCCs = 0;

  sccNodes.forEach((nodes, id) => {
    if (id === maxId || nodes.length === 0) return;

    const dist = new Map<string, number>();
    const prev = new Map<
      string,
      { node: string; edge: TurnEdge; reversed: boolean }
    >();
    const pq: Array<{ key: string; cost: number }> = [];

    for (const startKey of nodes) {
      dist.set(startKey, 0);
      pq.push({ key: startKey, cost: 0 });
    }
    pq.sort((a, b) => a.cost - b.cost);

    let found: string | null = null;
    let steps = 0;
    const MAX_DIJKSTRA_STEPS = 50000;

    while (pq.length > 0 && steps < MAX_DIJKSTRA_STEPS) {
      steps++;
      const { key: u, cost: uCost } = pq.shift()!;
      if (uCost > (dist.get(u) ?? Infinity)) continue;

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
          const fk = nodeKey(edge.from);
          prev.set(v, { node: u, edge, reversed: fk !== u });
          let ins = pq.length;
          for (let k = 0; k < pq.length; k++) {
            if (pq[k]!.cost > newCost) {
              ins = k;
              break;
            }
          }
          pq.splice(ins, 0, { key: v, cost: newCost });
        }
      }
    }

    if (!found) {
      droppedSCCs++;
      const totalEdgesInSCC = turnEdges.filter(
        (e) => nodes.includes(nodeKey(e.from)) || nodes.includes(nodeKey(e.to)),
      ).length;
      console.warn(
        `[bridgeAllSCCs] Dropping SCC ${id} (${nodes.length} nodes, ~${totalEdgesInSCC} edges) — ` +
          `no real path to main component after ${steps} Dijkstra steps`,
      );
      return;
    }

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
    const droppedNodes = new Set<string>();
    sccNodes.forEach((nodes, id) => {
      if (id === maxId) return;
      const sccNodeSet = new Set(nodes);
      const hasBridge = bridgeEdges.some(
        (e) => sccNodeSet.has(nodeKey(e.from)) || sccNodeSet.has(nodeKey(e.to)),
      );
      if (!hasBridge) {
        for (const n of nodes) droppedNodes.add(n);
      }
    });
    if (droppedNodes.size > 0) {
      const filtered = turnEdges.filter(
        (e) =>
          !droppedNodes.has(nodeKey(e.from)) &&
          !droppedNodes.has(nodeKey(e.to)),
      );
      turnEdges.length = 0;
      for (const e of filtered) turnEdges.push(e);
    }
  }

  for (let i = 0; i < bridgeEdges.length; i++) {
    turnEdges.push(bridgeEdges[i]!);
  }
  onProgress?.(
    "bridge",
    `Bridged ${sccSizes.size - 1 - droppedSCCs} SCCs with ${bridgeEdges.length} real-path edges (dropped ${droppedSCCs} unreachable SCCs)`,
  );
  return turnEdges;
}

/**
 * Make a directed graph Eulerian by adding minimum deadhead edges to balance
 * in-degree and out-degree at every node. Uses multi-target BFS from each
 * excess-out node to find nearest excess-in node efficiently.
 */
export async function makeEulerian(
  turnEdges: TurnEdge[],
  onProgress?: PipelineProgressCallback,
): Promise<TurnEdge[]> {
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

  const excessOut: { key: string; surplus: number }[] = [];
  const excessInMap = new Map<string, number>();

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
    return turnEdges;
  }

  const adj = new Map<string, Array<{ edge: TurnEdge; toKey: string }>>();
  for (let i = 0; i < turnEdges.length; i++) {
    const e = turnEdges[i]!;
    const fromK = nodeKey(e.from);
    let list = adj.get(fromK);
    if (!list) {
      list = [];
      adj.set(fromK, list);
    }
    list.push({ edge: e, toKey: nodeKey(e.to) });
  }

  function dijkstraToNearest(
    src: string,
    targetSet: Set<string>,
    maxSteps: number = 5000,
  ): { target: string; path: TurnEdge[] } | null {
    if (targetSet.has(src)) return { target: src, path: [] };
    const dist = new Map<string, number>();
    const prev = new Map<string, { node: string; edge: TurnEdge }>();
    dist.set(src, 0);
    const pq: Array<{ key: string; cost: number }> = [{ key: src, cost: 0 }];
    let steps = 0;

    while (pq.length > 0 && steps < maxSteps) {
      steps++;
      const { key: u, cost: uCost } = pq.shift()!;
      if (uCost > (dist.get(u) ?? Infinity)) continue;

      if (u !== src && targetSet.has(u)) {
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
          let ins = pq.length;
          for (let k = 0; k < pq.length; k++) {
            if (pq[k]!.cost > newCost) {
              ins = k;
              break;
            }
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
    if (
      totalIterations >= MAX_BALANCE_ITERATIONS ||
      deadheadEdges.length >= MAX_DEADHEAD_EDGES
    )
      break;
  }

  if (
    totalIterations >= MAX_BALANCE_ITERATIONS ||
    deadheadEdges.length >= MAX_DEADHEAD_EDGES
  ) {
    console.warn(
      `[makeEulerian] Hit safety cap: ${totalIterations} iterations, ${deadheadEdges.length} deadhead edges — graph may be partially balanced`,
    );
  }

  for (let i = 0; i < deadheadEdges.length; i++) {
    turnEdges.push(deadheadEdges[i]!);
  }
  onProgress?.(
    "eulerian",
    `Balanced graph: ${deadheadEdges.length} deadhead edges added`,
  );
  return turnEdges;
}
