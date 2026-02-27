import { CollectionPoint, CollectionType } from "@/types";
import { readFileAsText } from "@/lib/readFileAsText";

// Polyfill DOMParser for React Native
let DOMParserImpl: any;
if (typeof DOMParser === "undefined") {
  // React Native - use xmldom polyfill
  const { DOMParser: XMLDOMParser } = require("@xmldom/xmldom");
  DOMParserImpl = XMLDOMParser;
} else {
  // Web - use native DOMParser
  DOMParserImpl = DOMParser;
}

export interface OSMNode {
  id: string;
  lat: number;
  lon: number;
}

export interface OSMWay {
  id: string;
  nodes: string[]; // Array of node IDs
  tags: Record<string, string>;
  name?: string;
  highway?: string;
}

export interface RoadGraph {
  nodes: Map<string, OSMNode>;
  ways: OSMWay[];
  adjacency: Map<string, Set<string>>; // nodeId -> connected nodeIds
}

/**
 * Parse OSM XML and extract road network as a graph
 */
export function parseOSMWays(osmXML: string): RoadGraph {
  const parser = new DOMParserImpl();
  const doc = parser.parseFromString(osmXML, "text/xml");

  // Extract all nodes
  const nodes = new Map<string, OSMNode>();
  // Use getElementsByTagName for better compatibility with xmldom
  const nodeElements = doc.getElementsByTagName("node");
  
  for (let i = 0; i < nodeElements.length; i++) {
    const nodeEl = nodeElements[i];
    const id = nodeEl.getAttribute("id");
    const lat = parseFloat(nodeEl.getAttribute("lat") || "0");
    const lon = parseFloat(nodeEl.getAttribute("lon") || "0");
    
    if (id && !isNaN(lat) && !isNaN(lon)) {
      nodes.set(id, { id, lat, lon });
    }
  }

  // Extract all ways (streets)
  const ways: OSMWay[] = [];
  const wayElements = doc.getElementsByTagName("way");
  
  for (let i = 0; i < wayElements.length; i++) {
    const wayEl = wayElements[i];
    const id = wayEl.getAttribute("id");
    if (!id) continue;

    // Get node references
    const nodeRefs: string[] = [];
    const ndElements = wayEl.getElementsByTagName("nd");
    for (let j = 0; j < ndElements.length; j++) {
      const ref = ndElements[j].getAttribute("ref");
      if (ref) nodeRefs.push(ref);
    }

    // Get tags
    const tags: Record<string, string> = {};
    const tagElements = wayEl.getElementsByTagName("tag");
    for (let j = 0; j < tagElements.length; j++) {
      const tag = tagElements[j];
      const k = tag.getAttribute("k");
      const v = tag.getAttribute("v");
      if (k && v) tags[k] = v;
    }

    // Only include ways that are roads
    const highway = tags.highway;
    if (highway && nodeRefs.length >= 2) {
      ways.push({
        id,
        nodes: nodeRefs,
        tags,
        name: tags.name,
        highway,
      });
    }
  }

  // Build adjacency graph
  const adjacency = new Map<string, Set<string>>();
  
  ways.forEach((way) => {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const from = way.nodes[i];
      const to = way.nodes[i + 1];
      
      if (!adjacency.has(from)) adjacency.set(from, new Set());
      if (!adjacency.has(to)) adjacency.set(to, new Set());
      
      adjacency.get(from)!.add(to);
      adjacency.get(to)!.add(from); // Bidirectional
    }
  });

  return { nodes, ways, adjacency };
}

/**
 * Find Eulerian path using Hierholzer's algorithm
 * This ensures we traverse every street edge at least once
 */
export function findEulerianPath(graph: RoadGraph, startNodeId?: string): string[] {
  const adjacency = new Map<string, string[]>();
  
  // Copy adjacency list (we'll modify it)
  graph.adjacency.forEach((neighbors, nodeId) => {
    adjacency.set(nodeId, Array.from(neighbors));
  });

  // Find start node (prefer odd-degree node, or use provided start)
  let start = startNodeId;
  if (!start) {
    const oddDegreeNodes: string[] = [];
    adjacency.forEach((neighbors, nodeId) => {
      if (neighbors.length % 2 === 1) {
        oddDegreeNodes.push(nodeId);
      }
    });
    start = oddDegreeNodes[0] || Array.from(adjacency.keys())[0];
  }

  if (!start || !adjacency.has(start)) {
    // Fallback: return all nodes in order
    return Array.from(graph.nodes.keys());
  }

  const path: string[] = [];
  const stack: string[] = [start];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = adjacency.get(current) || [];

    if (neighbors.length === 0) {
      path.push(stack.pop()!);
    } else {
      // Pick the neighbor with the highest remaining degree to prefer
      // routes into unvisited territory over short loops back to
      // already-visited nodes. Falls back to pop() for the trivial case.
      let bestIdx = neighbors.length - 1;
      if (neighbors.length > 1) {
        let bestDeg = -1;
        for (let ni = 0; ni < neighbors.length; ni++) {
          const deg = (adjacency.get(neighbors[ni]!) || []).length;
          if (deg > bestDeg) { bestDeg = deg; bestIdx = ni; }
        }
      }
      const next = neighbors[bestIdx]!;
      neighbors.splice(bestIdx, 1);
      stack.push(next);

      // Remove reverse edge
      const reverseNeighbors = adjacency.get(next);
      if (reverseNeighbors) {
        const idx = reverseNeighbors.indexOf(current);
        if (idx !== -1) reverseNeighbors.splice(idx, 1);
      }
    }
  }

  return path.reverse();
}

/**
 * Convert way-based route to collection points for GPX export
 */
export function wayRouteToCollectionPoints(
  nodeIds: string[],
  graph: RoadGraph
): CollectionPoint[] {
  const points: CollectionPoint[] = [];

  nodeIds.forEach((nodeId, index) => {
    const node = graph.nodes.get(nodeId);
    if (!node) return;

    points.push({
      id: `point-${index}`,
      address: `Node ${nodeId}`,
      latitude: node.lat,
      longitude: node.lon,
      collectionType: "residential" as CollectionType,
      status: "pending",
      scheduledTime: new Date().toISOString(),
    });
  });

  return points;
}

/**
 * Main function: Import OSM file and generate street-following route
 * Accepts either a File object (web) or a string (native/web)
 */
export async function importOSMFileWithWays(
  fileOrContent: File | string
): Promise<CollectionPoint[]> {
  let text: string;
  
  if (typeof fileOrContent === "string") {
    // Already a string, use directly
    text = fileOrContent;
  } else if (fileOrContent instanceof File || (fileOrContent && typeof (fileOrContent as Blob).slice === "function")) {
    // File or Blob (web), read it safely (file.text may be undefined in some envs)
    text = await readFileAsText(fileOrContent as File);
  } else {
    throw new Error("Invalid file type. Expected File object or string content.");
  }
  
  const graph = parseOSMWays(text);
  
  // Find Eulerian path that covers all streets
  const routeNodeIds = findEulerianPath(graph);
  
  // Convert to collection points
  const points = wayRouteToCollectionPoints(routeNodeIds, graph);
  
  return points;
}
