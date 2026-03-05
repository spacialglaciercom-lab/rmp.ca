/**
 * Converts raw Overpass API elements into the optimizer's Node/Way format.
 * The Overpass extractor returns OverpassElement[] (numeric IDs, nodes on ways as number[]).
 * The optimizer expects Map<string, Node> and Way[] with string IDs.
 *
 * Highway filtering matches lib/route-optimizer-v2/osmParser.ts exactly.
 */

import type { OverpassElement } from "@/lib/overpassService";
import type { Node, Way } from "@/lib/route-optimizer-v2/types";

/** Same as osmParser.ts — highway types suitable for trash collection routes. */
const INCLUDED_HIGHWAYS = new Set([
  "residential",
  "unclassified",
  "tertiary",
  "secondary",
  "living_street",
  "secondary_link",
  "tertiary_link",
]);

const EXCLUDED_HIGHWAYS = new Set([
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
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
]);

const EXCLUDED_SERVICES = new Set([
  "parking_aisle",
  "driveway",
  "parking",
  "drive-through",
  "emergency_access",
]);

function isAllowedWay(tags: Record<string, string>): boolean {
  const highway = tags.highway;
  if (!highway || EXCLUDED_HIGHWAYS.has(highway)) return false;

  if (INCLUDED_HIGHWAYS.has(highway)) {
    // ok
  } else if (highway === "service" && tags.service === "alley") {
    // service=alley only
  } else {
    return false;
  }

  // Exclude specific service subtypes
  const service = tags.service;
  if (service && EXCLUDED_SERVICES.has(service)) return false;

  // Exclude area-tagged ways (parking lots etc.)
  if (tags.area === "yes" || tags.area === "parking") return false;

  return true;
}

export function overpassToOsmData(rawElements: OverpassElement[]): {
  nodes: Map<string, Node>;
  ways: Way[];
} {
  const nodes = new Map<string, Node>();
  const ways: Way[] = [];

  for (const el of rawElements) {
    if (el.type === "node" && el.lat != null && el.lon != null) {
      const id = el.id.toString();
      nodes.set(id, { id, lat: el.lat, lon: el.lon });
    } else if (el.type === "way" && el.nodes && el.tags) {
      if (!isAllowedWay(el.tags)) continue;
      ways.push({
        id: el.id.toString(),
        nodes: el.nodes.map((n) => n.toString()),
        tags: el.tags,
      });
    }
  }

  return { nodes, ways };
}
