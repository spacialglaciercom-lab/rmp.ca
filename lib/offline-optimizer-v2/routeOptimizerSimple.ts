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
  /** Extra traversal count added by Chinese Postman augmentation (default 1). */
  count?: number;
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

export class RouteOptimizerSimpleV2 {
  private nodes: Map<string, Node>;
  private ways: Way[];
  private graph: Map<string, Map<string, EdgeData>> = new Map();
  private plugins: RoutingCostPlugin[];

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
      let circuit = this.hierholzer(startNode);
      circuit = this.eliminateUTurns(circuit);
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
          this.graph
            .get(from)!
            .set(to, {
              length: costUV,
              oneway: isOneway,
              dualCarriageway: isDualCarriageway || undefined,
            });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph
              .get(to)!
              .set(from, {
                length: costVU,
                oneway: false,
                dualCarriageway: isDualCarriageway || undefined,
              });
          }
        } else {
          if (!this.graph.has(from)) this.graph.set(from, new Map());
          this.graph
            .get(from)!
            .set(to, {
              length: distanceM,
              oneway: isOneway,
              dualCarriageway: isDualCarriageway || undefined,
            });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph
              .get(to)!
              .set(from, {
                length: distanceM,
                oneway: false,
                dualCarriageway: isDualCarriageway || undefined,
              });
          }
        }
      }
    }
  }

  /**
   * Balance the directed graph for an Eulerian circuit.
   *
   * Always uses directed balancing with turn-aware Dijkstra so that
   * augmentation paths avoid U-turns — even when no plugins are active.
   * The old no-plugin path simply ensured reciprocal edges exist, which was
   * completely turn-blind and created graphs where Hierholzer was forced
   * into unnecessary U-turns.
   */
  private makeEulerian(): void {
    // Ensure every bidirectional edge has a reciprocal before balancing (required for
    // bidirectional streets that may only have one direction in the source).
    // One-way edges are skipped so their nodes remain imbalanced; makeEulerianDirected()
    // will balance them using turn-aware Dijkstra that avoids U-turns.
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

    // Now balance in/out degrees using turn-aware Dijkstra
    this.makeEulerianDirected();
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
    const keys = Array.from(edges.keys());
    if (keys.length === 1) return keys[0]!;
    if (!prev) return keys[0]!;

    // --- Partition into U-turn vs non-U-turn candidates ---
    const nonUTurn: string[] = [];
    const uTurn: string[] = [];
    const inBearing = this.bearing(prev, current);

    for (const next of keys) {
      const outBearing = this.bearing(current, next);
      const turn = this.normalizeTurn(outBearing - inBearing);
      if (Math.abs(turn) > 150) {
        uTurn.push(next);
      } else {
        nonUTurn.push(next);
      }
    }

    // Prefer non-U-turn candidates; fall back to U-turns only when forced
    const candidates = nonUTurn.length > 0 ? nonUTurn : uTurn;
    if (candidates.length === 1) return candidates[0]!;

    // --- Score within the chosen partition ---
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

  /**
   * BFS from `node` to find a loop back to `node` that avoids immediately
   * reversing to `prevNode`. Returns the loop as [node, ..., node] with
   * at least 3 edges, or null if none found.
   *
   * Requires depth ≥ 2 before accepting loop closure to prevent degenerate
   * 2-edge loops [node, N1, node] that would just be another U-turn.
   */
  private findNonReversalLoop(
    node: string,
    prevNode: string,
    maxDepth: number = 15,
  ): string[] | null {
    const queue: Array<{ path: string[]; visited: Set<string> }> = [];

    const startNeighbors = this.graph.get(node);
    if (!startNeighbors) return null;

    for (const n1 of startNeighbors.keys()) {
      if (n1 === prevNode) continue;
      const visited = new Set<string>([node, n1]);
      queue.push({ path: [node, n1], visited });
    }

    let steps = 0;
    const maxSteps = 2000;

    while (queue.length > 0 && steps < maxSteps) {
      steps++;
      const { path, visited } = queue.shift()!;
      const current = path[path.length - 1]!;
      const depth = path.length - 1;

      if (depth >= maxDepth) continue;

      const neighbors = this.graph.get(current);
      if (!neighbors) continue;

      for (const next of neighbors.keys()) {
        if (path.length >= 2 && next === path[path.length - 2]) continue;

        if (next === node) {
          if (depth >= 2) {
            return [...path, node];
          }
          continue;
        }

        if (visited.has(next)) continue;

        const newVisited = new Set(visited);
        newVisited.add(next);
        queue.push({ path: [...path, next], visited: newVisited });
      }
    }

    return null;
  }

  /**
   * Post-process circuit to eliminate internal U-turns by splicing in
   * non-reversing loops found via BFS.
   */
  private eliminateUTurns(circuit: string[]): string[] {
    if (circuit.length < 3) return circuit;

    let result = [...circuit];
    let improved = true;
    let passes = 0;
    const maxPasses = 5;
    let totalEliminated = 0;

    while (improved && passes < maxPasses) {
      improved = false;
      passes++;

      for (let i = 1; i < result.length - 1; i++) {
        const prev = result[i - 1]!;
        const current = result[i]!;
        const next = result[i + 1]!;

        if (next !== prev) continue;

        // Skip dead-end nodes (degree 1) where U-turn is the only option
        const edges = this.graph.get(current);
        if (edges && edges.size === 1) continue;

        const loop = this.findNonReversalLoop(current, prev);
        if (!loop) continue;

        // Validate all edges exist
        let valid = true;
        for (let j = 0; j < loop.length - 1; j++) {
          if (!this.graph.get(loop[j]!)?.has(loop[j + 1]!)) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;

        const loopMiddle = loop.slice(1);
        result.splice(i + 1, 0, ...loopMiddle);
        totalEliminated++;
        improved = true;
        i += loopMiddle.length;
      }
    }

    return result;
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
