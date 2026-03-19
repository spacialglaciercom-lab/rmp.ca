/**
 * OSM Extraction Service — wraps the Overpass API to accept a GeoJSON polygon
 * and return an ExtractResult with only locally-routable road features.
 *
 * Tag filtering is applied HERE (not in the shared overpassService) so the
 * general Overpass service remains unaffected.
 *
 * INCLUDE — routable by standard delivery/service vehicles:
 *   residential      Local neighbourhood streets
 *   tertiary         Minor through-roads connecting settlements
 *   tertiary_link    On/off ramp to a tertiary road
 *   secondary        Regional connector roads
 *   secondary_link   On/off ramp to a secondary road
 *   unclassified     Rural/local roads not otherwise classified (rural connectors)
 *   living_street    Shared-space streets (vehicles yield to pedestrians, low speed)
 *   road             Temporary tag for roads whose classification is unknown
 *
 * EXCLUDE — non-routable or irrelevant for local vehicle routing:
 *   motorway / motorway_link   Controlled-access freeways and their ramps
 *   trunk    / trunk_link      Major arterial roads and their ramps
 *   primary  / primary_link    Primary intercity roads and their ramps
 *   service                    Service roads, driveways, parking aisles, alleys
 *   track                      Agricultural/forestry tracks (often unpaved)
 *   path                       Generic multi-use non-vehicular path
 *   footway                    Pedestrian-only footpaths
 *   pedestrian                 Pedestrian zones / shared squares
 *   cycleway                   Bicycle-only paths
 *   bridleway                  Equestrian paths
 *   steps                      Stairways
 *   corridor                   Indoor corridors
 *   elevator                   Vertical transport
 *   escape                     Emergency runaway escape ramps
 *   emergency_bay              Emergency stopping bays
 *   rest_area / services       Motorway rest stops (no through routing)
 *   raceway                    Racing circuits
 *   busway / bus_guideway      Bus-only guided infrastructure
 *   proposed / construction    Incomplete or planned roads
 */

import type { ExtractResult } from "../types";
import {
  OVERPASS_API_ENDPOINTS,
  pointsToPolyString,
  type LatLonPoint,
} from "@/lib/overpassService";

/** ExtractResult extended with raw Overpass elements for OSM XML export. */
export interface OSMExtractResult extends ExtractResult {
  rawElements: OverpassElement[];
}

// ---------------------------------------------------------------------------
// Routable highway tag allowlist
// ---------------------------------------------------------------------------

export const ROUTABLE_HIGHWAY_TAGS = [
  "residential",
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "unclassified",
  "living_street",
  "road",
] as const;

const ROUTABLE_HIGHWAY_REGEX = `^(${ROUTABLE_HIGHWAY_TAGS.join("|")})$`;

// ---------------------------------------------------------------------------
// Polygon helpers
// ---------------------------------------------------------------------------

/**
 * Convert a GeoJSON Polygon feature into LatLonPoint[] for Overpass.
 * GeoJSON coordinates are [lon, lat]; Overpass wants { latitude, longitude }.
 * Drops the closing duplicate point that GeoJSON requires.
 */
function polygonToLatLonPoints(
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
): LatLonPoint[] {
  const ring = polygon.geometry.coordinates[0];
  if (!ring || ring.length < 4) {
    throw new Error("Polygon must have at least 3 vertices.");
  }
  const open = ring.slice(0, -1);
  return open.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
}

// ---------------------------------------------------------------------------
// Filtered Overpass query builder
// ---------------------------------------------------------------------------

function buildRoutableRoadsQuery(points: LatLonPoint[]): string {
  const polyString = pointsToPolyString(points);
  const polyFilter = `(poly:"${polyString}")`;
  return (
    `[out:json][timeout:25];\n` +
    `(\n` +
    `  way["highway"~"${ROUTABLE_HIGHWAY_REGEX}"]${polyFilter};\n` +
    `);\n` +
    `out body;\n` +
    `>;\n` +
    `out skel qt;`
  );
}

// ---------------------------------------------------------------------------
// Lightweight Overpass fetch (POST with GET fallback, round-robin endpoints)
// ---------------------------------------------------------------------------

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
type OverpassElement = OverpassNode | OverpassWay;

async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  const encoded = encodeURIComponent(query);
  let lastErr: Error | null = null;

  for (let i = 0; i < OVERPASS_API_ENDPOINTS.length; i++) {
    const endpoint = OVERPASS_API_ENDPOINTS[i];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: `data=${encoded}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; RouteMasterPro/1.0; OSM Extractor)",
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const data = JSON.parse(text) as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("All Overpass API endpoints failed.");
}

// ---------------------------------------------------------------------------
// GeoJSON conversion
// ---------------------------------------------------------------------------

function elementsToGeoJSON(
  elements: OverpassElement[],
): { features: GeoJSON.Feature[]; roadCount: number } {
  const nodes = new Map<number, [number, number]>();
  for (const el of elements) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  }

  const features: GeoJSON.Feature[] = [];
  let roadCount = 0;

  for (const el of elements) {
    if (el.type !== "way") continue;
    const coords = el.nodes
      .map((nid) => nodes.get(nid))
      .filter((c): c is [number, number] => c != null);
    if (coords.length < 2) continue;

    features.push({
      type: "Feature",
      id: `way/${el.id}`,
      geometry: { type: "LineString", coordinates: coords },
      properties: el.tags ?? {},
    });
    roadCount++;
  }

  return { features, roadCount };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract locally-routable roads (see allowlist above) for the given polygon
 * via the Overpass API. Returns an ExtractResult compatible with the plugin system.
 */
export async function extractOSM(
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
): Promise<OSMExtractResult> {
  const points = polygonToLatLonPoints(polygon);
  const query = buildRoutableRoadsQuery(points);
  const elements = await fetchOverpass(query);
  const { features, roadCount } = elementsToGeoJSON(elements);

  const geojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  return {
    geojson,
    rawElements: elements,
    stats: {
      roads: roadCount,
      points: features.length,
      nodes: elements.filter((e) => e.type === "node").length,
      edges: roadCount,
    },
    warnings:
      roadCount === 0
        ? ["No routable road features returned from Overpass API for this area."]
        : [],
  };
}
