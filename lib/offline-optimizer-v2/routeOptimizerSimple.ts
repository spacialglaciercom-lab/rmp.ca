/**
 * Offline Eulerian route optimizer (Hierholzer + balancing). Derived from the same structure as
 * route-optimizer-mobile-v2’s RouteOptimizerSimple, but this repo may diverge: TURN_COSTS,
 * chooseBest() U-turn handling, etc. No-plugin balancing uses simple reciprocal edges (not
 * directed Dijkstra augmentation). With plugins, balancing uses makeEulerianDirected(). Port when
 * you want parity with the Videos app.
 *
 * Adaptations vs a generic RouteOptimizerSimple: class name RouteOptimizerSimpleV2, types from
 * @/lib/route-optimizer-v2/types, route points include nodeId, optional RoutingCostPlugin on the
 * graph and in augmentation. No console.log.
 *
 * Typical Planner / Map usage: `plugins` is omitted or empty — that is the supported “no-plugin”
 * path (haversine edges, reciprocal makeEulerian, TURN_COSTS + chooseBest() for turns). Passing
 * FuelAwarePlugin / TurnPenaltyPlugin is optional; those need elevation-aware coords (e.g. z on
 * GeoJSON) and a caller that constructs the plugin list. Do not assume most v2 runs use plugins.
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
  /** Traversal multiplicity after directed Eulerian augmentation (Hierholzer consumes each unit once). */
  count?: number;
}

