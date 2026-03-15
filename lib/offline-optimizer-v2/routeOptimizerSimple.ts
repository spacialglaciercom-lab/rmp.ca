/**
 * Same optimizer as C:\Users\Space\Videos\route-optimizer-mobile-v2\src\routeOptimizerSimple.ts
 * (RouteOptimizerSimple). Kept in sync so the "Optimizer v2" toggle on planner pages uses the
 * exact same algorithm as the Videos app.
 *
 * Only adaptations: class name RouteOptimizerSimpleV2, types from @/lib/route-optimizer-v2/types,
 * route points include nodeId for rmp.ca compatibility, and optional RoutingCostPlugin support
 * (directed edges, transition costs). No console.log.
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
}

// Turn cost penalties (meters equivalent) — must match route-optimizer-mobile-v2 (used when no plugins)
const TURN_COSTS = {
  U_TURN: 800,
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
      const circuit = this.hierholzer(startNode);
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
          this.graph.get(from)!.set(to, { length: costUV, oneway: isOneway, dualCarriageway: isDualCarriageway || undefined });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph.get(to)!.set(from, { length: costVU, oneway: false, dualCarriageway: isDualCarriageway || undefined });
          }
        } else {
          if (!this.graph.has(from)) this.graph.set(from, new Map());
          this.graph.get(from)!.set(to, { length: distanceM, oneway: isOneway, dualCarriageway: isDualCarriageway || undefined });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph.get(to)!.set(from, { length: distanceM, oneway: false, dualCarriageway: isDualCarriageway || undefined });
          }
        }
      }
    }
  }

  private makeEulerian(): void {
    if (this.plugins.length > 0) {
      this.makeEulerianDirected();
      return;
    }

    const toAdd: Array<[string, string, EdgeData]> = [];
    for (const [from, edges] of this.graph) {
      for (const [to, data] of edges) {
        if (!this.graph.get(to)?.has(from)) {
          toAdd.push([to, from, { length: data.length, oneway: false }]);
        }
      }
    }
    for (const [from, to, data] of toAdd) {
      if (!this.graph.has(from)) this.graph.set(from, new Map());
      this.graph.get(from)!.set(to, data);
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
      const { lengths, paths } = this.dijkstraWithTransitionCosts(from, this.plugins);
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
    const keys = Array.from(edges.keys());
    if (keys.length === 1) return keys[0]!;
    if (!prev) return keys[0]!;

    const useTransition = this.plugins.length > 0;
    const coordsT = this.getCoords(prev);
    const coordsU = this.getCoords(current);

    let best = keys[0]!;
    let bestScore = Infinity;

    for (const next of keys) {
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
        if (Math.abs(turn) > 150) cost = TURN_COSTS.U_TURN;
        else if (turn > 120) cost = TURN_COSTS.SHARP_LEFT;
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
}
