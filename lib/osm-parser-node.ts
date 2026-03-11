/**
 * Node.js-compatible OSM XML parser for testing and server-side processing
 * Uses regex-based parsing for better performance with large files
 */

export interface OSMNode {
  id: string;
  lat: number;
  lon: number;
}

export interface OSMWay {
  id: string;
  nodes: string[];
  tags: Record<string, string>;
}

export interface RoadGraph {
  nodes: Map<string, OSMNode>;
  ways: OSMWay[];
  adjacency: Map<string, Set<string>>;
}

/**
 * Parse OSM XML file using regex for better Node.js performance
 */
export function parseOSMFileNode(xmlContent: string): RoadGraph {
  const nodes = new Map<string, OSMNode>();
  const ways: OSMWay[] = [];
  const adjacency = new Map<string, Set<string>>();

  // Parse nodes using regex - store all for later reference
  const nodeRegex = /id="(\d+)"[^>]*lat="([\d.-]+)"[^>]*lon="([\d.-]+)"/g;
  let match;
  const allNodes = new Map<string, OSMNode>();

  console.log("🔄 Parsing nodes...");
  let nodeCount = 0;
  while ((match = nodeRegex.exec(xmlContent)) !== null) {
    const id = match[1];
    const lat = parseFloat(match[2]);
    const lon = parseFloat(match[3]);

    if (!isNaN(lat) && !isNaN(lon)) {
      allNodes.set(id, { id, lat, lon });
      nodeCount++;
    }
  }
  console.log(`✓ Parsed ${nodeCount} nodes`);

  // Parse ways using regex
  const wayRegex =
    /<way[^>]*id="(\d+)"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*)*)<\/way>/g;
  const nodeRefRegex = /<nd[^>]*ref="(\d+)"/g;
  const tagRegex = /<tag[^>]*k="([^"]*)"[^>]*v="([^"]*)"/g;

  console.log("🔄 Parsing ways...");
  let wayCount = 0;
  let wayMatch;

  while ((wayMatch = wayRegex.exec(xmlContent)) !== null) {
    const wayId = wayMatch[1];
    const wayContent = wayMatch[2];

    // Extract node references
    const nodeRefs: string[] = [];
    let nodeRefMatch;
    while ((nodeRefMatch = nodeRefRegex.exec(wayContent)) !== null) {
      nodeRefs.push(nodeRefMatch[1]);
    }

    // Extract tags
    const tags: Record<string, string> = {};
    let tagMatch;
    while ((tagMatch = tagRegex.exec(wayContent)) !== null) {
      tags[tagMatch[1]] = tagMatch[2];
    }

    // Only include ways with nodes
    if (nodeRefs.length > 0) {
      ways.push({
        id: wayId,
        nodes: nodeRefs,
        tags,
      });
      wayCount++;

      // Add all nodes from way to graph
      for (const nodeId of nodeRefs) {
        if (allNodes.has(nodeId) && !nodes.has(nodeId)) {
          nodes.set(nodeId, allNodes.get(nodeId)!);
        }
      }

      // Build adjacency list
      for (let i = 0; i < nodeRefs.length - 1; i++) {
        const from = nodeRefs[i];
        const to = nodeRefs[i + 1];

        if (!adjacency.has(from)) {
          adjacency.set(from, new Set());
        }
        if (!adjacency.has(to)) {
          adjacency.set(to, new Set());
        }

        adjacency.get(from)!.add(to);
        adjacency.get(to)!.add(from); // Bidirectional
      }
    }
  }
  console.log(`✓ Parsed ${wayCount} ways`);

  return {
    nodes,
    ways,
    adjacency,
  };
}

/**
 * Find Eulerian path in the graph (for Chinese Postman Problem)
 */
export function findEulerianPathNode(
  graph: RoadGraph,
  startNodeId?: string,
): string[] {
  const adjacency = new Map(graph.adjacency);
  const path: string[] = [];
  const stack: string[] = [];

  // Find starting node (prefer odd-degree node for Eulerian path)
  let current = startNodeId || Array.from(adjacency.keys())[0];

  if (!current) {
    return [];
  }

  stack.push(current);

  while (stack.length > 0) {
    current = stack[stack.length - 1];
    const neighbors = adjacency.get(current);

    if (neighbors && neighbors.size > 0) {
      const next = Array.from(neighbors)[0];
      neighbors.delete(next);

      // Also remove reverse edge
      const reverseNeighbors = adjacency.get(next);
      if (reverseNeighbors) {
        reverseNeighbors.delete(current);
      }

      stack.push(next);
    } else {
      path.push(stack.pop()!);
    }
  }

  return path.reverse();
}

/**
 * Convert node path to collection points
 */
export function nodePathToCollectionPoints(
  nodeIds: string[],
  graph: RoadGraph,
): Array<{
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  collectionType: "residential" | "commercial" | "industrial";
  status: "pending" | "completed" | "skipped";
  scheduledTime: string;
}> {
  const points: Array<{
    id: string;
    address: string;
    latitude: number;
    longitude: number;
    collectionType: "residential" | "commercial" | "industrial";
    status: "pending" | "completed" | "skipped";
    scheduledTime: string;
  }> = [];

  nodeIds.forEach((nodeId, index) => {
    const node = graph.nodes.get(nodeId);
    if (!node) return;

    points.push({
      id: `point-${index}`,
      address: `Node ${nodeId}`,
      latitude: node.lat,
      longitude: node.lon,
      collectionType: "residential",
      status: "pending",
      scheduledTime: new Date().toISOString(),
    });
  });

  return points;
}

/**
 * Calculate route statistics
 */
export function calculateRouteStats(
  points: Array<{ latitude: number; longitude: number }>,
): {
  totalDistance: number;
  estimatedTime: number;
  pointCount: number;
} {
  let totalDistance = 0;

  // Calculate distance using Haversine formula
  for (let i = 0; i < points.length - 1; i++) {
    const lat1 = (points[i].latitude * Math.PI) / 180;
    const lon1 = (points[i].longitude * Math.PI) / 180;
    const lat2 = (points[i + 1].latitude * Math.PI) / 180;
    const lon2 = (points[i + 1].longitude * Math.PI) / 180;

    const dlat = lat2 - lat1;
    const dlon = lon2 - lon1;

    const a =
      Math.sin(dlat / 2) * Math.sin(dlat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) * Math.sin(dlon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const R = 6371; // Earth's radius in km

    totalDistance += R * c;
  }

  // Estimate time: drive time only at 25 km/h (residential trash collection).
  // Do NOT add per-point time - OSM routes have thousands of graph nodes, not actual stops.
  const estimatedTime = Math.round((totalDistance / 25) * 60);

  return {
    totalDistance,
    estimatedTime,
    pointCount: points.length,
  };
}
