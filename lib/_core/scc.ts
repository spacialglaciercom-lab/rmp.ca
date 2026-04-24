import type { TurnNode, TurnEdge } from "@/types/turnAware";

export function nodeKey(n: TurnNode): string {
  return `${n.edgeId}:${n.direction}`;
}

/** Parse a turn-node key back into a TurnNode. */
export function parseNodeKey(key: string): TurnNode {
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
export function computeSCCs(turnEdges: TurnEdge[]): Map<string, number> {
  const keyToIdx = new Map<string, number>();
  let nextIdx = 0;
  const getIdx = (key: string): number => {
    let idx = keyToIdx.get(key);
    if (idx === undefined) {
      idx = nextIdx++;
      keyToIdx.set(key, idx);
    }
    return idx;
  };

  const fromKeys = new Array<string>(turnEdges.length);
  const toKeys = new Array<string>(turnEdges.length);
  for (let i = 0; i < turnEdges.length; i++) {
    fromKeys[i] = nodeKey(turnEdges[i]!.from);
    toKeys[i] = nodeKey(turnEdges[i]!.to);
    getIdx(fromKeys[i]!);
    getIdx(toKeys[i]!);
  }

  const n = nextIdx;
  const outAdj: number[][] = new Array(n);
  const inAdj: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    outAdj[i] = [];
    inAdj[i] = [];
  }

  for (let i = 0; i < turnEdges.length; i++) {
    const fromI = keyToIdx.get(fromKeys[i]!)!;
    const toI = keyToIdx.get(toKeys[i]!)!;
    outAdj[fromI]!.push(toI);
    inAdj[toI]!.push(fromI);
  }

  // Pass 1: compute finish order
  const order: number[] = [];
  const visited = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    const stack: Array<{ node: number; idx: number }> = [
      { node: start, idx: 0 },
    ];
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

  // Pass 2: assign SCC ids in reverse finish order
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

  const sccId = new Map<string, number>();
  keyToIdx.forEach((idx, key) => {
    sccId.set(key, sccIdArr[idx]!);
  });
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
    (e) => inLargest.has(nodeKey(e.from)) && inLargest.has(nodeKey(e.to)),
  );
}

/**
 * Compute SCCs once and return the map for reuse by bridgeAllSCCs.
 * Avoids the double-computation that occurred when bridgeAllSCCs
 * recomputed SCCs internally.
 */
export function precomputeSCCs(turnEdges: TurnEdge[]): Map<string, number> {
  return computeSCCs(turnEdges);
}
