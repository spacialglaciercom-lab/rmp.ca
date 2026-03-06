/**
 * Same optimizer as C:\Users\Space\Videos\route-optimizer-mobile-v2\src\routeOptimizerSimple.ts
 * (RouteOptimizerSimple). Kept in sync so the "Optimizer v2" toggle on planner pages uses the
 * exact same algorithm as the Videos app.
 *
 * Only adaptations: class name RouteOptimizerSimpleV2, types from @/lib/route-optimizer-v2/types,
 * and route points include nodeId for rmp.ca compatibility. No console.log.
 */

import type { Node, Way, RoutePoint, OptimizationResult } from "@/lib/route-optimizer-v2/types";

interface EdgeData {
  length: number;
  oneway: boolean;
}

// Turn cost penalties (meters equivalent) — must match route-optimizer-mobile-v2
const TURN_COSTS = {
  U_TURN: 800,
  SHARP_LEFT: 150,
  LEFT_TURN: 50,
  STRAIGHT: 0,
  RIGHT_TURN: -20,
  SHARP_RIGHT: -10,
};

export class RouteOptimizerSimpleV2 {
  private nodes: Map<string, Node>;
  private ways: Way[];
  private graph: Map<string, Map<string, EdgeData>> = new Map();

  constructor(nodes: Map<string, Node>, ways: Way[]) {
    this.nodes = nodes;
    this.ways = ways;
  }

  optimize(customLat?: number, customLon?: number): OptimizationResult {
    this.buildGraph();
    if (this.graph.size === 0) {
      return { route: [], totalDistance: 0, message: "No valid roads found" };
    }

    this.makeEulerian();

    const startNode = this.findStartNode(customLat, customLon);
    if (!startNode) {
      return { route: [], totalDistance: 0, message: "Could not find start node" };
    }

    // v2 always uses two-pass (both sides); one-pass causes loops with this graph, so we ignore serviceBothSides
    const circuit = this.hierholzer(startNode);

    const routePoints: RoutePoint[] = circuit
      .map((id) => {
        const n = this.nodes.get(id);
        return n ? { latitude: n.lat, longitude: n.lon, nodeId: id } : null;
      })
      .filter((p): p is RoutePoint => p !== null);

    const stats = this.calculateStats(circuit);

    return {
      route: routePoints,
      totalDistance: stats.totalKm,
      message: `Offline optimizer (v2): ${stats.totalKm.toFixed(2)} km, ${routePoints.length} points. Turns: R${stats.rightTurns} L${stats.leftTurns} U${stats.uTurns} S${stats.straight}`,
    };
  }

  private buildGraph(): void {
    this.graph.clear();

    for (const way of this.ways) {
      const isOneway = way.tags?.oneway === "yes";

      for (let i = 0; i < way.nodes.length - 1; i++) {
        const from = way.nodes[i];
        const to = way.nodes[i + 1];

        const fromNode = this.nodes.get(from);
        const toNode = this.nodes.get(to);
        if (!fromNode || !toNode) continue;

        const length = this.haversine(fromNode, toNode) * 1000;

        if (!this.graph.has(from)) this.graph.set(from, new Map());
        this.graph.get(from)!.set(to, { length, oneway: isOneway });

        if (!isOneway) {
          if (!this.graph.has(to)) this.graph.set(to, new Map());
          this.graph.get(to)!.set(from, { length, oneway: false });
        }
      }
    }
  }

  private makeEulerian(): void {
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

  private chooseBest(prev: string | null, current: string, edges: Map<string, EdgeData>): string {
    const keys = Array.from(edges.keys());
    if (!prev || keys.length === 1) return keys[0]!;

    const inBearing = this.bearing(prev, current);
    let best = keys[0]!;
    let bestScore = Infinity;

    for (const next of keys) {
      const outBearing = this.bearing(current, next);
      const turn = this.normalizeTurn(outBearing - inBearing);

      let cost: number;
      if (Math.abs(turn) > 150) {
        cost = TURN_COSTS.U_TURN;
      } else if (turn > 120) {
        cost = TURN_COSTS.SHARP_LEFT;
      } else if (turn > 30) {
        cost = TURN_COSTS.LEFT_TURN;
      } else if (turn >= -30) {
        cost = TURN_COSTS.STRAIGHT;
      } else if (turn >= -120) {
        cost = TURN_COSTS.RIGHT_TURN;
      } else {
        cost = TURN_COSTS.SHARP_RIGHT;
      }

      const edgeData = edges.get(next)!;
      const score = edgeData.length + cost;

      if (score < bestScore) {
        bestScore = score;
        best = next;
      }
    }

    return best;
  }

  private findStartNode(lat?: number, lon?: number): string | null {
    const component = this.largestComponent();

    if (lat !== undefined && lon !== undefined) {
      let closest: string | null = null;
      let minDist = Infinity;
      for (const id of component) {
        const node = this.nodes.get(id);
        if (!node) continue;
        const d = this.haversine({ id: "", lat, lon }, node);
        if (d < minDist) {
          minDist = d;
          closest = id;
        }
      }
      return closest;
    }

    for (const id of component) {
      const edges = this.graph.get(id);
      if (edges && edges.size === 1) return id;
    }

    return component.values().next().value || null;
  }

  private largestComponent(): Set<string> {
    const visited = new Set<string>();
    let largest = new Set<string>();

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

      if (comp.size > largest.size) largest = comp;
    }

    return largest;
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

    return { totalKm: total, rightTurns: right, leftTurns: left, uTurns: uturns, straight };
  }

  private haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
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
    const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(x, y) * (180 / Math.PI) + 360) % 360;
  }

  private normalizeTurn(angle: number): number {
    angle = angle % 360;
    if (angle > 180) angle -= 360;
    if (angle < -180) angle += 360;
    return angle;
  }
}
