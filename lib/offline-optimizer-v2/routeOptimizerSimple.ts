/**
 * Same optimizer as C:\Users\Space\Videos\route-optimizer-mobile-v2\src\routeOptimizerSimple.ts
 * (RouteOptimizerSimple). Kept in sync so the "Optimizer v2" toggle on planner pages uses the
 * exact same algorithm as the Videos app.
 *
 * Only adaptations: class name RouteOptimizerSimpleV2, types from @/lib/route-optimizer-v2/types,
 * route points include nodeId for rmp.ca compatibility, and optional RoutingCostPlugin support
 * (directed edges, transition costs). No console.log.
 *
 * Two-pass vs backend: for each bidirectional OSM segment this builds both directed arcs
 * (A→B and B→A). Hierholzer then uses each arc once → you drive each street in both directions
 * (centerline out-and-back), similar to “service both sides” / two-pass. The Python backend
 * defaults to one undirected edge per street (single pass) unless service_both_sides is true.
 */

import type {
  Node,
  Way,
  OptimizationResult,
} from "@/lib/route-optimizer-v2/types";
import type { RoutingCostPlugin, Coord } from "@/lib/routing_plugins";
import { haversineMeters } from "@/lib/routing_plugins";

interface EdgeData {
  length: number;
  oneway: boolean;
  /** True when the OSM way has dual_carriageway=yes. U-turns are physically impossible. */
  dualCarriageway?: boolean;
  /** OSM way ID — used to detect mid-block nodes (not intersections). */
  wayId?: string;
}

// Turn cost penalties (meters equivalent) — used when no plugins are active.
// U_TURN raised from 800 → 5000 so the optimizer prefers circling a block
// (~400-1200 m) over reversing direction. Test range: 2000 / 5000 / 10000.
const TURN_COSTS = {
  U_TURN: 5_000,
  SHARP_LEFT: 150,
  LEFT_TURN: 50,
  STRAIGHT: 0,
  RIGHT_TURN: -20,
  SHARP_RIGHT: -10,
};

/**
 * Extra penalty (metres) added when a U-turn is attempted on a dual-carriageway road.
 * Dual-carriageway U-turns are physically impossible in most real-world scenarios
 * (physical median divider). 500 km equivalent makes them effectively forbidden.
 */
const DUAL_CARRIAGEWAY_UTURN_METERS = 500_000;

/** Maximum detour (metres) allowed when inserting a block-circling loop to
 *  eliminate a U-turn in the post-circuit repair pass. */
const MAX_UTURN_DETOUR_M = 2_000;

/** Maximum BFS depth (edges) when searching for a non-reversal loop. */
const MAX_LOOP_BFS_DEPTH = 8;

/** Maximum number of repair iterations to prevent runaway loops. */
const MAX_REPAIR_ITERATIONS = 50;

export class RouteOptimizerSimpleV2 {
  private nodes: Map<string, Node>;
  private ways: Way[];
  private graph: Map<string, Map<string, EdgeData>> = new Map();
  private plugins: RoutingCostPlugin[];
  /**
   * Nodes that are NOT intersections — they lie between two intersections on the
   * same OSM way. U-turns at these nodes are physically impossible in real life
   * and must be hard-blocked (not merely penalized).
   */
  private midBlockNodes = new Set<string>();

  constructor(
    nodes: Map<string, Node>,
    ways: Way[],
    plugins?: RoutingCostPlugin[],
  ) {
    this.nodes = nodes;
    this.ways = ways;
    this.plugins = plugins ?? [];
  }

