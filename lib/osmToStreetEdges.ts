import type { StreetEdge } from "@/types/turnAware";
import type { Node, Way } from "@/lib/route-optimizer-v2/types";
import { haversineMeters } from "@/lib/_core/geo";

const DEFAULT_SPEED_KMH = 30;

/**
 * Convert OSM nodes + ways to StreetEdge[] for turn-aware graph.
 *
 * Edges are consolidated intersection-to-intersection: an "intersection" is any
 * node that appears in more than one way, or is a dead-end (first/last node of
 * a way). Intermediate shape-point nodes are folded into the edge's coordinate
 * list so the turn-expanded graph operates at intersection granularity rather
 * than individual node-pair granularity. This prevents the "spider/star"
 * routing artifact where the circuit bounces back and forth through a hub node.
 */
export function osmToStreetEdges(
  nodes: Map<string, Node>,
  ways: Way[],
  defaultSpeedKmh: number = DEFAULT_SPEED_KMH,
): StreetEdge[] {
  // ---- Step 1+2: Count way membership and total references in a single pass ----
  // nodeWayCount: how many distinct ways reference each node (for intersection detection)
  // nodeRefCount: total references across all ways (for self-intersection detection)
  const nodeWayCount = new Map<string, number>();
  const nodeRefCount = new Map<string, number>();
  for (const way of ways) {
    const seen = new Set<string>();
    for (const nid of way.nodes) {
      nodeRefCount.set(nid, (nodeRefCount.get(nid) ?? 0) + 1);
      if (!seen.has(nid)) {
        seen.add(nid);
        nodeWayCount.set(nid, (nodeWayCount.get(nid) ?? 0) + 1);
      }
    }
  }

  const isIntersectionFull = (nodeId: string, isEndpoint: boolean): boolean => {
    if (isEndpoint) return true;
    if ((nodeWayCount.get(nodeId) ?? 0) > 1) return true;
    if ((nodeRefCount.get(nodeId) ?? 0) > 2) return true;
    return false;
  };

  // ---- Step 3: Split each way at intersection nodes ----
  const edges: StreetEdge[] = [];

  for (const way of ways) {
    if (way.nodes.length < 2) continue;

    const oneway =
      way.tags?.oneway === "yes" ||
      way.tags?.oneway === "true" ||
      way.tags?.oneway === "1";
    const wayId = way.id || `way-${edges.length}`;

    // Walk through the way's node list, accumulating segments between
    // intersection nodes.
    let segStart = 0;
    let segIndex = 0;

    for (let i = 1; i < way.nodes.length; i++) {
      const nodeId = way.nodes[i]!;
      const isEnd = i === way.nodes.length - 1;
      const isSplit = isIntersectionFull(nodeId, isEnd);

      if (!isSplit) continue;

      // Build an edge from segStart..i
      const fromId = way.nodes[segStart]!;
      const toId = nodeId;
      const fromNode = nodes.get(fromId);
      const toNode = nodes.get(toId);
      if (!fromNode || !toNode) {
        segStart = i;
        continue;
      }

      // Accumulate coordinates and total length
      const segLen = i - segStart + 1;
      const coordinates: [number, number][] = new Array(segLen);
      let totalLength = 0;
      let valid = true;

      for (let j = segStart; j <= i; j++) {
        const n = nodes.get(way.nodes[j]!);
        if (!n) {
          valid = false;
          break;
        }
        const ci = j - segStart;
        coordinates[ci] = [n.lat, n.lon];
        if (ci > 0) {
          const prev = coordinates[ci - 1]!;
          totalLength += haversineMeters(prev[0], prev[1], n.lat, n.lon);
        }
      }

      if (!valid || coordinates.length < 2) {
        segStart = i;
        continue;
      }

      const edgeId = `${wayId}_s${segIndex}`;
      edges.push({
        id: edgeId,
        from: fromId,
        to: toId,
        coordinates,
        length: totalLength,
        speed: defaultSpeedKmh,
        oneWay: oneway,
        streetName: way.tags?.name,
        wayId: way.id ?? undefined,
      });

      segIndex++;
      segStart = i; // Next segment starts at this intersection node
    }
  }

  return edges;
}
