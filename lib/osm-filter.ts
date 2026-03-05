/**
 * OSM Road Filtering
 * Implements strict filtering rules for trash collection routes
 */

export interface OSMWay {
  id: string;
  nodes: string[];
  tags: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  name?: string;
  highway?: string;
}

export interface OSMNode {
  id: string;
  lat: number;
  lon: number;
}

/**
 * Check if a way should be INCLUDED based on highway type
 */
export function shouldIncludeHighway(way: OSMWay): boolean {
  const highway = way.tags.highway;
  if (!highway) return false;

  // Include these types
  const includedTypes = [
    "residential",
    "unclassified",
    "tertiary",
    "secondary",
    "living_street",
    "secondary_link",
    "tertiary_link",
  ];

  if (includedTypes.includes(highway)) {
    return true;
  }

  // Service roads ONLY if service=alley
  if (highway === "service") {
    return way.tags.service === "alley";
  }

  return false;
}

/**
 * Check if a way should be EXCLUDED
 */
export function shouldExcludeWay(way: OSMWay): boolean {
  const highway = way.tags.highway;
  const service = way.tags.service;
  const access = way.tags.access;
  const area = way.tags.area;

  // Exclude specific highway types
  const excludedHighways = [
    "footway",
    "cycleway",
    "steps",
    "path",
    "track",
    "bridleway",
    "pedestrian",
    "corridor",
    "elevator",
    "platform",
  ];

  if (highway && excludedHighways.includes(highway)) {
    return true;
  }

  // Exclude specific service types
  const excludedServices = [
    "parking_aisle",
    "driveway",
    "parking",
    "drive-through",
    "emergency_access",
  ];

  if (service && excludedServices.includes(service)) {
    return true;
  }

  // Exclude if area=yes or area=parking
  if (area === "yes" || area === "parking") {
    return true;
  }

  // Exclude if access=private
  if (access === "private") {
    return true;
  }

  return false;
}

/**
 * Filter OSM ways based on collection route requirements
 */
export function filterOSMWays(ways: OSMWay[]): OSMWay[] {
  return ways.filter(way => {
    // First check if it should be excluded
    if (shouldExcludeWay(way)) {
      return false;
    }

    // Then check if it should be included
    return shouldIncludeHighway(way);
  });
}

/**
 * Check if a way is one-way
 */
export function isOneWay(way: OSMWay): boolean {
  const oneway = way.tags.oneway;
  return oneway === "yes" || oneway === "1" || oneway === "true";
}

/**
 * Get street name from way tags
 */
export function getStreetName(way: OSMWay): string | undefined {
  return way.tags.name || 
         way.tags["addr:street"] || 
         way.tags["name:en"] ||
         undefined;
}