  optimize(customLat?: number, customLon?: number): OptimizationResult {
    this.buildGraph();
    if (this.graph.size === 0) {
      return { route: [], totalDistance: 0, message: "No valid roads found" };
    }

    // Must be built before makeEulerian so augmentation edges don't pollute the detection.
    this.buildMidBlockNodes();
    this.makeEulerian();

    // Run Hierholzer on ALL connected components so disconnected residential
    // roads (and other small clusters) are never silently dropped.
    const components = this.getAllComponents();

    // Order: put component containing the custom start (or largest) first
    components.sort((a, b) => {
      if (customLat !== undefined && customLon !== undefined) {
        const distA = this.closestDist(a, customLat, customLon);
        const distB = this.closestDist(b, customLat, customLon);
        return distA - distB;
      }
      return b.size - a.size;
    });

    const circuits: string[][] = [];
    for (const comp of components) {
      const startNode = this.findStartNodeInComponent(
        comp,
        customLat,
        customLon,
      );
      if (!startNode) continue;
      const circuit = this.hierholzer(startNode);
      if (circuit.length > 1 && circuit[0] === circuit[circuit.length - 1]) {
        // Hierholzer closes the loop: strip the duplicate end node so each
        // component doesn't draw a straight line back to its own start.
        circuit.pop();
      }
      if (circuit.length > 0) circuits.push(circuit);
    }

    if (circuits.length === 0) {
      return {
        route: [],
        totalDistance: 0,
        message: "Could not find start node",
      };
    }

    // Post-circuit U-turn elimination: repair each component circuit
    // individually so BFS loops stay within the correct connected component.
    for (let c = 0; c < circuits.length; c++) {
      circuits[c] = this.eliminateUTurns(circuits[c]!);
    }

    const circuit = circuits.flat();

    const routePoints = circuit
      .map((id) => {
        const n = this.nodes.get(id);
        return n ? { latitude: n.lat, longitude: n.lon, nodeId: id } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const stats = this.calculateStats(circuit);

    return {
      route: routePoints,
      totalDistance: stats.totalKm,
      message: `Offline optimizer (v2): ${stats.totalKm.toFixed(2)} km, ${routePoints.length} points, ${components.length} component(s). Turns: R${stats.rightTurns} L${stats.leftTurns} U${stats.uTurns} S${stats.straight}`,
    };
  }

  /** [lon, lat, z] for plugin calls. */
  private getCoords(nodeId: string): Coord {
    const n = this.nodes.get(nodeId);
    if (!n) return [0, 0, 0];
    return [Number(n.lon), Number(n.lat), n.z ?? 0];
  }

  private buildGraph(): void {
    this.graph.clear();
    const usePlugins = this.plugins.length > 0;
    const emptyData = {} as Record<string, unknown>;

    for (const way of this.ways) {
      const isOneway = way.tags?.oneway === "yes";
      const isDualCarriageway = way.tags?.dual_carriageway === "yes";
      const wayId = way.id ?? undefined;

      for (let i = 0; i < way.nodes.length - 1; i++) {
        const from = way.nodes[i]!;
        const to = way.nodes[i + 1]!;

        const fromNode = this.nodes.get(from);
        const toNode = this.nodes.get(to);
        if (!fromNode || !toNode) continue;

        const distanceM = haversineMeters(
          Number(fromNode.lon),
          Number(fromNode.lat),
          Number(toNode.lon),
          Number(toNode.lat),
        );

        if (usePlugins) {
          const coordsU: Coord = this.getCoords(from);
          const coordsV: Coord = this.getCoords(to);
          let costUV = distanceM;
          let costVU = distanceM;
          for (const plugin of this.plugins) {
            costUV *= plugin.calculateMultiplier(
              coordsU,
              coordsV,
              emptyData,
              emptyData,
              distanceM,
            );
            costVU *= plugin.calculateMultiplier(
              coordsV,
              coordsU,
              emptyData,
              emptyData,
              distanceM,
            );
          }
          if (!this.graph.has(from)) this.graph.set(from, new Map());
          this.graph.get(from)!.set(to, { length: costUV, oneway: isOneway, dualCarriageway: isDualCarriageway || undefined, wayId });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph.get(to)!.set(from, { length: costVU, oneway: false, dualCarriageway: isDualCarriageway || undefined, wayId });
          }
        } else {
          if (!this.graph.has(from)) this.graph.set(from, new Map());
          this.graph.get(from)!.set(to, { length: distanceM, oneway: isOneway, dualCarriageway: isDualCarriageway || undefined, wayId });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph.get(to)!.set(from, { length: distanceM, oneway: false, dualCarriageway: isDualCarriageway || undefined, wayId });
          }
        }
      }
    }
  }

