/**
 * Route Optimizer v2 (from route-optimizer-mobile-v2)
 * Right-side trash collection: edge doubling + Hierholzer with turn optimization
 *
 * The graph uses an array-based adjacency list (AdjEntry[]) so that parallel
 * edges between the same intersection pair (e.g. divided boulevards, parallel
 * service roads) are preserved instead of silently overwritten.
 */

import {
  Node,
  Way,
  RoutePoint,
  OptimizationResult,
  type RouteStats,
  type TurnRestriction,
  type TurnPenaltyWeights,
  type UturnRestrictionSet,
} from "./types";
import { debug, warn, sampleIds } from "./debug";
import {
  buildUturnRestrictions,
  isUturnForbidden,
  type GraphAccess,
} from "./uturn-restrictions";
import {
  CycleDetector,
  detectRouteCycle,
  detectSimpleOscillation,
  type CycleDetectorConfig,
} from "../cycleDetector";

interface EdgeData {
  length: number;
  oneway: boolean;
  direction?: "forward" | "reverse";
  oneway_violation?: boolean;
  wayId?: string;
}

/** Single entry in an adjacency list. Carries a unique id so parallel edges
 *  between the same (from, to) pair are distinguishable. */
interface AdjEntry {
  target: string;
  data: EdgeData;
  edgeId: string;
}

type AdjGraph = Map<string, AdjEntry[]>;

// Optional configuration for RouteOptimizer behavior
export interface RouteOptimizerOptions {
  /** Distance in meters to merge nearby nodes (default 15) */
  mergeNearbyThresholdM?: number;
  /** Anti-loop mode strength */
  antiLoopMode?: "off" | "standard" | "strict";
  /** Log every N loop detections (default 10) */
  logLoopEvery?: number;
  /** Minimum edge length in meters to avoid micro-stubs (default 0.05) */
  minEdgeMeters?: number;
  /** When true, each bidirectional street is traversed twice (both sides / left and right curb). */
  serviceBothSides?: boolean;
}

// ─── Graph helpers ────────────────────────────────────────────────

function ensureNode(graph: AdjGraph, node: string): AdjEntry[] {
  let list = graph.get(node);
  if (!list) { list = []; graph.set(node, list); }
  return list;
}

function outDegree(graph: AdjGraph, node: string): number {
  return graph.get(node)?.length ?? 0;
}

/** Return the first edge from `from` to `target`, or undefined. */
function findEdge(graph: AdjGraph, from: string, target: string): AdjEntry | undefined {
  return graph.get(from)?.find((e) => e.target === target);
}

/** Return all distinct neighbor node ids reachable from `node`. */
function neighborIds(graph: AdjGraph, node: string): string[] {
  const list = graph.get(node);
  if (!list || list.length === 0) return [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) seen.add(list[i]!.target);
  return Array.from(seen);
}

/** Total edge count across the entire graph. */
function totalEdges(graph: AdjGraph): number {
  let count = 0;
  graph.forEach((list) => { count += list.length; });
  return count;
}

/** Deep-copy a graph (for Hierholzer's destructive traversal). */
function copyGraph(graph: AdjGraph): AdjGraph {
  const copy: AdjGraph = new Map();
  graph.forEach((list, node) => {
    copy.set(node, list.map((e) => ({ ...e, data: { ...e.data } })));
  });
  return copy;
}

/** Remove the first edge matching `edgeId` from `from`'s adjacency list. */
function removeEdge(graph: AdjGraph, from: string, edgeId: string): void {
  const list = graph.get(from);
  if (!list) return;
  const idx = list.findIndex((e) => e.edgeId === edgeId);
  if (idx !== -1) list.splice(idx, 1);
}

// ─── Road Class Filtering ─────────────────────────────────────────

/**
 * Road classes that are NOT traversable by vehicles and should be excluded
 * from routing. These create false connections in the graph.
 */
const NON_VEHICLE_ROAD_CLASSES = new Set([
  // Pedestrian-only
  "footway",
  "pedestrian",
  "steps",
  "path",
  "corridor",
  // Cycling-only (unless access=yes for vehicles)
  "cycleway",
  // Other non-vehicle
  "bridleway",  // Horse paths
  "elevator",
  "escalator",
  "platform",  // Transit platforms
  "raceway",  // Racing circuits (not public roads)
]);

/**
 * Check if a way should be excluded from vehicle routing based on its highway tag.
 */
function isNonVehicleRoad(way: Way): boolean {
  const highway = way.tags?.highway?.toLowerCase()?.trim() ?? "";
  const roadClass = way.tags?.class?.toLowerCase()?.trim() ?? "";
  return NON_VEHICLE_ROAD_CLASSES.has(highway) || NON_VEHICLE_ROAD_CLASSES.has(roadClass);
}

// ─── RouteOptimizer ───────────────────────────────────────────────

let nextEdgeSeq = 0;
function genEdgeId(wayId: string, from: string, to: string): string {
  return `${wayId}:${from}-${to}:${nextEdgeSeq++}`;
}

/**
 * Generate a canonical segment key for deduplication.
 * For two-way streets: sorted tuple of endpoints (order-independent)
 * For one-way streets: ordered tuple (preserves direction)
 * 
 * Uses 5 decimal places (~1.1m precision) to catch near-duplicate roads.
 */
function segmentKey(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  isOneway: boolean
): string {
  const p1 = `${lat1.toFixed(5)},${lon1.toFixed(5)}`;
  const p2 = `${lat2.toFixed(5)},${lon2.toFixed(5)}`;
  if (isOneway) {
    return `${p1}|${p2}`;
  }
  return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
}

