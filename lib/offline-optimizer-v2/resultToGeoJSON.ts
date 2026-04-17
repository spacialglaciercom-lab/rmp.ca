/**
 * Convert offline optimizer v2 results to GeoJSON FeatureCollection
 * This preserves road geometry by using the nodeIds to reconstruct the actual path.
 */

import type {
  Node,
  Way,
  OptimizationResult,
} from "@/lib/route-optimizer-v2/types";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-utils";
import { haversineMeters } from "@/lib/_core/geo";

interface WaySegment {
  wayId: string;
  fromNode: string;
  toNode: string;
  nodes: string[];
}

/**
 * Convert optimization result to GeoJSON FeatureCollection with proper road geometry.
 * This fixes the "as-the-crow-flies" issue by reconstructing the actual road path.
 */
export function optimizationResultToGeoJSON(
  result: OptimizationResult,
  nodes: Map<string, Node>,
  ways: Way[],
): GeoJSONFeatureCollection {
  const features: any[] = [];

  if (result.route.length < 2) {
    return { type: "FeatureCollection", features };
  }

  // Build a map of way segments for quick lookup
  const waySegments = buildWaySegments(ways);

  // Convert route points to LineString features following actual roads
  const routeCoords: [number, number][] = [];
  const stepFeatures: any[] = [];

  for (let i = 0; i < result.route.length - 1; i++) {
    const current = result.route[i];
    const next = result.route[i + 1];

    const currentNodeId = current.nodeId;
    const nextNodeId = next.nodeId;

    if (!currentNodeId || !nextNodeId) {
      // Fallback: use direct coordinates if nodeIds missing
      routeCoords.push([current.longitude, current.latitude]);
      continue;
    }

    // Find the road segment between these nodes
    const segment = findWaySegment(currentNodeId, nextNodeId, waySegments, nodes);

    if (segment && segment.nodes.length >= 2) {
      // Add all nodes along the road segment
      for (const nodeId of segment.nodes) {
        const node = nodes.get(nodeId);
        if (node) {
          routeCoords.push([Number(node.lon), Number(node.lat)]);
        }
      }

      // Create a step feature for this road segment
      const segmentCoords: [number, number][] = segment.nodes
        .map((id) => nodes.get(id))
        .filter((n): n is Node => n !== undefined)
        .map((n) => [Number(n.lon), Number(n.lat)]);

      if (segmentCoords.length >= 2) {
        // Calculate distance for this segment
        const distance = calculateSegmentDistance(segmentCoords);

        stepFeatures.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: segmentCoords },
          properties: {
            role: "step",
            stepIndex: i,
            name: `Segment ${i + 1}`,
            distance: distance,
            duration: (distance / 15) * 3.6, // Rough estimate: 15 m/s = 54 km/h
            fromNodeId: currentNodeId,
            toNodeId: nextNodeId,
            wayId: segment.wayId,
          },
        });
      }
    } else {
      // Fallback: direct line if no road segment found
      routeCoords.push([current.longitude, current.latitude]);
    }
  }

  // Add the final point
  const lastPoint = result.route[result.route.length - 1];
  if (lastPoint) {
    routeCoords.push([lastPoint.longitude, lastPoint.latitude]);
  }

  // Add full route as optimized-route feature
  if (routeCoords.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: routeCoords },
      properties: {
        role: "optimized-route",
        totalDistance: result.totalDistance,
        stepCount: stepFeatures.length,
      },
    });
  }

  // Add individual step features
  features.push(...stepFeatures);

  // Add start and end markers
  if (result.route.length >= 2) {
    const start = result.route[0];
    const end = result.route[result.route.length - 1];

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [start.longitude, start.latitude] },
      properties: {
        role: "start",
        label: "S",
        nodeId: start.nodeId,
      },
    });

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [end.longitude, end.latitude] },
      properties: {
        role: "end",
        label: "E",
        nodeId: end.nodeId,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Build a map of road segments for quick lookup
 */
function buildWaySegments(ways: Way[]): Map<string, WaySegment[]> {
  const segments = new Map<string, WaySegment[]>();

  for (const way of ways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const from = way.nodes[i]!;
      const to = way.nodes[i + 1]!;

      const segment: WaySegment = {
        wayId: way.id,
        fromNode: from,
        toNode: to,
        nodes: way.nodes.slice(i), // Include all nodes from this point to end
      };

      // Store forward direction
      if (!segments.has(from)) {
        segments.set(from, []);
      }
      segments.get(from)!.push(segment);

      // Store reverse direction (for bidirectional ways)
      if (way.tags?.oneway !== "yes") {
        if (!segments.has(to)) {
          segments.set(to, []);
        }
        segments.get(to)!.push({
          ...segment,
          fromNode: to,
          toNode: from,
          nodes: way.nodes.slice(0, i + 2).reverse(),
        });
      }
    }
  }

  return segments;
}

/**
 * Find the road segment between two nodes
 */
function findWaySegment(
  fromNode: string,
  toNode: string,
  segments: Map<string, WaySegment[]>,
  nodes: Map<string, Node>,
): WaySegment | null {
  const possibleSegments = segments.get(fromNode);
  if (!possibleSegments) return null;

  // Find segment that goes to the target node
  const segment = possibleSegments.find((s) => s.toNode === toNode);
  return segment || null;
}

/**
 * Calculate total distance of a segment in meters
 */
function calculateSegmentDistance(coords: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i]!;
    const [lon2, lat2] = coords[i + 1]!;
    total += haversineMeters(lat1, lon1, lat2, lon2);
  }
  return total;
}