  /**
   * Identify mid-block nodes: nodes with exactly 2 outgoing edges that both
   * belong to the same OSM way. These are shape-point nodes between intersections.
   * U-turns at these nodes are physically impossible in real life.
   */
  private buildMidBlockNodes(): void {
    this.midBlockNodes.clear();
    for (const [nodeId, edges] of this.graph) {
      if (edges.size !== 2) continue;
      const wayIds = new Set<string>();
      for (const data of edges.values()) {
        if (data.wayId) wayIds.add(data.wayId);
      }
      // All edges on the same single way → mid-block node, no U-turn allowed.
      if (wayIds.size === 1) {
        this.midBlockNodes.add(nodeId);
      }
    }
  }

  private makeEulerian(): void {
    // First, ensure reciprocal edges exist (bidirectional completion) for both
    // plugins and non-plugins paths. This balances the graph before any
    // directed augmentation is attempted.
    const toAdd: Array<[string, string, EdgeData]> = [];
    for (const [from, edges] of this.graph) {
      for (const [to, data] of edges) {
        if (data.oneway) continue;
        if (!this.graph.get(to)?.has(from)) {
          toAdd.push([to, from, { length: data.length, oneway: false }]);
        }
      }
    }
    for (const [from, to, data] of toAdd) {
      if (!this.graph.has(from)) this.graph.set(from, new Map());
      this.graph.get(from)!.set(to, data);
    }

    // For plugins path, also run directed balancing (though with reciprocals
    // already added, the graph should be balanced and this becomes a no-op).
    if (this.plugins.length > 0) {
      this.makeEulerianDirected();
    }
  }

