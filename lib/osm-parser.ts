import { CollectionPoint, CollectionType } from "@/types";

export interface OSMNode {
  id: string;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OSMWay {
  id: string;
  nodeRefs: string[];
  tags?: Record<string, string>;
}

export interface OSMData {
  nodes: OSMNode[];
  ways: OSMWay[];
  bounds?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export interface ImportResult {
  success: boolean;
  collectionPoints: CollectionPoint[];
  statistics: {
    totalNodes: number;
    totalWays: number;
    extractedPoints: number;
    bounds: OSMData["bounds"];
  };
  errors: string[];
}

export interface ImportProgress {
  stage: "parsing" | "extracting" | "validating" | "complete" | "error";
  progress: number;
  message: string;
}

export interface ImportOptions {
  // Maximum number of collection points to extract (0 = unlimited)
  maxPoints?: number;
  // Include nodes with address tags
  includeAddresses?: boolean;
  // Include nodes with amenity tags
  includeAmenities?: boolean;
  // Include highway endpoints as collection points
  includeHighwayEndpoints?: boolean;
  // Sample rate for highway nodes (1 = every node, 5 = every 5th node)
  highwaySampleRate?: number;
}

// Parse OSM XML format - improved to handle various attribute orders
export function parseOSMXML(xmlContent: string): OSMData {
  const nodes: OSMNode[] = [];
  const ways: OSMWay[] = [];
  let bounds: OSMData["bounds"] | undefined;

  // Parse bounds - handle various attribute orders
  const boundsMatch =
    xmlContent.match(
      /<bounds[^>]*minlat="([^"]+)"[^>]*minlon="([^"]+)"[^>]*maxlat="([^"]+)"[^>]*maxlon="([^"]+)"/,
    ) || xmlContent.match(/<bounds[^>]*>/);

  if (boundsMatch && boundsMatch.length >= 5) {
    bounds = {
      minLat: parseFloat(boundsMatch[1]),
      minLon: parseFloat(boundsMatch[2]),
      maxLat: parseFloat(boundsMatch[3]),
      maxLon: parseFloat(boundsMatch[4]),
    };
  }

  // Parse nodes - handle various attribute orders and formats
  // Pattern 1: id before lat/lon
  const nodeRegex1 =
    /<node[^>]*\bid="(\d+)"[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*(?:\/>|>([\s\S]*?)<\/node>)/g;
  // Pattern 2: lat/lon before id
  const nodeRegex2 =
    /<node[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*\bid="(\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/node>)/g;

  let nodeMatch;
  const processedNodeIds = new Set<string>();

  // Try pattern 1
  while ((nodeMatch = nodeRegex1.exec(xmlContent)) !== null) {
    const nodeId = nodeMatch[1];
    if (processedNodeIds.has(nodeId)) continue;
    processedNodeIds.add(nodeId);

    const lat = parseFloat(nodeMatch[2]);
    const lon = parseFloat(nodeMatch[3]);

    // Validate coordinates
    if (
      isNaN(lat) ||
      isNaN(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      continue;
    }

    const node: OSMNode = {
      id: nodeId,
      lat,
      lon,
    };

    // Parse tags if present
    if (nodeMatch[4]) {
      const tags = parseTags(nodeMatch[4]);
      if (Object.keys(tags).length > 0) {
        node.tags = tags;
      }
    }

    nodes.push(node);
  }

  // Try pattern 2 if we didn't find many nodes
  if (nodes.length < 10) {
    while ((nodeMatch = nodeRegex2.exec(xmlContent)) !== null) {
      const nodeId = nodeMatch[3];
      if (processedNodeIds.has(nodeId)) continue;
      processedNodeIds.add(nodeId);

      const lat = parseFloat(nodeMatch[1]);
      const lon = parseFloat(nodeMatch[2]);

      if (
        isNaN(lat) ||
        isNaN(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        continue;
      }

      const node: OSMNode = {
        id: nodeId,
        lat,
        lon,
      };

      if (nodeMatch[4]) {
        const tags = parseTags(nodeMatch[4]);
        if (Object.keys(tags).length > 0) {
          node.tags = tags;
        }
      }

      nodes.push(node);
    }
  }

  // Parse ways
  const wayRegex = /<way[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
  let wayMatch;
  while ((wayMatch = wayRegex.exec(xmlContent)) !== null) {
    const wayContent = wayMatch[2];
    const nodeRefs: string[] = [];

    // Parse node references
    const ndRegex = /<nd[^>]*ref="(\d+)"/g;
    let ndMatch;
    while ((ndMatch = ndRegex.exec(wayContent)) !== null) {
      nodeRefs.push(ndMatch[1]);
    }

    // Parse tags
    const tags = parseTags(wayContent);

    ways.push({
      id: wayMatch[1],
      nodeRefs,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    });
  }

  return { nodes, ways, bounds };
}

// Helper function to parse tags
function parseTags(content: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const tagRegex = /<tag[^>]*k="([^"]+)"[^>]*v="([^"]+)"/g;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(content)) !== null) {
    tags[tagMatch[1]] = tagMatch[2];
  }
  return tags;
}

// Extract collection points from OSM data
export function extractCollectionPoints(
  osmData: OSMData,
  options: ImportOptions = {},
): CollectionPoint[] {
  const {
    maxPoints = 0, // 0 = unlimited
    includeAddresses = true,
    includeAmenities = true,
    includeHighwayEndpoints = true,
    highwaySampleRate = 1, // Changed from 10 to 1 to include all highway nodes
  } = options;

  const points: CollectionPoint[] = [];
  const nodeMap = new Map(osmData.nodes.map((n) => [n.id, n]));
  const usedNodeIds = new Set<string>();

  // Priority 1: Extract points from nodes with relevant tags (addresses, amenities)
  for (const node of osmData.nodes) {
    if (maxPoints > 0 && points.length >= maxPoints) break;
    if (usedNodeIds.has(node.id)) continue;

    if (!node.tags) continue;

    const isAddress =
      includeAddresses &&
      (node.tags["addr:street"] || node.tags["addr:housenumber"]);
    const isAmenity = includeAmenities && node.tags["amenity"];
    const isBuilding = node.tags["building"];
    const isShop = node.tags["shop"];
    const isOffice = node.tags["office"];

    if (isAddress || isAmenity || isBuilding || isShop || isOffice) {
      const point = createCollectionPointFromNode(node, points.length);
      if (point) {
        points.push(point);
        usedNodeIds.add(node.id);
      }
    }
  }

  // Priority 2: Extract points from highway ways
  if (includeHighwayEndpoints) {
    for (const way of osmData.ways) {
      if (maxPoints > 0 && points.length >= maxPoints) break;

      // Only process highways (roads)
      if (!way.tags?.highway) continue;

      // Skip footways, cycleways, etc. for trash collection
      const skipTypes = ["footway", "cycleway", "path", "steps", "pedestrian"];
      if (skipTypes.includes(way.tags.highway)) continue;

      // Sample nodes along the way
      for (let i = 0; i < way.nodeRefs.length; i += highwaySampleRate) {
        if (maxPoints > 0 && points.length >= maxPoints) break;

        const nodeId = way.nodeRefs[i];
        if (usedNodeIds.has(nodeId)) continue;

        const node = nodeMap.get(nodeId);
        if (!node) continue;

        const point = createCollectionPointFromWayNode(
          node,
          way,
          points.length,
        );
        if (point) {
          points.push(point);
          usedNodeIds.add(nodeId);
        }
      }
    }
  }

  // Priority 3: If still not enough points, sample from all nodes
  if (points.length < 10 && osmData.nodes.length > 0) {
    const sampleRate = Math.max(1, Math.floor(osmData.nodes.length / 50));
    for (let i = 0; i < osmData.nodes.length; i += sampleRate) {
      if (maxPoints > 0 && points.length >= maxPoints) break;

      const node = osmData.nodes[i];
      if (usedNodeIds.has(node.id)) continue;

      const point: CollectionPoint = {
        id: node.id,
        address: `Point ${points.length + 1}`,
        locationName: "Imported Location",
        latitude: node.lat,
        longitude: node.lon,
        collectionType: "residential",
        status: "pending",
        scheduledTime: generateScheduledTime(points.length),
      };

      points.push(point);
      usedNodeIds.add(node.id);
    }
  }

  return points;
}

function createCollectionPointFromNode(
  node: OSMNode,
  index: number,
): CollectionPoint | null {
  const tags = node.tags || {};

  let address = tags.name || "";
  if (!address && tags["addr:street"]) {
    address = `${tags["addr:housenumber"] || ""} ${tags["addr:street"]}`.trim();
  }
  if (!address) {
    address = `Point ${index + 1}`;
  }

  let locationName =
    tags["addr:city"] ||
    tags["addr:suburb"] ||
    tags["addr:neighbourhood"] ||
    "";
  if (!locationName && tags.amenity) {
    locationName = tags.amenity.replace(/_/g, " ");
  }
  if (!locationName && tags.shop) {
    locationName = tags.shop.replace(/_/g, " ");
  }

  const collectionType = determineCollectionType(tags);

  return {
    id: node.id,
    address,
    locationName: locationName || "Imported Area",
    latitude: node.lat,
    longitude: node.lon,
    collectionType,
    status: "pending",
    scheduledTime: generateScheduledTime(index),
    notes: tags.description || tags.note || undefined,
  };
}

function createCollectionPointFromWayNode(
  node: OSMNode,
  way: OSMWay,
  index: number,
): CollectionPoint | null {
  const wayTags = way.tags || {};
  const roadName = wayTags.name || wayTags.ref || "";
  const roadType = wayTags.highway || "road";

  const address = roadName
    ? `${roadName} (${roadType})`
    : `${roadType.charAt(0).toUpperCase() + roadType.slice(1)} Point ${index + 1}`;

  return {
    id: node.id,
    address,
    locationName: wayTags.ref || "Route Segment",
    latitude: node.lat,
    longitude: node.lon,
    collectionType: "residential",
    status: "pending",
    scheduledTime: generateScheduledTime(index),
  };
}

function determineCollectionType(tags: Record<string, string>): CollectionType {
  if (tags.amenity === "recycling" || tags.recycling) return "recycling";
  if (tags.amenity === "waste_disposal" || tags.waste) return "bulk";
  if (
    tags.shop ||
    tags.office ||
    tags.amenity === "restaurant" ||
    tags.amenity === "cafe" ||
    tags.amenity === "bank"
  ) {
    return "commercial";
  }
  if (tags.building === "industrial" || tags.landuse === "industrial") {
    return "commercial";
  }
  return "residential";
}

function generateScheduledTime(index: number): string {
  const baseHour = 8;
  const minutesOffset = (index * 15) % (8 * 60); // Spread across 8 hours
  const hours = baseHour + Math.floor(minutesOffset / 60);
  const minutes = minutesOffset % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHour.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")} ${period}`;
}

// Validate OSM data
export function validateOSMData(data: OSMData): string[] {
  const errors: string[] = [];

  if (data.nodes.length === 0) {
    errors.push("No nodes found in OSM data");
  }

  // Check for valid coordinates (sample first 100)
  let invalidCount = 0;
  for (const node of data.nodes.slice(0, 100)) {
    if (node.lat < -90 || node.lat > 90) {
      invalidCount++;
    }
    if (node.lon < -180 || node.lon > 180) {
      invalidCount++;
    }
  }

  if (invalidCount > 0) {
    errors.push(`Found ${invalidCount} nodes with invalid coordinates`);
  }

  return errors;
}

// Main import function
export async function importOSMFile(
  content: string,
  onProgress?: (progress: ImportProgress) => void,
  options?: ImportOptions,
): Promise<ImportResult> {
  const errors: string[] = [];

  try {
    // Stage 1: Parsing
    onProgress?.({
      stage: "parsing",
      progress: 10,
      message: "Parsing OSM data...",
    });

    const osmData = parseOSMXML(content);

    onProgress?.({
      stage: "parsing",
      progress: 30,
      message: `Found ${osmData.nodes.length} nodes and ${osmData.ways.length} ways`,
    });

    // Stage 2: Validating
    onProgress?.({
      stage: "validating",
      progress: 40,
      message: "Validating data...",
    });

    const validationErrors = validateOSMData(osmData);
    errors.push(...validationErrors);

    if (osmData.nodes.length === 0) {
      return {
        success: false,
        collectionPoints: [],
        statistics: {
          totalNodes: 0,
          totalWays: 0,
          extractedPoints: 0,
          bounds: undefined,
        },
        errors: [
          "No valid nodes found in file. Please check the OSM file format.",
        ],
      };
    }

    // Stage 3: Extracting
    onProgress?.({
      stage: "extracting",
      progress: 60,
      message: "Extracting collection points...",
    });

    const collectionPoints = extractCollectionPoints(osmData, options);

    onProgress?.({
      stage: "extracting",
      progress: 80,
      message: `Extracted ${collectionPoints.length} collection points`,
    });

    // Calculate bounds if not provided
    let finalBounds = osmData.bounds;
    if (!finalBounds && collectionPoints.length > 0) {
      const lats = collectionPoints.map((p) => p.latitude);
      const lons = collectionPoints.map((p) => p.longitude);
      finalBounds = {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons),
      };
    }

    // Stage 4: Complete
    onProgress?.({
      stage: "complete",
      progress: 100,
      message: `Successfully imported ${collectionPoints.length} collection points from ${osmData.nodes.length} nodes`,
    });

    return {
      success: true,
      collectionPoints,
      statistics: {
        totalNodes: osmData.nodes.length,
        totalWays: osmData.ways.length,
        extractedPoints: collectionPoints.length,
        bounds: finalBounds,
      },
      errors,
    };
  } catch (error) {
    onProgress?.({
      stage: "error",
      progress: 0,
      message: "Import failed",
    });

    return {
      success: false,
      collectionPoints: [],
      statistics: {
        totalNodes: 0,
        totalWays: 0,
        extractedPoints: 0,
        bounds: undefined,
      },
      errors: [
        error instanceof Error ? error.message : "Unknown error occurred",
      ],
    };
  }
}
