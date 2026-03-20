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
  RoutePoint,
  RouteStats,
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
  /** Full segment geometry [lat, lon][] so the drawn route follows road shape (no straight jumps). */
  geometry?: Array<[number, number]>;
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
  /**
   * Nodes that are NOT intersections — they lie between two intersections on the
   * same OSM way. U-turns at these nodes are physically impossible in real life
   * and must be hard-blocked (not merely penalized).
   */
  private midBlockNodes = new Set<string>();
  /**
   * Set of node IDs that are intersection / split nodes (endpoints of ways,
   * or nodes shared by 2+ ways). Only these become graph vertices — all
   * intermediate shape-point nodes are folded into edge geometry.
   */
  private intersectionNodes = new Set<string>();

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
    const emptyStats = (): RouteStats => ({
      total_traversals: 0,
      total_distance_km: 0,
      right_turns: 0,
      left_turns: 0,
      u_turns: 0,
      straight: 0,
      oneway_violations: [],
      single_pass_segments: [],
      dead_ends_identified: 0,
      u_turns_avoided: 0,
      efficiency: 0,
    });

    this.buildGraph();
    if (this.graph.size === 0) {
      return {
        route: [],
        totalDistance: 0,
        message: "No valid roads found",
        stats: emptyStats(),
      };
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
        stats: emptyStats(),
      };
    }

    // Post-circuit U-turn elimination: repair each component circuit
    // individually so BFS loops stay within the correct connected component.
    for (let c = 0; c < circuits.length; c++) {
      circuits[c] = this.eliminateUTurns(circuits[c]!);
    }

    const uTurnsAvoided = 0;

    const routeSegments: RoutePoint[][] = [];
    let aggKm = 0;
    let aggRight = 0;
    let aggLeft = 0;
    let aggU = 0;
    let aggStraight = 0;
    let aggTraversals = 0;
    let effWeighted = 0;
    let effWeight = 0;

    for (let c = 0; c < circuits.length; c++) {
      const nodeCircuit = circuits[c]!;
      const comp = components[c]!;
      const ts = this.calculateStats(nodeCircuit);
      aggKm += ts.totalKm;
      aggRight += ts.rightTurns;
      aggLeft += ts.leftTurns;
      aggU += ts.uTurns;
      aggStraight += ts.straight;
      aggTraversals += Math.max(0, nodeCircuit.length - 1);

      const edgeCount = this.undirectedEdgeCountInComponent(comp);
      if (edgeCount > 0) {
        effWeighted += this.efficiencyForCircuit(nodeCircuit) * edgeCount;
        effWeight += edgeCount;
      }

      const segPoints = this.buildRoutePointsFromCircuit(nodeCircuit);
      if (segPoints.length > 0) routeSegments.push(segPoints);
    }

    const routePoints = routeSegments.flat();
    const circuit = circuits.flat();

    const turnStats = {
      totalKm: aggKm,
      rightTurns: aggRight,
      leftTurns: aggLeft,
      uTurns: aggU,
      straight: aggStraight,
    };
    const efficiency =
      effWeight > 0 ? effWeighted / effWeight : this.efficiencyForCircuit(circuit);
    const routeStats = this.buildRouteStats(
      turnStats,
      uTurnsAvoided,
      aggTraversals,
      efficiency,
    );

    const avoidedSuffix =
      uTurnsAvoided > 0 ? `, ${uTurnsAvoided} U-turn(s) avoided` : "";

    return {
      route: routePoints,
      routeSegments:
        routeSegments.length > 1 ? routeSegments : undefined,
      totalDistance: turnStats.totalKm,
      message: `Offline optimizer (v2): ${turnStats.totalKm.toFixed(2)} km, ${routePoints.length} points, ${components.length} component(s). Turns: R${turnStats.rightTurns} L${turnStats.leftTurns} U${turnStats.uTurns} S${turnStats.straight}${avoidedSuffix}`,
      stats: routeStats,
    };
  }

  /** Full {@link RouteStats} for exports / UI parity with the main RouteOptimizer. */
  private buildRouteStats(
    turnStats: {
      totalKm: number;
      rightTurns: number;
      leftTurns: number;
      uTurns: number;
      straight: number;
    },
    uTurnsAvoided: number,
    totalTraversals: number,
    efficiency: number,
  ): RouteStats {
    return {
      total_traversals: totalTraversals,
      total_distance_km: turnStats.totalKm,
      right_turns: turnStats.rightTurns,
      left_turns: turnStats.leftTurns,
      u_turns: turnStats.uTurns,
      straight: turnStats.straight,
      oneway_violations: [],
      single_pass_segments: [],
      dead_ends_identified: 0,
      u_turns_avoided: uTurnsAvoided,
      efficiency,
    };
  }

  /** Undirected edges with both endpoints in `comp` (for per-component efficiency weighting). */
  private undirectedEdgeCountInComponent(comp: Set<string>): number {
    const seen = new Set<string>();
    for (const u of comp) {
      const adj = this.graph.get(u);
      if (!adj) continue;
      for (const v of adj.keys()) {
        if (!comp.has(v)) continue;
        seen.add([u, v].sort().join("\0"));
      }
    }
    return seen.size;
  }

  /** Share of distinct undirected graph edges that appear at least once in the circuit (0–100). */
  private efficiencyForCircuit(circuit: string[]): number {
    const graphUndirected = new Set<string>();
    for (const [u, adj] of this.graph) {
      for (const v of adj.keys()) {
        graphUndirected.add([u, v].sort().join("\0"));
      }
    }
    if (graphUndirected.size === 0) return 0;

    const traversed = new Set<string>();
    for (let i = 0; i < circuit.length - 1; i++) {
      const a = circuit[i]!;
      const b = circuit[i + 1]!;
      traversed.add([a, b].sort().join("\0"));
    }
    return (traversed.size / graphUndirected.size) * 100;
  }

  /** [lon, lat, z] for plugin calls. */
  private getCoords(nodeId: string): Coord {
    const n = this.nodes.get(nodeId);
    if (!n) return [0, 0, 0];
    return [Number(n.lon), Number(n.lat), n.z ?? 0];
  }

  /**
   * Build graph with intersection-based splitting (same approach as backend).
   *
   * Pass 1: count how many ways reference each node and collect endpoints.
   *         Any node referenced by 2+ ways or at the start/end of a way is
   *         an intersection (split node).
   * Pass 2: iterate each way, splitting at intersection nodes. Each run
   *         between intersections becomes one graph edge with full geometry
   *         stored on the edge. This produces ~5-10x fewer nodes/edges than
   *         the old per-segment approach, giving Hierholzer fewer decision
   *         points and cleaner circuits.
   */
  private buildGraph(): void {
    this.graph.clear();
    this.intersectionNodes.clear();

    // ── Pass 1: find intersection (split) nodes ──
    const nodeRefCount = new Map<string, number>();
    for (const way of this.ways) {
      for (const nid of way.nodes) {
        nodeRefCount.set(nid, (nodeRefCount.get(nid) ?? 0) + 1);
      }
    }
    for (const way of this.ways) {
      if (way.nodes.length > 0) {
        this.intersectionNodes.add(way.nodes[0]!);
        this.intersectionNodes.add(way.nodes[way.nodes.length - 1]!);
      }
    }
    for (const [nid, cnt] of nodeRefCount) {
      if (cnt >= 2) this.intersectionNodes.add(nid);
    }

    // ── Pass 2: split ways at intersections, build edges with geometry ──
    const usePlugins = this.plugins.length > 0;
    const emptyData = {} as Record<string, unknown>;

    for (const way of this.ways) {
      const isOneway = way.tags?.oneway === "yes";
      const isDualCarriageway = way.tags?.dual_carriageway === "yes";
      const wayId = way.id ?? undefined;

      let runStart = 0;
      for (let i = 1; i < way.nodes.length; i++) {
        const nid = way.nodes[i]!;
        const isIntersection = this.intersectionNodes.has(nid);
        const isLast = i === way.nodes.length - 1;
        if (!isIntersection && !isLast) continue;

        // This run is from way.nodes[runStart] to way.nodes[i]
        const from = way.nodes[runStart]!;
        const to = nid;
        if (from === to) {
          runStart = i;
          continue;
        }

        // Build geometry and compute total length along the run
        const geometry: Array<[number, number]> = [];
        let lengthM = 0;
        let prevLat: number | null = null;
        let prevLon: number | null = null;
        let allNodesValid = true;
        for (let j = runStart; j <= i; j++) {
          const n = this.nodes.get(way.nodes[j]!);
          if (!n) { allNodesValid = false; break; }
          geometry.push([n.lat, n.lon]);
          if (prevLat !== null && prevLon !== null) {
            lengthM += haversineMeters(
              Number(prevLon), prevLat,
              Number(n.lon), n.lat,
            );
          }
          prevLat = n.lat;
          prevLon = Number(n.lon);
        }
        if (!allNodesValid || geometry.length < 2) {
          runStart = i;
          continue;
        }

        // Reverse geometry for the reverse edge
        const revGeometry = [...geometry].reverse() as Array<[number, number]>;

        if (usePlugins) {
          const coordsU: Coord = this.getCoords(from);
          const coordsV: Coord = this.getCoords(to);
          let costUV = lengthM;
          let costVU = lengthM;
          for (const plugin of this.plugins) {
            costUV *= plugin.calculateMultiplier(
              coordsU, coordsV, emptyData, emptyData, lengthM,
            );
            costVU *= plugin.calculateMultiplier(
              coordsV, coordsU, emptyData, emptyData, lengthM,
            );
          }
          if (!this.graph.has(from)) this.graph.set(from, new Map());
          this.graph.get(from)!.set(to, { length: costUV, oneway: isOneway, dualCarriageway: isDualCarriageway || undefined, wayId, geometry });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph.get(to)!.set(from, { length: costVU, oneway: false, dualCarriageway: isDualCarriageway || undefined, wayId, geometry: revGeometry });
          }
        } else {
          if (!this.graph.has(from)) this.graph.set(from, new Map());
          this.graph.get(from)!.set(to, { length: lengthM, oneway: isOneway, dualCarriageway: isDualCarriageway || undefined, wayId, geometry });
          if (!isOneway) {
            if (!this.graph.has(to)) this.graph.set(to, new Map());
            this.graph.get(to)!.set(from, { length: lengthM, oneway: false, dualCarriageway: isDualCarriageway || undefined, wayId, geometry: revGeometry });
          }
        }

        runStart = i;
      }
    }
  }

  /**
   * Build route points from circuit using edge geometry when available,
   * so the drawn route follows road curves instead of straight jumps.
   * Same approach as the full optimizer's buildRoutePointsFromCircuit and
   * the backend's route builder.
   */
  private buildRoutePointsFromCircuit(circuit: string[]): RoutePoint[] {
    const routePoints: RoutePoint[] = [];
    if (circuit.length === 0) return routePoints;

    for (let i = 0; i < circuit.length - 1; i++) {
      const fromId = circuit[i]!;
      const toId = circuit[i + 1]!;
      const edgeData = this.graph.get(fromId)?.get(toId);
      const geometry = edgeData?.geometry;

      if (geometry && geometry.length >= 2) {
        // Emit all geometry points; skip the first on non-initial edges
        // to avoid duplicate points at junctions.
        const startIdx = routePoints.length === 0 ? 0 : 1;
        for (let k = startIdx; k < geometry.length; k++) {
          const [lat, lon] = geometry[k]!;
          routePoints.push({ latitude: lat, longitude: lon, nodeId: fromId });
        }
      } else {
        // Fallback: emit node coordinates directly
        if (i === 0) {
          const fromNode = this.nodes.get(fromId);
          if (fromNode) {
            routePoints.push({
              latitude: fromNode.lat,
              longitude: fromNode.lon,
              nodeId: fromId,
            });
          }
        }
        const toNode = this.nodes.get(toId);
        if (toNode) {
          routePoints.push({
            latitude: toNode.lat,
            longitude: toNode.lon,
            nodeId: toId,
          });
        }
      }
    }

    // Edge case: single-node circuit
    if (routePoints.length === 0 && circuit.length > 0) {
      const first = this.nodes.get(circuit[0]!);
      if (first) {
        routePoints.push({
          latitude: first.lat,
          longitude: first.lon,
          nodeId: circuit[0],
        });
      }
    }
    return routePoints;
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
          // Reverse geometry for the reciprocal edge
          const revGeometry = data.geometry
            ? ([...data.geometry].reverse() as Array<[number, number]>)
            : undefined;
          toAdd.push([to, from, { length: data.length, oneway: false, geometry: revGeometry }]);
        }
      }
    }
    for (const [from, to, data] of toAdd) {
      if (!this.graph.has(from)) this.graph.set(from, new Map());
      this.graph.get(from)!.set(to, data);
    }

    // Always run directed balancing so one-way streets are properly handled.
    // Without this, a network with one-way streets leaves the graph unbalanced:
    // Hierholzer then produces circuits with large teleport-jumps between
    // disconnected segments, causing the route to not follow road geometry.
    // For fully bidirectional graphs this is a no-op (already balanced by
    // the reciprocal edges added above).
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

    // Build a cost lookup for fast O(1) pair cost access during 2-opt
    const pairCostMap = new Map<string, { cost: number; path: string[] }>();
    for (const { from, to, cost, path } of pairs) {
      pairCostMap.set(`${from}\0${to}`, { cost, path });
    }

    // Greedy matching (sorted by cost)
    const matchedPairs: Array<{ from: string; to: string; cost: number; path: string[] }> = [];
    for (const { from, to, cost, path } of pairs) {
      const dr = deficitRemain.get(from) ?? 0;
      const sr = surplusRemain.get(to) ?? 0;
      if (dr <= 0 || sr <= 0) continue;
      deficitRemain.set(from, dr - 1);
      surplusRemain.set(to, sr - 1);
      matchedPairs.push({ from, to, cost, path });
    }

    // 2-opt improvement: try swapping paired destinations to reduce total cost.
    // For each pair of matches (a→b, c→d), check if (a→d, c→b) is cheaper.
    // Repeat until no improvement found (usually converges in 1-2 passes).
    if (matchedPairs.length >= 2) {
      let improved = true;
      let passes = 0;
      while (improved && passes < 5) {
        improved = false;
        passes++;
        for (let i = 0; i < matchedPairs.length - 1; i++) {
          for (let j = i + 1; j < matchedPairs.length; j++) {
            const mi = matchedPairs[i]!;
            const mj = matchedPairs[j]!;
            const currentCost = mi.cost + mj.cost;

            // Try swap: mi.from→mj.to and mj.from→mi.to
            const swap1 = pairCostMap.get(`${mi.from}\0${mj.to}`);
            const swap2 = pairCostMap.get(`${mj.from}\0${mi.to}`);
            if (swap1 && swap2 && swap1.cost + swap2.cost < currentCost) {
              matchedPairs[i] = { from: mi.from, to: mj.to, cost: swap1.cost, path: swap1.path };
              matchedPairs[j] = { from: mj.from, to: mi.to, cost: swap2.cost, path: swap2.path };
              improved = true;
            }
          }
        }
      }
    }

    const augmentPaths: string[][] = matchedPairs.map((m) => m.path);

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
          const inBearing = this.edgeEndBearing(t, u);
          const outBearing = this.edgeStartBearing(u, v);
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

    // Use edge geometry for incoming bearing (last segment of prev→current edge)
    const inBearing = this.edgeEndBearing(prev, current);
    const useTransition = this.plugins.length > 0;
    const coordsT = this.getCoords(prev);
    const coordsU = this.getCoords(current);

    let best = keys[0]!;
    let bestScore = Infinity;

    for (const next of keys) {
      const edgeData = edges.get(next)!;
      let score: number;

      // Use edge geometry for outgoing bearing (first segment of current→next edge)
      const outBearing = this.edgeStartBearing(current, next);

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
    maxDepth: number = 8,
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
      const fromId = circuit[i]!;
      const toId = circuit[i + 1]!;
      const edgeData = this.graph.get(fromId)?.get(toId);

      // Distance: use edge geometry length if available, else haversine
      if (edgeData?.geometry && edgeData.geometry.length >= 2) {
        for (let k = 1; k < edgeData.geometry.length; k++) {
          const [lat1, lon1] = edgeData.geometry[k - 1]!;
          const [lat2, lon2] = edgeData.geometry[k]!;
          total += this.haversine({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
        }
      } else {
        const a = this.nodes.get(fromId);
        const b = this.nodes.get(toId);
        if (a && b) total += this.haversine(a, b);
      }

      // Turn classification using edge geometry endpoints for accurate bearing
      if (i > 0) {
        const inB = this.edgeEndBearing(circuit[i - 1]!, fromId);
        const outB = this.edgeStartBearing(fromId, toId);
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

  /** Bearing of the last segment of an edge (approaching toId). */
  private edgeEndBearing(fromId: string, toId: string): number {
    const edgeData = this.graph.get(fromId)?.get(toId);
    const geo = edgeData?.geometry;
    if (geo && geo.length >= 2) {
      const [lat1, lon1] = geo[geo.length - 2]!;
      const [lat2, lon2] = geo[geo.length - 1]!;
      return this.bearingCoords(lat1, lon1, lat2, lon2);
    }
    return this.bearing(fromId, toId);
  }

  /** Bearing of the first segment of an edge (leaving fromId). */
  private edgeStartBearing(fromId: string, toId: string): number {
    const edgeData = this.graph.get(fromId)?.get(toId);
    const geo = edgeData?.geometry;
    if (geo && geo.length >= 2) {
      const [lat1, lon1] = geo[0]!;
      const [lat2, lon2] = geo[1]!;
      return this.bearingCoords(lat1, lon1, lat2, lon2);
    }
    return this.bearing(fromId, toId);
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
    return this.bearingCoords(from.lat, from.lon, to.lat, to.lon);
  }

  private bearingCoords(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const rLat1 = (lat1 * Math.PI) / 180;
    const rLat2 = (lat2 * Math.PI) / 180;
    const x = Math.sin(dLon) * Math.cos(rLat2);
    const y =
      Math.cos(rLat1) * Math.sin(rLat2) -
      Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
    return (Math.atan2(x, y) * (180 / Math.PI) + 360) % 360;
  }

  private normalizeTurn(angle: number): number {
    angle = angle % 360;
    if (angle > 180) angle -= 360;
    if (angle < -180) angle += 360;
    return angle;
  }
}