  /** Directed graph: balance in/out degree by adding shortest paths (with transition costs). */
  private makeEulerianDirected(): void {
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    for (const [u, edges] of this.graph) {
      outDeg.set(u, (outDeg.get(u) ?? 0) + edges.size);
      for (const v of edges.keys()) {
        inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
      }
    }
    const allNodes = new Set<string>([...this.graph.keys(), ...inDeg.keys()]);
    const deficitCount = new Map<string, number>();
    const surplusCount = new Map<string, number>();
    for (const n of allNodes) {
      const inD = inDeg.get(n) ?? 0;
      const outD = outDeg.get(n) ?? 0;
      const imbalance = outD - inD;
      if (imbalance < 0) deficitCount.set(n, -imbalance);
      else if (imbalance > 0) surplusCount.set(n, imbalance);
    }
    const deficitList = [...deficitCount.keys()];
    const surplusList = [...surplusCount.keys()];
    if (deficitList.length === 0 || surplusList.length === 0) return;

    const pairs: Array<{
      from: string;
      to: string;
      cost: number;
      path: string[];
    }> = [];
    for (const from of deficitList) {
      const { lengths, paths } = this.dijkstraWithTransitionCosts(
        from,
        this.plugins,
      );
      for (const to of surplusList) {
        const cost = lengths[to];
        const path = paths[to];
        if (cost === undefined || !path || path.length < 2) continue;
        pairs.push({ from, to, cost, path });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const deficitRemain = new Map(deficitCount);
    const surplusRemain = new Map(surplusCount);
    const augmentPaths: string[][] = [];
    for (const { from, to, path } of pairs) {
      const dr = deficitRemain.get(from) ?? 0;
      const sr = surplusRemain.get(to) ?? 0;
      if (dr <= 0 || sr <= 0) continue;
      deficitRemain.set(from, dr - 1);
      surplusRemain.set(to, sr - 1);
      augmentPaths.push(path);
    }

    for (const path of augmentPaths) {
      for (let k = 0; k < path.length - 1; k++) {
        const u = path[k]!;
        const v = path[k + 1]!;
        const existing = this.graph.get(u)?.get(v);
        if (!existing) continue;
        // Increment traversal count so Hierholzer covers this edge twice
        existing.count = (existing.count ?? 1) + 1;
      }
    }
  }

  /**
   * Shortest paths with transition costs (UPS-style turn penalties, etc.).
   * Cost to reach node v depends on the previous node (incoming edge), so we use
   * state (node, predecessor) — not a single distance per v, which was wrong and
   * produced huge augmenting paths when pairing for the directed Eulerian circuit.
   */
  private dijkstraWithTransitionCosts(
    source: string,
    plugins: RoutingCostPlugin[],
  ): { lengths: Record<string, number>; paths: Record<string, string[]> } {
    const stateKey = (node: string, pred: string | null) =>
      `${node},${pred ?? ""}`;

    const sk0 = stateKey(source, null);
    const dist: Record<string, number> = { [sk0]: 0 };
    const pathsByState: Record<string, string[]> = { [sk0]: [source] };
    type State = [string, string | null];
    const heap: Array<[number, State]> = [[0, [source, null]]];

    while (heap.length > 0) {
      heap.sort((a, b) => a[0] - b[0]);
      const entry = heap.shift()!;
      const [d, [u, t]] = entry;
      const key = stateKey(u, t);
      if (d > (dist[key] ?? Infinity)) continue;

      const edges = this.graph.get(u);
      if (!edges) continue;

      for (const [v, edgeData] of edges) {
        let transitionMult = 1;
        if (t !== null && plugins.length > 0) {
          const coordsT = this.getCoords(t);
          const coordsU = this.getCoords(u);
          const coordsV = this.getCoords(v);
          for (const plugin of plugins) {
            transitionMult *= plugin.calculateTransitionMultiplier(
              coordsT,
              coordsU,
              coordsV,
            );
          }
        }
        let cost = edgeData.length * transitionMult;

        // Additive U-turn penalty during balancing — ensures augmentation
        // paths route around blocks instead of through U-turns, even when
        // no plugins are active. Applied on top of any plugin multiplier.
        if (t !== null) {
          const inBearing = this.bearing(t, u);
          const outBearing = this.bearing(u, v);
          const turnAngle = this.normalizeTurn(outBearing - inBearing);
          if (Math.abs(turnAngle) > 150) {
            cost += edgeData.dualCarriageway
              ? DUAL_CARRIAGEWAY_UTURN_METERS
              : TURN_COSTS.U_TURN;
          }
        }

        const newKey = stateKey(v, u);
        const newD = d + cost;
        const prevPath = pathsByState[key] ?? [];
        const newPath = [...prevPath, v];
        if (newD < (dist[newKey] ?? Infinity)) {
          dist[newKey] = newD;
          pathsByState[newKey] = newPath;
          heap.push([newD, [v, u]]);
        }
      }
    }

    const lengths: Record<string, number> = {};
    const paths: Record<string, string[]> = {};
    for (const key of Object.keys(dist)) {
      const lastComma = key.lastIndexOf(",");
      const node = lastComma >= 0 ? key.slice(0, lastComma) : key;
      const c = dist[key]!;
      if (lengths[node] === undefined || c < lengths[node]!) {
        lengths[node] = c;
        paths[node] = pathsByState[key]!;
      }
    }
    return { lengths, paths };
  }

  private hierholzer(start: string): string[] {
    const g = new Map<string, Map<string, EdgeData>>();
    let totalEdges = 0;
    for (const [node, edges] of this.graph) {
      const copy = new Map<string, EdgeData>();
      for (const [v, data] of edges) {
        // Deep-copy each EdgeData so count changes don't affect this.graph
        copy.set(v, { ...data });
        totalEdges += data.count ?? 1;
      }
      g.set(node, copy);
    }
    const maxIterations = Math.max(3 * totalEdges, 500_000);

    const circuit: string[] = [];
    const stack: string[] = [start];
    let iterations = 0;

    while (stack.length > 0 && iterations < maxIterations) {
      iterations++;
      const current = stack[stack.length - 1]!;
      const edges = g.get(current);

      if (edges && edges.size > 0) {
        const prev = stack.length > 1 ? stack[stack.length - 2]! : null;
        const next = this.chooseBest(prev, current, edges);

        // Decrement traversal count; only remove the edge when fully consumed
        const edgeData = edges.get(next)!;
        const remaining = (edgeData.count ?? 1) - 1;
        if (remaining > 0) {
          edgeData.count = remaining;
        } else {
          edges.delete(next);
        }
        stack.push(next);
      } else {
        circuit.push(stack.pop()!);
      }
    }

    circuit.reverse();
    return circuit;
  }

  /**
   * Pick the best successor edge during Hierholzer traversal.
   *
   * Hard-partition: non-U-turn candidates are always preferred over U-turns.
   * U-turns are only taken when they are the *only* remaining edges (forced
   * reversal on dead-end stubs). Within each partition, edges are scored by
   * the usual plugin or built-in turn-cost system.
   */
  private chooseBest(
    prev: string | null,
    current: string,
    edges: Map<string, EdgeData>,
  ): string {
    let keys = Array.from(edges.keys());
    if (keys.length === 1) return keys[0]!;
    if (!prev) return keys[0]!;

    // Hard-block U-turns at mid-block (non-intersection) nodes.
    // A vehicle cannot reverse direction between two intersections in real life.
    if (this.midBlockNodes.has(current)) {
      const nonUturn = keys.filter((k) => k !== prev);
      if (nonUturn.length > 0) keys = nonUturn;
    }
    if (keys.length === 1) return keys[0]!;

    const useTransition = this.plugins.length > 0;
    const coordsT = this.getCoords(prev);
    const coordsU = this.getCoords(current);

    let best = candidates[0]!;
    let bestScore = Infinity;

    for (const next of candidates) {
      const edgeData = edges.get(next)!;
      let score: number;

      if (useTransition) {
        const coordsV = this.getCoords(next);
        let mult = 1;
        for (const plugin of this.plugins) {
          mult *= plugin.calculateTransitionMultiplier(
            coordsT,
            coordsU,
            coordsV,
          );
        }
        score = edgeData.length * mult;
      } else {
        const outBearing = this.bearing(current, next);
        const turn = this.normalizeTurn(outBearing - inBearing);
        let cost: number;
        if (Math.abs(turn) > 150) cost = TURN_COSTS.U_TURN;
        else if (turn > 120) cost = TURN_COSTS.SHARP_RIGHT;
        else if (turn > 30) cost = TURN_COSTS.RIGHT_TURN;
        else if (turn >= -30) cost = TURN_COSTS.STRAIGHT;
        else if (turn >= -120) cost = TURN_COSTS.LEFT_TURN;
        else cost = TURN_COSTS.SHARP_LEFT;
        score = edgeData.length + cost;
      }

      // Dual-carriageway U-turn penalty (physically impossible manoeuvre).
      if (edgeData.dualCarriageway) {
        const outBearing = this.bearing(current, next);
        const turn = this.normalizeTurn(outBearing - inBearing);
        if (Math.abs(turn) > 150) score += DUAL_CARRIAGEWAY_UTURN_METERS;
      }

      if (score < bestScore) {
        bestScore = score;
        best = next;
      }
    }

    return best;
  }

  // ─── Post-circuit U-turn elimination ──────────────────────────────────────

  /**
   * Post-circuit repair pass that scans the completed Hierholzer circuit for
   * U-turns (>150° reversals) and attempts to replace each one with a short
   * block-circling loop found via BFS on the original graph.
   *
   * The pass runs in a `while(improved)` loop because inserting a loop may
   * occasionally create a new U-turn at the splice boundaries (rare, but
   * handled). It preserves all original traversals — loops are pure deadhead
   * additions that only add distance.
   */
  private eliminateUTurns(circuit: string[]): string[] {
    if (circuit.length < 3) return circuit;

    let result = circuit;
    let improved = true;
    let iterations = 0;

    while (improved && iterations < MAX_REPAIR_ITERATIONS) {
      improved = false;
      iterations++;

      for (let i = 1; i < result.length - 1; i++) {
        const prev = result[i - 1]!;
        const curr = result[i]!;
        const next = result[i + 1]!;

        const inB = this.bearing(prev, curr);
        const outB = this.bearing(curr, next);
        const turn = this.normalizeTurn(outB - inB);

        if (Math.abs(turn) <= 150) continue;

        // Found a U-turn at index i (triple prev→curr→next).
        // Try to find a short loop curr→...→curr that avoids going to prev.
        const loop = this.findNonReversalLoop(curr, prev, inB);
        if (!loop) continue;

        // Compute the total detour distance of the loop
        let detourM = 0;
        for (let k = 0; k < loop.length - 1; k++) {
          const a = this.nodes.get(loop[k]!);
          const b = this.nodes.get(loop[k + 1]!);
          if (a && b) {
            detourM += haversineMeters(
              Number(a.lon),
              Number(a.lat),
              Number(b.lon),
              Number(b.lat),
            );
          }
        }
        if (detourM > MAX_UTURN_DETOUR_M) continue;

        // Verify the repair actually reduces U-turns at the splice site.
        // The loop is: curr → loop[1] → ... → loop[n-1] → curr
        // After splice the sequence becomes: ...prev, curr, loop[1], ..., loop[n-1], curr, next...
        // Check the two new junctions: prev→curr→loop[1] and loop[n-1]→curr→next
        const loopFirst = loop[1]!;
        const loopLast = loop[loop.length - 2]!; // node before final curr

        const newTurn1 = this.normalizeTurn(
          this.bearing(curr, loopFirst) - inB,
        );
        const newTurn2 = this.normalizeTurn(
          this.bearing(curr, next) - this.bearing(loopLast, curr),
        );

        // Count U-turns before and after
        const oldUTurns = 1; // the one we're fixing
        let newUTurns = 0;
        if (Math.abs(newTurn1) > 150) newUTurns++;
        if (Math.abs(newTurn2) > 150) newUTurns++;

        // Also check internal U-turns within the loop itself
        for (let k = 1; k < loop.length - 1; k++) {
          const lPrev = loop[k - 1]!;
          const lCurr = loop[k]!;
          const lNext = loop[k + 1]!;
          const lIn = this.bearing(lPrev, lCurr);
          const lOut = this.bearing(lCurr, lNext);
          if (Math.abs(this.normalizeTurn(lOut - lIn)) > 150) newUTurns++;
        }

        if (newUTurns >= oldUTurns) continue;

        // Splice the loop into the circuit at position i.
        // result[i] === curr, loop = [curr, ..., curr]
        // Replace the single curr at i with the full loop (minus trailing curr
        // since result[i] is followed by next which remains).
        const loopMiddle = loop.slice(1); // drop leading curr (already at result[i])
        result = [
          ...result.slice(0, i + 1), // ...prev, curr
          ...loopMiddle.slice(0, -1), // loop interior nodes (excl. trailing curr)
          ...result.slice(i), // curr, next, ...
        ];

        improved = true;
        break; // restart scan from the beginning
      }
    }

    return result;
  }

  /**
   * BFS to find a short loop from `node` back to `node` that does NOT
   * immediately traverse the edge to `avoidPred` (which would just be
   * the same U-turn). The first edge must also not be a U-turn relative
   * to `inBearing` (the direction we arrived from).
   *
   * Returns the loop as [node, ..., node] (starts and ends at `node`),
   * or null if no loop is found within depth/distance limits.
   */
  private findNonReversalLoop(
    node: string,
    avoidPred: string,
    inBearing: number,
  ): string[] | null {
    // BFS state: [currentNode, path-from-start]
    type BFSState = [string, string[]];
    const queue: BFSState[] = [];

    // Seed with all neighbours except the avoided predecessor,
    // and skip first-step U-turns.
    const startEdges = this.graph.get(node);
    if (!startEdges) return null;

    for (const [neighbour] of startEdges) {
      if (neighbour === avoidPred) continue;
      const firstBearing = this.bearing(node, neighbour);
      const firstTurn = this.normalizeTurn(firstBearing - inBearing);
      if (Math.abs(firstTurn) > 150) continue; // would be another U-turn
      queue.push([neighbour, [node, neighbour]]);
    }

    const visited = new Set<string>();
    visited.add(node); // don't revisit start until we close the loop

    while (queue.length > 0) {
      const [current, path] = queue.shift()!;

      if (path.length > MAX_LOOP_BFS_DEPTH + 1) continue; // depth limit

      const edges = this.graph.get(current);
      if (!edges) continue;

      for (const [next] of edges) {
        // Avoid immediate reversal within the BFS itself (must check before
        // loop-closure to reject degenerate 2-edge loops like [node, N1, node])
        if (path.length >= 2) {
          const bfsPrev = path[path.length - 2]!;
          if (next === bfsPrev) continue;
        }

        // Found a loop back to start
        if (next === node) {
          return [...path, node];
        }

        if (visited.has(next)) continue;

        visited.add(next);
        queue.push([next, [...path, next]]);
      }
    }

    return null;
  }

  /** Find the best start node within a specific component. */
  private findStartNodeInComponent(
    component: Set<string>,
    lat?: number,
    lon?: number,
  ): string | null {
    if (component.size === 0) return null;

    if (lat !== undefined && lon !== undefined) {
      let closest: string | null = null;
      let minDist = Infinity;
      for (const id of component) {
        const node = this.nodes.get(id);
        if (!node) continue;
        const d = this.haversine({ lat, lon }, node);
        if (d < minDist) {
          minDist = d;
          closest = id;
        }
      }
      return closest;
    }

    // Prefer dead-end (degree 1) nodes as start
    for (const id of component) {
      const edges = this.graph.get(id);
      if (edges && edges.size === 1) return id;
    }

    return component.values().next().value || null;
  }

  /** Haversine distance from a component's closest node to a point. */
  private closestDist(
    component: Set<string>,
    lat: number,
    lon: number,
  ): number {
    let min = Infinity;
    for (const id of component) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const d = this.haversine({ lat, lon }, node);
      if (d < min) min = d;
    }
    return min;
  }

  /** Return all weakly connected components of the graph. */
  private getAllComponents(): Set<string>[] {
    const visited = new Set<string>();
    const components: Set<string>[] = [];

    for (const start of this.graph.keys()) {
      if (visited.has(start)) continue;

      const comp = new Set<string>();
      const queue = [start];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (comp.has(node)) continue;
        comp.add(node);
        visited.add(node);
        const edges = this.graph.get(node);
        if (edges) {
          for (const n of edges.keys()) {
            if (!comp.has(n)) queue.push(n);
          }
        }
      }

      components.push(comp);
    }

    return components;
  }