/**
 * Haversine distance in meters between two lat/lon points.
 */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Merge nearby nodes within a threshold distance.
 * This handles roads that are slightly offset (like divided highways where
 * each direction has different coordinates but represents the same intersection).
 * 
 * Uses a simple grid-based spatial index for O(n) performance.
 */
function mergeNearbyNodes(
  nodes: Map<string, Node>,
  ways: Way[],
  thresholdM: number = 15
): { nodes: Map<string, Node>; nodeMapping: Map<string, string> } {
  if (thresholdM <= 0) {
    return { nodes, nodeMapping: new Map() };
  }

  // Build a set of nodes that are actually used in ways
  const usedNodeIds = new Set<string>();
  for (const way of ways) {
    for (const nodeId of way.nodes) {
      usedNodeIds.add(nodeId);
    }
  }

  // Filter to only used nodes
  const usedNodes: Array<[string, Node]> = [];
  for (const [id, node] of nodes) {
    if (usedNodeIds.has(id)) {
      usedNodes.push([id, node]);
    }
  }

  if (usedNodes.length < 2) {
    return { nodes, nodeMapping: new Map() };
  }

  // Grid-based spatial index (~0.0002 degrees ≈ 20m at mid-latitudes)
  const cellSize = 0.0002;
  const grid = new Map<string, Array<[string, Node]>>();

  for (const [id, node] of usedNodes) {
    const cellKey = `${Math.floor(node.lat / cellSize)},${Math.floor(node.lon / cellSize)}`;
    let cell = grid.get(cellKey);
    if (!cell) {
      cell = [];
      grid.set(cellKey, cell);
    }
    cell.push([id, node]);
  }

  // Union-Find for grouping nearby nodes
  const parent = new Map<string, string>();
  for (const [id] of usedNodes) {
    parent.set(id, id);
  }

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr)!;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  function union(x: string, y: string): void {
    const px = find(x);
    const py = find(y);
    if (px !== py) {
      parent.set(px, py);
    }
  }

  // Find pairs of nodes within threshold
  for (const [cellKey, cellNodes] of grid) {
    const [cx, cy] = cellKey.split(",").map(Number);
    
    // Check this cell and 8 neighbors
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${cx + dx},${cy + dy}`;
        const neighborNodes = grid.get(neighborKey);
        if (!neighborNodes) continue;

        for (const [id1, node1] of cellNodes) {
          for (const [id2, node2] of neighborNodes) {
            if (id1 >= id2) continue; // Avoid duplicate comparisons
            const dist = haversineMeters(node1.lat, node1.lon, node2.lat, node2.lon);
            if (dist <= thresholdM) {
              union(id1, id2);
            }
          }
        }
      }
    }
  }

  // Build mapping from old node IDs to canonical (merged) node IDs
  const nodeMapping = new Map<string, string>();
  const groups = new Map<string, string[]>();

  for (const [id] of usedNodes) {
    const root = find(id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(id);
  }

  let mergedCount = 0;
  for (const [, members] of groups) {
    if (members.length > 1) {
      const canonical = members[0]!;
      for (let i = 1; i < members.length; i++) {
        nodeMapping.set(members[i]!, canonical);
        mergedCount++;
      }
    }
  }

  if (mergedCount > 0) {
    debug("mergeNearbyNodes", {
      totalNodes: usedNodes.length,
      mergedCount,
      thresholdM,
    });
  }

  return { nodes, nodeMapping };
}

export class RouteOptimizer {
  private nodes: Map<string, Node>;
  private ways: Way[];
  private turnRestrictions: TurnRestriction[];
  private originalGraph: AdjGraph = new Map();
  private doubledGraph: AdjGraph = new Map();
  private uturnRestrictions: UturnRestrictionSet | null = null;
  private onewayMode: string = "A";
  private route: string[] = [];
  private deadEndNodes: Set<string> = new Set();
  private turnPenalties: TurnPenaltyWeights = { leftTurn: 50, uTurn: 200, rightTurn: 0 };
  /** Track recent U-turns to apply cumulative penalty */
  private recentUturnCount: number = 0;
  /** Nodes where we made a U-turn (to detect re-traversal patterns) */
  private uturnLocations: Set<string> = new Set();
  private stats: RouteStats = {
    total_traversals: 0,
    total_distance_km: 0.0,
    right_turns: 0,
    left_turns: 0,
    u_turns: 0,
    straight: 0,
    oneway_violations: [],
    single_pass_segments: [],
    dead_ends_identified: 0,
    u_turns_avoided: 0,
    efficiency: 0,
  };

  private edgePenaltyMultipliers: Map<string, number> = new Map();
  /** Maps merged node IDs to their canonical representative */
  private nodeMapping: Map<string, string> = new Map();
  /** Cycle detector for preventing infinite loops during Hierholzer traversal */
  private cycleDetector: CycleDetector | null = null;
  /** Track cycle detection diagnostics */
  private cycleDiagnostics = { loopsDetected: 0, escapeAttempts: 0 };
  /** Edge traversal counters to enforce minimum quotas and detect zero-cost loops */
  private edgeTraversalCounts: Map<string, number> = new Map();
  /** Local tabu list (node IDs) maintained by optimizer heuristics */
  private localTabuNodes: Set<string> = new Set();
  /** Options for tuning behavior */
  private options: RouteOptimizerOptions = {};

  constructor(
    nodes: Map<string, Node>,
    ways: Way[],
    onewayMode: string = "A",
    turnRestrictions: TurnRestriction[] = [],
    edgePenaltyMultipliers?: Map<string, number>,
    options?: RouteOptimizerOptions
  ) {
    this.options = options ?? {};
    // Merge nearby nodes (within 15m) to handle offset road data
    const mergeM = this.options.mergeNearbyThresholdM ?? 15;
    const { nodeMapping } = mergeNearbyNodes(nodes, ways, mergeM);
    this.nodeMapping = nodeMapping;
    this.nodes = nodes;
    this.ways = ways;
    this.turnRestrictions = turnRestrictions;
    this.onewayMode = onewayMode;
    if (edgePenaltyMultipliers?.size) this.edgePenaltyMultipliers = edgePenaltyMultipliers;
    this.buildOriginalGraph();
  }

  /** Get the canonical node ID (after merging nearby nodes) */
  private canonical(nodeId: string): string {
    return this.nodeMapping.get(nodeId) ?? nodeId;
  }

  // ─── Graph construction ───────────────────────────────────────

  private buildOriginalGraph(): void {
    this.originalGraph.clear();

    // Track seen segments to prevent duplicates (same road from multiple features)
    const seenSegments = new Set<string>();
    let edgesAdded = 0;
    let duplicatesSkipped = 0;
    let nodesMerged = 0;
    let nonVehicleFiltered = 0;
    const filteredClasses = new Map<string, number>();

    for (const way of this.ways) {
      // Filter out non-vehicle road classes (footway, steps, cycleway, etc.)
      if (isNonVehicleRoad(way)) {
        nonVehicleFiltered++;
        const roadClass = way.tags?.highway || way.tags?.class || "unknown";
        filteredClasses.set(roadClass, (filteredClasses.get(roadClass) ?? 0) + 1);
        continue;
      }

      // Determine direction from Overture 'direction' property or OSM 'oneway' tag
      // direction: "forward" (one-way in digitization), "backward" (one-way reverse), "both" (two-way)
      const directionTag = way.tags?.direction?.toLowerCase()?.trim();
      let direction: "forward" | "backward" | "both" = "both";
      
      if (directionTag === "forward" || directionTag === "backward") {
        direction = directionTag;
      } else if (
        way.tags?.oneway === "yes" ||
        way.tags?.oneway === "true" ||
        way.tags?.oneway === "1"
      ) {
        direction = "forward";
      } else if (way.tags?.oneway === "-1") {
        direction = "backward";
      }
      
      const oneway = direction !== "both";

      for (let i = 0; i < way.nodes.length - 1; i++) {
        const rawFrom = way.nodes[i]!;
        const rawTo = way.nodes[i + 1]!;

        // Apply node merging - use canonical IDs for graph construction
        const from = this.canonical(rawFrom);
        const to = this.canonical(rawTo);
        if (from !== rawFrom || to !== rawTo) nodesMerged++;

        // Skip self-loops created by node merging
        if (from === to) {
          duplicatesSkipped++;
          continue;
        }

        const fromNode = this.nodes.get(rawFrom); // Use raw ID for coordinates
        const toNode = this.nodes.get(rawTo);
        if (!fromNode || !toNode) continue;

        // Deduplicate segments: same physical road from different features
        // should only be traversed once per direction
        const segKey = segmentKey(
          fromNode.lat, fromNode.lon,
          toNode.lat, toNode.lon,
          oneway
        );
        if (seenSegments.has(segKey)) {
          duplicatesSkipped++;
          continue;
        }
        seenSegments.add(segKey);

        let length =
          this.haversineDistance(
            fromNode.lat, fromNode.lon,
            toNode.lat, toNode.lon
          ) * 1000;
        // Guard against zero-length or near-zero edges caused by precision or
        // merged nodes. Enforce a small minimum to avoid zero-cost loops.
        const minEdge = this.options.minEdgeMeters ?? 0.05;
        if (length < minEdge) length = minEdge;

        const wayId = way.id || "";
        const penalty = this.edgePenaltyMultipliers.get(wayId) ?? 0;
        length = length * (1 + penalty);

        const edgeData: EdgeData = { length, oneway, wayId };

        // Add edges based on direction:
        // - "forward": only from→to (one-way in digitization direction)
        // - "backward": only to→from (one-way opposite to digitization)
        // - "both": both directions (two-way street)
        if (direction === "backward") {
          // One-way in reverse: only add to→from edge
          ensureNode(this.originalGraph, to).push({
            target: from,
            data: { length, oneway: true, wayId },
            edgeId: genEdgeId(wayId, to, from),
          });
          edgesAdded++;
        } else {
          // Forward or both: add from→to edge
          ensureNode(this.originalGraph, from).push({
            target: to,
            data: edgeData,
            edgeId: genEdgeId(wayId, from, to),
          });
          edgesAdded++;

          if (direction === "both") {
            // Two-way: also add reverse edge
            ensureNode(this.originalGraph, to).push({
              target: from,
              data: { length, oneway: false, wayId },
              edgeId: genEdgeId(wayId, to, from),
            });
            edgesAdded++;
          }
        }
      }
    }

    debug("buildOriginalGraph", {
      waysCount: this.ways.length,
      nodesInGraph: this.originalGraph.size,
      edgesAdded,
      duplicatesSkipped,
      nodesMerged,
      nonVehicleFiltered,
      filteredClasses: Object.fromEntries(filteredClasses),
      sampleNodeIds: sampleIds(this.originalGraph.keys()),
    });
  }

  private doubleEdges(): void {
    this.doubledGraph.clear();

    // Ensure every node referenced by original edges exists in doubled graph
    for (const node of this.originalGraph.keys()) {
      ensureNode(this.doubledGraph, node);
    }
    this.originalGraph.forEach((list) => {
      for (const entry of list) {
        ensureNode(this.doubledGraph, entry.target);
      }
    });

    // Pass 1: add every original edge as "forward".
    // For bidirectional streets, originalGraph already contains both A→B and
    // B→A as separate entries, so this gives one traversal per direction.
    this.originalGraph.forEach((list, u) => {
      for (const entry of list) {
        ensureNode(this.doubledGraph, u).push({
          target: entry.target,
          data: { ...entry.data, direction: "forward" },
          edgeId: genEdgeId(entry.data.wayId ?? "", u, entry.target),
        });
      }
    });

    // Pass 2: for one-way edges, add the reverse direction so both sides of
    // the street are serviced.  Bidirectional edges already have both
    // directions from pass 1, so they need nothing extra.
    this.originalGraph.forEach((list, u) => {
      for (const entry of list) {
        const v = entry.target;
        const oneway = entry.data.oneway;

        if (!oneway) continue; // reverse already in originalGraph as its own edge

        if (this.onewayMode === "A") {
          const reverseData: EdgeData = {
            ...entry.data,
            direction: "reverse",
            oneway_violation: true,
          };
          ensureNode(this.doubledGraph, v).push({
            target: u,
            data: reverseData,
            edgeId: genEdgeId(entry.data.wayId ?? "", v, u),
          });
          this.stats.oneway_violations.push([v, u]);
        } else {
          this.stats.single_pass_segments.push([u, v]);
        }
      }
    });

    // Pass 3: when serviceBothSides (two-pass / both curbs), add a second copy of every
    // bidirectional edge so the route traverses each segment twice (left and right side).
    if (this.options.serviceBothSides) {
      const entriesToDuplicate: { u: string; entry: AdjEntry }[] = [];
      this.doubledGraph.forEach((list, u) => {
        for (const entry of list) {
          if (!entry.data.oneway) {
            entriesToDuplicate.push({ u, entry });
          }
        }
      });
      for (const { u, entry } of entriesToDuplicate) {
        const v = entry.target;
        const wayId = entry.data.wayId ?? "";
        ensureNode(this.doubledGraph, u).push({
          target: v,
          data: { ...entry.data, direction: "forward" },
          edgeId: `${genEdgeId(wayId, u, v)}:2`,
        });
      }
    }

    this.identifyDeadEnds();
    this.applyUturnRestrictions();
    const edgeCount = totalEdges(this.doubledGraph);
    debug("doubleEdges", {
      onewayMode: this.onewayMode,
      doubledGraphNodes: this.doubledGraph.size,
      doubledGraphEdges: edgeCount,
      deadEnds: this.deadEndNodes.size,
    });
    this.verifyBalance();
  }

  // ─── Balance & degree checks ──────────────────────────────────

  private identifyDeadEnds(): void {
    this.deadEndNodes.clear();

    for (const [node, list] of this.doubledGraph.entries()) {
      if (list.length === 1) {
        const neighbor = list[0]!.target;
        const neighborList = this.doubledGraph.get(neighbor);
        if (neighborList?.some((e) => e.target === node)) {
          this.deadEndNodes.add(node);
        }
      }
    }

    this.stats.dead_ends_identified = this.deadEndNodes.size;
  }

  private isBalanced(): boolean {
    const inDegree = new Map<string, number>();
    for (const node of this.doubledGraph.keys()) {
      inDegree.set(node, 0);
    }
    this.doubledGraph.forEach((list) => {
      for (const entry of list) {
        inDegree.set(entry.target, (inDegree.get(entry.target) || 0) + 1);
      }
    });
    for (const [node, inDeg] of inDegree.entries()) {
      if (inDeg !== outDegree(this.doubledGraph, node)) return false;
    }
    return true;
  }

  private verifyBalance(): void {
    const inDegree = new Map<string, number>();
    for (const node of this.doubledGraph.keys()) inDegree.set(node, 0);
    this.doubledGraph.forEach((list) => {
      for (const entry of list) {
        inDegree.set(entry.target, (inDegree.get(entry.target) || 0) + 1);
      }
    });
    const unbalanced: Array<[string, number, number]> = [];
    for (const [node, inDeg] of inDegree.entries()) {
      const outDeg = outDegree(this.doubledGraph, node);
      if (inDeg !== outDeg) unbalanced.push([node, inDeg, outDeg]);
    }
    if (unbalanced.length > 0) {
      warn("verifyBalance", `Found ${unbalanced.length} unbalanced nodes`, {
        sample: unbalanced.slice(0, 6).map(([n, i, o]) => `${n}(in=${i},out=${o})`),
      });
    } else {
      debug("verifyBalance", { balanced: true });
    }
  }

  // ─── U-turn restrictions ──────────────────────────────────────

  private applyUturnRestrictions(): void {
    const graphAccess: GraphAccess = {
      getEdgeWayId: (from, to) =>
        this.originalGraph.get(from)?.find((e) => e.target === to)?.data.wayId,
      getNeighbors: (node) => neighborIds(this.originalGraph, node),
      nodeIds: () => this.originalGraph.keys(),
    };
    this.uturnRestrictions = buildUturnRestrictions(
      this.ways,
      this.turnRestrictions,
      graphAccess,
      this.deadEndNodes
    );
  }

  // ─── Hierholzer ───────────────────────────────────────────────

  private hierholzerWithTurnOptimization(startNode: string): string[] {
    const graphCopy = copyGraph(this.doubledGraph);

    const circuit: string[] = [];
    const stack: string[] = [startNode];

    // Incremental counter — O(1) per edge removal instead of O(V) per iteration
    let remainingEdgeCount = totalEdges(graphCopy);

    // Reset U-turn tracking for this traversal
    this.recentUturnCount = 0;
    this.uturnLocations.clear();

    // Initialize cycle detector for this traversal (skip when antiLoopMode is "off")
    const strict = this.options.antiLoopMode === "strict";
    const antiLoopOff = this.options.antiLoopMode === "off";
    this.cycleDetector = antiLoopOff
      ? null
      : new CycleDetector({
          maxSccRevisits: strict ? 1 : 2,
          maxNodeRevisits: strict ? 2 : 3,
          recentWindowSize: strict ? 20 : 30,
          debug: false,
        });
    this.cycleDiagnostics = { loopsDetected: 0, escapeAttempts: 0 };
    // Reset traversal quotas and local tabu state
    this.edgeTraversalCounts.clear();
    this.localTabuNodes.clear();

    // Safety cap based on graph size
    const maxIterations = totalEdges(this.doubledGraph) * 3;
    let iterations = 0;

    while (stack.length > 0 && iterations < maxIterations) {
      iterations++;
      const current = stack[stack.length - 1]!;
      const edges = graphCopy.get(current);
      
      // Check for infinite loop patterns using cycle detector (counter maintained incrementally)
      let loopEscapeMode = false;
      if (this.cycleDetector) {
        const detection = this.cycleDetector.enterNode(current, remainingEdgeCount);
        if (detection.isLooping) {
          this.cycleDiagnostics.loopsDetected++;
          // Only log every 10th loop to reduce spam
          const logEvery = this.options.logLoopEvery ?? 10;
          if (logEvery > 0 && this.cycleDiagnostics.loopsDetected % logEvery === 1) {
            warn("hierholzer", `Loop detected (${detection.loopType}) at ${current}`, {
              stagnantIterations: detection.stagnantIterations,
              tabuNodes: detection.tabuNodes.size,
            });
          }
          this.cycleDiagnostics.escapeAttempts++;
          loopEscapeMode = true;
          
          // If severely stuck, force backtrack to break circular patterns earlier
          const backtrackThreshold = strict ? 25 : 35;
          if (detection.stagnantIterations > backtrackThreshold && stack.length > 3) {
            // Force backtrack by treating current as having no edges
            if (this.cycleDetector) {
              this.cycleDetector.leaveNode(current);
            }
            circuit.push(stack.pop()!);
            continue;
          }
        }
      }

      // Detect simple oscillation in the recent stack and mark culprit tabu
      const osc = detectSimpleOscillation(stack, strict ? 10 : 12, strict ? 2 : 3);
      if (osc.isOscillating && osc.culprit) {
        this.localTabuNodes.add(osc.culprit);
        loopEscapeMode = true;
      }

      if (edges && edges.length > 0) {
        let chosen: AdjEntry;

        if (edges.length > 1 && stack.length > 1) {
          const prevNode = stack[stack.length - 2]!;
          chosen = this.chooseBestEdge(
            graphCopy,
            prevNode,
            current,
            edges,
            stack,
            loopEscapeMode
          );
        } else {
          chosen = edges[0]!;
        }

        // Track U-turns for cumulative penalty
        if (stack.length > 1) {
          const prevNode = stack[stack.length - 2]!;
          if (chosen.target === prevNode) {
            this.recentUturnCount++;
            this.uturnLocations.add(current);
          } else {
            // Decay U-turn count when making non-U-turn moves
            this.recentUturnCount = Math.max(0, this.recentUturnCount - 0.5);
          }
        }
        
        // Update cycle detector with edge traversal
        if (this.cycleDetector) {
          this.cycleDetector.updateLowlink(current, chosen.target);
        }

        stack.push(chosen.target);
        // Increment traversal counter for this logical edge (edgeId is stable)
        const prevCount = this.edgeTraversalCounts.get(chosen.edgeId) ?? 0;
        this.edgeTraversalCounts.set(chosen.edgeId, prevCount + 1);

        removeEdge(graphCopy, current, chosen.edgeId);
        remainingEdgeCount--;
      } else {
        // Backtracking - notify cycle detector
        if (this.cycleDetector) {
          this.cycleDetector.leaveNode(current);
        }
        circuit.push(stack.pop()!);
      }
    }
    
    if (iterations >= maxIterations) {
      warn("hierholzer", `Hit iteration cap (${maxIterations})`, {
        circuitLength: circuit.length,
        stackLength: stack.length,
        remainingEdges: remainingEdgeCount,
      });
      if (this.cycleDetector) {
        const diag = this.cycleDetector.getDiagnostics();
        warn("hierholzer", "Cycle detector diagnostics", diag);
      }
    }
    
    // Check final circuit for repeating patterns
    const cycleCheck = detectRouteCycle(circuit, 5, 30);
    if (cycleCheck.hasCycle) {
      warn("hierholzer", "Repeating pattern detected in final circuit", {
        cycleStart: cycleCheck.cycleStart,
        cycleLength: cycleCheck.cycleLength,
      });
    }

    circuit.reverse();
    return circuit;
  }

  /**
   * Score each candidate edge from `current` and return the best one.
   * Considers turn angle, remaining-degree of destination, recency on the
   * Hierholzer stack, dead-end avoidance, and U-turn restrictions.
   */
  private chooseBestEdge(
    graph: AdjGraph,
    prevNode: string,
    current: string,
    candidates: AdjEntry[],
    stack: string[],
    loopEscapeMode: boolean = false
  ): AdjEntry {
    const incomingBearing = this.calculateBearing(prevNode, current);

    const incomingEdge = findEdge(graph, prevNode, current);
    const currentWayId = incomingEdge?.data.wayId;
    const uturnForbidden =
      this.uturnRestrictions &&
      isUturnForbidden(prevNode, current, currentWayId, this.uturnRestrictions);

    const hasNonUturn = candidates.some((e) => e.target !== prevNode);

    let best: AdjEntry | null = null;
    let bestScore = Infinity;
    
    // In loop escape mode, build a set of nodes to strongly avoid
    const recentStackNodes = new Set<string>();
    if (loopEscapeMode && stack.length > 5) {
      // Avoid the last 20 nodes on the stack when escaping
      for (let i = Math.max(0, stack.length - 20); i < stack.length; i++) {
        recentStackNodes.add(stack[i]!);
      }
    }

    for (const entry of candidates) {
      const neighbor = entry.target;
      const isUturnMove = neighbor === prevNode;
      if (isUturnMove && uturnForbidden && hasNonUturn) continue;

      const outgoingBearing = this.calculateBearing(current, neighbor);
      let signedAngle = (outgoingBearing - incomingBearing + 360) % 360;
      if (signedAngle > 180) signedAngle -= 360;
      const turnAngle = Math.abs(signedAngle);

      const rightTurnPreference = Math.abs(turnAngle - 90);
      const isUturn = turnAngle > 150;
      const isDeadEnd = this.deadEndNodes.has(neighbor);

      let score = rightTurnPreference;
      if (isUturn) {
        // Base U-turn penalty + cumulative penalty for repeated U-turns
        const cumulativePenalty = this.recentUturnCount * 150;
        score += 1000 + this.turnPenalties.uTurn + cumulativePenalty;
        
        // Extra penalty if we already made a U-turn at this location
        if (this.uturnLocations.has(current)) {
          score += 500;
        }
      } else if (turnAngle < 30) {
        score += 0;
      } else if (signedAngle > 0) {
        score += this.turnPenalties.rightTurn;
      } else {
        score += this.turnPenalties.leftTurn;
      }

      // Apply local tabu and edge traversal quota penalties (after base score exists)
      const edgeTraversalCount = this.edgeTraversalCounts.get(entry.edgeId) ?? 0;
      const strict = this.options.antiLoopMode === "strict";
      if (edgeTraversalCount > (strict ? 2 : 3)) {
        // Heavily discourage repeatedly traversed edges
        score += 5000;
      }
      if (this.localTabuNodes.has(neighbor)) {
        score += strict ? 3000 : 2000;
      }

      // Dead-end handling: prefer to complete dead-ends when we're already there
      if (isDeadEnd) {
        const remainingEdges = outDegree(graph, neighbor);
        if (remainingEdges > 1) {
          // Penalize entering a dead-end with multiple edges remaining
          score += 500;
        } else if (remainingEdges === 1) {
          // Slight preference for completing a dead-end (only 1 edge left)
          score -= 50;
        }
      }
      
      // If current node is a dead-end, strongly prefer leaving via the exit
      // rather than making unnecessary moves
      if (this.deadEndNodes.has(current) && !isUturn) {
        const currentRemaining = outDegree(graph, current);
        if (currentRemaining === 1) {
          // This is our only way out - take it
          score -= 200;
        }
      }

      // Prefer neighbors with more remaining outgoing edges (unvisited territory).
      const neighborRemaining = outDegree(graph, neighbor);
      if (neighborRemaining === 0) {
        score += 400;
      } else {
        score -= Math.min(neighborRemaining * 12, 80);
      }

      // Penalize recently-visited nodes to break oscillation loops.
      // Extended window (12 nodes) to catch longer back-and-forth patterns.
      if (stack.length > 2) {
        const windowEnd = stack.length - 1;
        const windowStart = Math.max(0, windowEnd - 12);
        for (let k = windowEnd; k >= windowStart; k--) {
          if (stack[k] === neighbor) {
            const recency = windowEnd - k;
            // Higher base penalty, slower decay for longer patterns
            score += 300 - recency * 20;
            break;
          }
        }
      }
      
      // Apply cycle detector penalties (Tarjan-inspired SCC tracking)
      if (this.cycleDetector) {
        // Check if neighbor is in tabu list (detected as part of a cycle)
        if (this.cycleDetector.isTabu(neighbor)) {
          score += loopEscapeMode ? 2000 : 800; // Much higher in escape mode
        }
        // Add penalty based on visit frequency in recent history
        const penalty = this.cycleDetector.getPenalty(neighbor);
        score += loopEscapeMode ? penalty * 3 : penalty; // Triple penalty in escape mode
      }
      
      // In loop escape mode, heavily penalize returning to recent stack nodes
      if (loopEscapeMode && recentStackNodes.has(neighbor)) {
        score += strict ? 2500 : 1500;
      }
      
      // Look-ahead: check if this choice will force a U-turn next step
      if (!isUturn && neighborRemaining > 0) {
        const neighborEdges = graph.get(neighbor);
        if (neighborEdges && neighborEdges.length > 0) {
          // Check if all remaining edges from neighbor lead back to current
          const allLeadBack = neighborEdges.every(e => e.target === current);
          if (allLeadBack) {
            // This move will force a U-turn - penalize it
            score += 400;
          }
        }
      }

      // Small randomized perturbation to break exact ties and avoid deterministic oscillation
      score += Math.random() * 1e-6;

      if (score < bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    return best ?? candidates[0]!;
  }

  // ─── Geometry helpers ─────────────────────────────────────────

  private calculateBearing(node1Id: string, node2Id: string): number {
    try {
      const node1 = this.nodes.get(node1Id);
      const node2 = this.nodes.get(node2Id);
      if (!node1 || !node2) return 0;

      const lat1Rad = (node1.lat * Math.PI) / 180;
      const lat2Rad = (node2.lat * Math.PI) / 180;
      const dlonRad = ((node2.lon - node1.lon) * Math.PI) / 180;

      const x = Math.sin(dlonRad) * Math.cos(lat2Rad);
      const y =
        Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dlonRad);

      const bearing = (Math.atan2(x, y) * 180) / Math.PI;
      return (bearing + 360) % 360;
    } catch {
      return 0;
    }
  }

  private haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ─── Start node selection ─────────────────────────────────────

  private findStartNode(customLat?: number, customLon?: number): string | null {
    if (customLat !== undefined && customLon !== undefined && !Number.isNaN(customLat) && !Number.isNaN(customLon)) {
      debug("findStartNode", {
        message: "Using custom start coordinates",
        customLat, customLon,
        graphNodes: this.doubledGraph.size,
      });

      let closestNode: string | null = null;
      let minDistance = Infinity;

      for (const [nodeId, list] of this.doubledGraph.entries()) {
        if (list.length === 0) continue;
        const node = this.nodes.get(nodeId);
        if (!node) continue;
        const distance = this.haversineDistance(customLat, customLon, node.lat, node.lon);
        if (distance < minDistance) {
          minDistance = distance;
          closestNode = nodeId;
        }
      }

      if (closestNode) {
        const snappedNode = this.nodes.get(closestNode);
        const snapDistanceM = minDistance * 1000;

        debug("findStartNode", {
          message: "Snapped to nearest road node",
          nodeId: closestNode,
          nodeLat: snappedNode?.lat,
          nodeLon: snappedNode?.lon,
          snapDistanceM: Math.round(snapDistanceM),
        });

        if (snapDistanceM > 500) {
          warn("findStartNode", `Start point snapped ${Math.round(snapDistanceM)}m from custom coordinates`, {
            customCoords: [customLat, customLon],
            snappedCoords: [snappedNode?.lat, snappedNode?.lon],
            snapDistanceM: Math.round(snapDistanceM),
            message: "Graph may not cover the starting area. Consider using a larger OSM extract.",
          });
        }
      }

      return closestNode;
    }

    debug("findStartNode", {
      message: "No custom coordinates - selecting high-degree non-dead-end",
      customLat, customLon,
      doubledGraphSize: this.doubledGraph.size,
    });

    // Build reverse adjacency for undirected connectivity checks
    const reverseAdj = new Map<string, Set<string>>();
    for (const [u, list] of this.doubledGraph.entries()) {
      for (const e of list) {
        if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, new Set());
        reverseAdj.get(e.target)!.add(u);
      }
    }

    const visited = new Set<string>();
    let largestComp: string[] = [];
    const allNodes = Array.from(this.doubledGraph.keys());
    for (const start of allNodes) {
      if (visited.has(start)) continue;
      if ((this.doubledGraph.get(start)?.length ?? 0) === 0) { visited.add(start); continue; }
      const q: string[] = [start];
      visited.add(start);
      const comp: string[] = [];
      while (q.length) {
        const v = q.shift()!;
        comp.push(v);
        const outs = this.doubledGraph.get(v) ?? [];
        for (const e of outs) {
          if (!visited.has(e.target)) { visited.add(e.target); q.push(e.target); }
        }
        const revs = reverseAdj.get(v) ?? new Set<string>();
        for (const r of revs) {
          if (!visited.has(r)) { visited.add(r); q.push(r); }
        }
      }
      if (comp.length > largestComp.length) largestComp = comp;
    }

    // Prefer a node with highest out-degree in the largest component, avoiding cul-de-sacs
    let bestNode: string | null = null;
    let bestDeg = -1;
    for (const nodeId of largestComp) {
      const deg = this.doubledGraph.get(nodeId)?.length ?? 0;
      if (deg === 0) continue;
      const isDead = this.deadEndNodes.has(nodeId);
      const score = isDead ? deg - 2 : deg; // discourage dead-ends
      if (score > bestDeg) { bestDeg = score; bestNode = nodeId; }
    }
    if (bestNode) {
      const fallbackNode = this.nodes.get(bestNode);
      debug("findStartNode", {
        message: "Fallback node selected",
        nodeId: bestNode,
        nodeLat: fallbackNode?.lat,
        nodeLon: fallbackNode?.lon,
      });
      return bestNode;
    }

    warn("findStartNode", "No start node found - graph may be empty", {
      nodesCount: this.nodes.size,
      doubledGraphSize: this.doubledGraph.size,
    });
    return null;
  }

  // ─── Stats ────────────────────────────────────────────────────

  private calculateRouteStats(): void {
    if (!this.route || this.route.length < 2) return;

    let totalDistance = 0;
    for (let i = 0; i < this.route.length - 1; i++) {
      const u = this.route[i]!;
      const v = this.route[i + 1]!;
      const edge = findEdge(this.doubledGraph, u, v);
      if (edge) totalDistance += edge.data.length;
    }
    this.stats.total_distance_km = totalDistance / 1000.0;

    const uniqueEdges = new Set<string>();
    for (let i = 0; i < this.route.length - 1; i++) {
      const u = this.route[i]!;
      const v = this.route[i + 1]!;
      uniqueEdges.add([u, v].sort().join("-"));
    }
    const totalEdgesInOriginal = totalEdges(this.originalGraph);
    this.stats.efficiency =
      totalEdgesInOriginal > 0
        ? (uniqueEdges.size / totalEdgesInOriginal) * 100
        : 0;

    for (let i = 1; i < this.route.length - 1; i++) {
      const incomingBearing = this.calculateBearing(this.route[i - 1]!, this.route[i]!);
      const outgoingBearing = this.calculateBearing(this.route[i]!, this.route[i + 1]!);
      const turnAngle = (outgoingBearing - incomingBearing + 360) % 360;

      if (turnAngle < 30 || turnAngle > 330) {
        this.stats.straight++;
      } else if (turnAngle >= 30 && turnAngle < 150) {
        this.stats.right_turns++;
      } else if (turnAngle > 210 && turnAngle <= 330) {
        this.stats.left_turns++;
      } else {
        this.stats.u_turns++;
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────

  optimize(
    customLat?: number,
    customLon?: number,
    turnPenalties?: TurnPenaltyWeights
  ): OptimizationResult {
    if (turnPenalties) {
      this.turnPenalties = {
        leftTurn: Math.max(0, Math.min(100, turnPenalties.leftTurn)),
        uTurn: Math.max(0, Math.min(100, turnPenalties.uTurn)),
        rightTurn: Math.max(0, Math.min(100, turnPenalties.rightTurn)),
      };
    }
    if (this.originalGraph.size === 0) {
      warn("optimize", "early exit: originalGraph.size === 0", {
        nodesMapSize: this.nodes.size,
        waysCount: this.ways.length,
      });
      return {
        route: [],
        totalDistance: 0,
        message: "No valid roads found in the OSM file",
        stats: this.stats,
      };
    }

    this.doubleEdges();

    if (this.doubledGraph.size === 0) {
      warn("optimize", "early exit: doubledGraph.size === 0 after doubleEdges", {
        originalGraphSize: this.originalGraph.size,
      });
      return {
        route: [],
        totalDistance: 0,
        message: "Failed to create doubled graph",
        stats: this.stats,
      };
    }

    const originalOnewayMode = this.onewayMode;
    if (!this.isBalanced()) {
      debug("optimize", {
        fallback: "rebuilding with onewayMode=A (was " + originalOnewayMode + ")",
      });
      this.onewayMode = "A";
      this.stats.oneway_violations = [];
      this.stats.single_pass_segments = [];
      this.doubledGraph.clear();
      this.doubleEdges();
      this.onewayMode = originalOnewayMode;
    }

    const startNode = this.findStartNode(customLat, customLon);
    debug("optimize", {
      startNode: startNode ?? null,
      customStart: customLat != null && customLon != null ? [customLat, customLon] : null,
      doubledGraphSize: this.doubledGraph.size,
      startOutDegree: startNode ? outDegree(this.doubledGraph, startNode) : 0,
    });
    if (!startNode) {
      warn("optimize", "early exit: no start node with outgoing edges", {
        doubledGraphSize: this.doubledGraph.size,
      });
      return {
        route: [],
        totalDistance: 0,
        message: "Could not find a starting node",
        stats: this.stats,
      };
    }

    const circuit = this.hierholzerWithTurnOptimization(startNode);
    this.route = circuit;
    this.stats.total_traversals = circuit.length - 1;
    this.calculateRouteStats();

    const routePoints: RoutePoint[] = [];
    const missingNodeIds: string[] = [];
    for (const nodeId of circuit) {
      const node = this.nodes.get(nodeId);
      if (node != null && typeof node.lat === "number" && typeof node.lon === "number") {
        routePoints.push({ latitude: node.lat, longitude: node.lon, nodeId });
      } else {
        missingNodeIds.push(nodeId);
      }
    }

    const startNodeData = startNode ? this.nodes.get(startNode) : null;
    debug("optimize", {
      circuitLength: circuit.length,
      routePointsLength: routePoints.length,
      totalDistanceKm: this.stats.total_distance_km.toFixed(3),
      missingNodeIdsCount: missingNodeIds.length,
      sampleCircuitIds: sampleIds(circuit),
      startNodeId: startNode ?? null,
      startPointCoords: startNodeData
        ? { lat: startNodeData.lat, lon: startNodeData.lon }
        : null,
      customStartInput:
        customLat != null && customLon != null ? { lat: customLat, lon: customLon } : null,
    });
    if (missingNodeIds.length > 0) {
      warn("optimize", `${missingNodeIds.length} circuit nodeIds not found in nodes Map`, {
        sampleMissing: sampleIds(missingNodeIds, 10),
      });
    }
    if (routePoints.length === 0 && circuit.length > 0) {
      warn("optimize", "routePoints is empty but circuit had nodes – all lookups failed?", {
        circuitLength: circuit.length,
        nodesMapSize: this.nodes.size,
        sampleCircuitIds: circuit.slice(0, 5),
      });
    }

    return {
      route: routePoints,
      totalDistance: this.stats.total_distance_km,
      message: `Route optimized. Distance: ${this.stats.total_distance_km.toFixed(2)} km. Right: ${this.stats.right_turns}, Left: ${this.stats.left_turns}, U-turns: ${this.stats.u_turns}. Efficiency: ${this.stats.efficiency.toFixed(1)}%`,
      stats: this.stats,
    };
  }

  getStats(): RouteStats {
    return this.stats;
  }
}