// Turn cost penalties (meters equivalent) when no user plugins — align with route-optimizer-mobile-v2 when porting
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
      let circuit = this.hierholzer(startNode);
      // Post-circuit U-turn elimination: repair each component circuit
      // individually so BFS loops stay within the correct connected component.
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
      const wayId = way.id;

      for (let i = 0; i < way.nodes.length - 1; i++) {
        const from = way.nodes[i]!;
        const to = way.nodes[i + 1]!;

        const fromNode = this.nodes.get(from);
        const toNode = this.nodes.get(to);
        if (!fromNode || !toNode) continue;

        const distanceM =
          haversineMeters(
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

  /** Build set of mid-block (non-intersection) nodes where U-turns are physically impossible. */
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

  /**
   * Balance the graph for Hierholzer. First, ensure reciprocal edges exist for
   * bidirectional roads. Then always run directed balancing so one-way streets
   * are properly handled. Without this, a network with one-way streets leaves
   * the graph unbalanced: Hierholzer then produces circuits with large teleport-jumps
   * between disconnected segments, causing the route to not follow road geometry.
   */
  private makeEulerian(): void {
    // First, ensure reciprocal edges exist (bidirectional completion) for both
    // plugins and non-plugins paths. This balances the graph before any
    // directed augmentation is attempted.
    const toAdd: Array<[string, string, EdgeData]> = [];
    for (const [from, edges] of this.graph) {
      for (const [to, data] of edges) {
        if (data.oneway) continue;
        if (!this.graph.get(to)?.has(from)) {
          toAdd.push([to, from, { length: data.length, oneway: false, wayId: data.wayId }]);
        }
      }
    }
    for (const [from, to, data] of toAdd) {
      if (!this.graph.has(from)) this.graph.set(from, new Map());
      this.graph.get(from)!.set(to, data);
    }

    // Always run directed balancing so one-way streets are properly handled.
    // For fully bidirectional graphs this is a no-op (already balanced by
    // the reciprocal edges added above).
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

    const pairs: Array<{ from: string; to: string; cost: number; path: string[] }> = [];
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
        const data = this.graph.get(u)?.get(v);
        if (!data) continue;
        if (!this.graph.has(u)) this.graph.set(u, new Map());
        this.graph.get(u)!.set(v, { ...data });
      }
    }
  }

  private dijkstraWithTransitionCosts(
    source: string,
    plugins: RoutingCostPlugin[],
  ): { lengths: Record<string, number>; paths: Record<string, string[]> } {
    const lengths: Record<string, number> = { [source]: 0 };
    const paths: Record<string, string[]> = { [source]: [source] };
    type State = [string, string | null];
    const pathToState = new Map<string, string[]>();
    pathToState.set(`${source},`, [source]);
    const heap: Array<[number, State]> = [[0, [source, null]]];
    const expanded = new Set<string>();

    const stateKey = (u: string, t: string | null) => `${u},${t ?? ""}`;

    while (heap.length > 0) {
      heap.sort((a, b) => a[0] - b[0]);
      const entry = heap.shift()!;
      const [d, [u, t]] = entry;
      const key = stateKey(u, t);
      if (expanded.has(key)) continue;
      expanded.add(key);

      const coordsU = this.getCoords(u);
      const edges = this.graph.get(u);
      if (!edges) continue;

      for (const [v, edgeData] of edges) {
        let transitionMult = 1;
        if (t !== null && plugins.length > 0) {
          const coordsT = this.getCoords(t);
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

        // Dual-carriageway U-turn: physically impossible — treat as forbidden.
        if (t !== null && edgeData.dualCarriageway) {
          const inBearing = this.bearing(t, u);
          const outBearing = this.bearing(u, v);
          if (Math.abs(this.normalizeTurn(outBearing - inBearing)) > 150) {
            cost += DUAL_CARRIAGEWAY_UTURN_METERS;
          }
        }

        const newD = d + cost;
        if (newD < (lengths[v] ?? Infinity)) {
          lengths[v] = newD;
          const prevPath = pathToState.get(key) ?? [];
          const newPath = [...prevPath, v];
          paths[v] = newPath;
          pathToState.set(stateKey(v, u), newPath);
          heap.push([newD, [v, u]]);
        }
      }
    }
    return { lengths, paths };
  }

  private hierholzer(start: string): string[] {
    const g = new Map<string, Map<string, EdgeData>>();
    let totalEdges = 0;
    for (const [node, edges] of this.graph) {
      const copy = new Map(edges);
      g.set(node, copy);
      totalEdges += copy.size;
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

        stack.push(next);
        edges.delete(next);
      } else {
        circuit.push(stack.pop()!);
      }
    }

    circuit.reverse();
    return circuit;
  }

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

    const isUTurnEdge = (next: string): boolean => {
      const inBearing = this.bearing(prev, current);
      const outBearing = this.bearing(current, next);
      const turn = this.normalizeTurn(outBearing - inBearing);
      return Math.abs(turn) > 150;
    };
    const nonUTurnKeys = keys.filter((k) => !isUTurnEdge(k));
    const candidateKeys =
      nonUTurnKeys.length > 0 ? nonUTurnKeys : keys;

    const useTransition = this.plugins.length > 0;
    const coordsT = this.getCoords(prev);
    const coordsU = this.getCoords(current);

    let best = candidateKeys[0]!;
    let bestScore = Infinity;

    for (const next of candidateKeys) {
      const edgeData = edges.get(next)!;
      let score: number;

      if (useTransition) {
        const coordsV = this.getCoords(next);
        let mult = 1;
        for (const plugin of this.plugins) {
          mult *= plugin.calculateTransitionMultiplier(coordsT, coordsU, coordsV);
        }
        score = edgeData.length * mult;
      } else {
        const outBearing = this.bearing(current, next);
        const inBearing = this.bearing(prev, current);
        const turn = this.normalizeTurn(outBearing - inBearing);
        let cost: number;
        if (Math.abs(turn) > 150) {
          cost = Math.max(TURN_COSTS.U_TURN, edgeData.length * 8);
        } else if (turn > 120) cost = TURN_COSTS.SHARP_LEFT;
        else if (turn > 30) cost = TURN_COSTS.LEFT_TURN;
        else if (turn >= -30) cost = TURN_COSTS.STRAIGHT;
        else if (turn >= -120) cost = TURN_COSTS.RIGHT_TURN;
        else cost = TURN_COSTS.SHARP_RIGHT;
        score = edgeData.length + cost;
      }

      // Dual-carriageway U-turn penalty (physically impossible manoeuvre).
      // Applied on top of any plugin or built-in turn cost.
      if (edgeData.dualCarriageway) {
        const inBearing = this.bearing(prev, current);
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
        else if (turn > 30) left++;
        else if (turn < -30) right++;
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

  /**
   * Post-process a circuit to eliminate U-turns by finding non-reversal loops.
   * When a U-turn is detected (A→B→A), try to find a loop from B back to B
   * that doesn't immediately reverse, and splice it into the circuit.
   */
  private eliminateUTurns(circuit: string[]): string[] {
    if (circuit.length < 3) return circuit;

    let result = [...circuit];
    let improved = true;
    let passes = 0;
    const maxPasses = 3; // cap iteration — more passes compound block-circling detours
    const originalLength = circuit.length;
    // Cap total circuit growth to 40% to prevent runaway loop accumulation
    const maxGrowth = Math.ceil(originalLength * 0.4);

    while (improved && passes < maxPasses) {
      improved = false;
      passes++;

      // Bail out if circuit has grown too much from accumulated splices
      if (result.length - originalLength > maxGrowth) break;

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
        improved = true;
        i += loopMiddle.length;
      }
    }

    return result;
  }

  /**
   * Find a loop from `node` back to itself that doesn't immediately reverse
   * to `exclude` (the previous node in the circuit). Uses BFS with depth limit.
   */
  private findNonReversalLoop(
    node: string,
    exclude: string,
  ): string[] | null {
    const maxDepth = 8; // Limit BFS depth to prevent multi-block detours
    const queue: Array<{ current: string; path: string[] }> = [
      { current: node, path: [node] },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { current, path } = queue.shift()!;
      if (path.length > maxDepth) continue;
      if (visited.has(current)) continue;
      visited.add(current);

      const edges = this.graph.get(current);
      if (!edges) continue;

      for (const next of edges.keys()) {
        // Don't immediately reverse
        if (next === exclude && path.length === 1) continue;

        const newPath = [...path, next];

        // Found a loop back to start
        if (next === node && newPath.length >= 3) {
          return newPath;
        }

        if (newPath.length <= maxDepth) {
          queue.push({ current: next, path: newPath });
        }
      }
    }

    return null;
  }
}