  private calculateStats(circuit: string[]): {
    totalKm: number;
    rightTurns: number;
    leftTurns: number;
    uTurns: number;
    straight: number;
  } {
    let total = 0;
    let right = 0,
      left = 0,
      uturns = 0,
      straight = 0;

    for (let i = 0; i < circuit.length - 1; i++) {
      const a = this.nodes.get(circuit[i]!);
      const b = this.nodes.get(circuit[i + 1]!);
      if (a && b) total += this.haversine(a, b);

      if (i > 0) {
        const prev = circuit[i - 1]!;
        const curr = circuit[i]!;
        const next = circuit[i + 1]!;
        const inB = this.bearing(prev, curr);
        const outB = this.bearing(curr, next);
        const turn = this.normalizeTurn(outB - inB);

        if (Math.abs(turn) > 150) uturns++;
        else if (turn > 30) right++;
        else if (turn < -30) left++;
        else straight++;
      }
    }

    return {
      totalKm: total,
      rightTurns: right,
      leftTurns: left,
      uTurns: uturns,
      straight,
    };
  }

  private haversine(
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
  ): number {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  private bearing(fromId: string, toId: string): number {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return 0;
    const dLon = ((to.lon - from.lon) * Math.PI) / 180;
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const x = Math.sin(dLon) * Math.cos(lat2);
    const y =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(x, y) * (180 / Math.PI) + 360) % 360;
  }

  private normalizeTurn(angle: number): number {
    angle = angle % 360;
    if (angle > 180) angle -= 360;
    if (angle < -180) angle += 360;
    return angle;
  }
}
