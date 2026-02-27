/**
 * Overpass API Service for OSM Data Extraction
 * Fetches roads, buildings, amenities, natural features, etc.
 * Uses multiple public Overpass API endpoints with fallback on failure.
 */

/** Public Overpass API endpoints (try in order until one succeeds). */
export const OVERPASS_API_ENDPOINTS: readonly string[] = [
  "https://overpass-api.de/api/interpreter",       // Main (DE)
  "https://overpass.kumi.systems/api/interpreter", // Kumi Systems
  "https://overpass.openstreetmap.fr/api/interpreter", // French
  "https://overpass.osm.rambler.ru/cgi/interpreter",   // Russian
];

/** Current index for round-robin (optional load spreading). */
let overpassEndpointIndex = 0;

/**
 * Get the next Overpass API base URL (round-robin).
 */
export function getNextOverpassEndpoint(): string {
  const url = OVERPASS_API_ENDPOINTS[overpassEndpointIndex];
  overpassEndpointIndex =
    (overpassEndpointIndex + 1) % OVERPASS_API_ENDPOINTS.length;
  return url;
}

export type OSMCategoryKey =
  | "roads"
  | "buildings"
  | "amenities"
  | "natural"
  | "waterways"
  | "landuse";

export interface OSMCategory {
  label: string;
  query: string;
}

/** Per-category Overpass sub-queries. Use POLY placeholder — replaced with (poly:"lat1 lon1 ..."). */
export const OSM_CATEGORIES: Record<OSMCategoryKey, OSMCategory> = {
  roads: {
    label: "Roads",
    query: 'way["highway"]POLY;',
  },
  buildings: {
    label: "Buildings",
    query: 'way["building"]POLY;',
  },
  amenities: {
    label: "POIs & Amenities",
    query: 'node["amenity"]POLY; way["amenity"]POLY;',
  },
  natural: {
    label: "Natural Features",
    query: 'way["natural"]POLY; node["natural"]POLY;',
  },
  waterways: {
    label: "Waterways",
    query: 'way["waterway"]POLY;',
  },
  landuse: {
    label: "Land Use",
    query: 'way["landuse"]POLY;',
  },
};

export interface LatLonPoint {
  latitude: number;
  longitude: number;
}

/**
 * Convert polygon points to Overpass poly format (lat1 lon1 lat2 lon2 ...).
 * Overpass closes the polygon automatically; do not repeat the first point.
 */
export function pointsToPolyString(points: LatLonPoint[]): string {
  return points
    .map((p) => `${p.latitude.toFixed(6)} ${p.longitude.toFixed(6)}`)
    .join(" ");
}

/**
 * Build a single valid Overpass QL query: one union of all selected types, one out.
 * Poly filter must be (poly:"lat1 lon1 lat2 lon2 ...") per Overpass docs.
 */
export function buildQuery(
  points: LatLonPoint[],
  categories: OSMCategoryKey[]
): string {
  if (points.length < 3) {
    throw new Error("At least 3 points required for the polygon.");
  }

  const polyString = pointsToPolyString(points);
  const polyFilter = `(poly:"${polyString}")`;

  const unionParts = categories
    .map((cat) => {
      const category = OSM_CATEGORIES[cat];
      if (!category) return "";
      return category.query.replace(/POLY/g, polyFilter);
    })
    .filter(Boolean);

  if (unionParts.length === 0) {
    throw new Error("Select at least one category.");
  }

  const unionBody = unionParts.join(" ");
  return `[out:json][timeout:25];\n(\n  ${unionBody}\n);\nout body;\n>;\nout skel qt;`;
}

export interface GeoJSONFeature {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point" | "LineString" | "Polygon";
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, string | number | undefined>;
}

export interface OverpassCounts {
  roads: number;
  buildings: number;
  amenities: number;
  natural: number;
  waterways: number;
  landuse: number;
}

/** Raw element from Overpass API (for OSM XML export). */
export interface OverpassElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface ParsedOverpassResult {
  features: GeoJSONFeature[];
  counts: OverpassCounts;
  /** Raw Overpass elements for valid OSM 0.6 XML export. */
  rawElements: OverpassElement[];
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Parse Overpass API response into GeoJSON features
 */
function parseOverpassResponse(data: OverpassResponse): ParsedOverpassResult {
  const elements = data.elements ?? [];
  const nodes: Record<number, [number, number]> = {};
  const features: GeoJSONFeature[] = [];
  const counts: OverpassCounts = {
    roads: 0,
    buildings: 0,
    amenities: 0,
    natural: 0,
    waterways: 0,
    landuse: 0,
  };

  elements.forEach((el) => {
    if (el.type === "node" && el.lat != null && el.lon != null) {
      nodes[el.id] = [el.lon, el.lat];
    }
  });

  elements.forEach((el) => {
    if (el.type === "node" && el.tags && el.lat != null && el.lon != null) {
      features.push({
        type: "Feature",
        id: `node/${el.id}`,
        geometry: {
          type: "Point",
          coordinates: [el.lon, el.lat],
        },
        properties: el.tags ?? {},
      });
      if (el.tags.amenity) counts.amenities++;
      if (el.tags.natural) counts.natural++;
    } else if (el.type === "way" && el.nodes) {
      const coords = el.nodes.map((nid) => nodes[nid]).filter(Boolean) as [
        number,
        number
      ][];
      if (coords.length < 2) return;

      const isClosed =
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1];

      features.push({
        type: "Feature",
        id: `way/${el.id}`,
        geometry: {
          type: isClosed ? "Polygon" : "LineString",
          coordinates: isClosed ? [coords] : coords,
        },
        properties: el.tags ?? {},
      });

      if (el.tags?.highway) counts.roads++;
      if (el.tags?.building) counts.buildings++;
      if (el.tags?.amenity) counts.amenities++;
      if (el.tags?.natural) counts.natural++;
      if (el.tags?.waterway) counts.waterways++;
      if (el.tags?.landuse) counts.landuse++;
    }
  });

  return { features, counts, rawElements: elements };
}

interface OverpassErrorResponse {
  error?: string;
  remark?: string;
}

const OVERPASS_USER_AGENT =
  "Mozilla/5.0 (compatible; RouteMasterPro/1.0; OSM Extractor)";

const HEADERS = {
  "User-Agent": OVERPASS_USER_AGENT,
  "Content-Type": "application/x-www-form-urlencoded",
};

/** Max query length for GET fallback (URL length limit). */
const MAX_GET_QUERY_LENGTH = 1800;

function parseOverpassResponseText(
  text: string,
  response: { ok: boolean; status: number }
): OverpassResponse {
  let data: OverpassResponse | OverpassErrorResponse;
  try {
    data = JSON.parse(text) as OverpassResponse | OverpassErrorResponse;
  } catch {
    const hint = text.trimStart().startsWith("<")
      ? "Server returned HTML (check query syntax)."
      : text.slice(0, 200);
    throw new Error(
      response.ok
        ? "Invalid response from Overpass API."
        : `Overpass API error: ${response.status}. ${hint}`
    );
  }

  if (!response.ok) {
    const err = data as OverpassErrorResponse;
    const msg =
      err.error ?? err.remark ?? text.slice(0, 200) ?? `HTTP ${response.status}`;
    throw new Error(`Overpass API: ${msg}`);
  }

  const err = data as OverpassErrorResponse;
  if (err.error) {
    throw new Error(`Overpass API: ${err.error}`);
  }
  if (
    err.remark &&
    (err.remark.includes("error") || err.remark.includes("timeout"))
  ) {
    throw new Error(`Overpass API: ${err.remark}`);
  }

  return data as OverpassResponse;
}

/**
 * Try a single Overpass API endpoint (POST, then GET if POST fails with 4xx).
 */
async function fetchFromEndpoint(
  endpoint: string,
  query: string
): Promise<OverpassResponse> {
  const encoded = encodeURIComponent(query);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: `data=${encoded}`,
      headers: HEADERS,
    });
  } catch (networkErr) {
    throw new Error(
      `Network error: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`
    );
  }

  const text = await response.text();

  if (
    !response.ok &&
    response.status >= 400 &&
    response.status < 500 &&
    encoded.length <= MAX_GET_QUERY_LENGTH
  ) {
    try {
      const getUrl = `${endpoint}?data=${encoded}`;
      const getResponse = await fetch(getUrl, {
        method: "GET",
        headers: { "User-Agent": OVERPASS_USER_AGENT },
      });
      const getText = await getResponse.text();
      if (getResponse.ok) {
        return parseOverpassResponseText(getText, getResponse);
      }
    } catch {
      /* ignore GET fallback failure, use POST result below */
    }
  }

  return parseOverpassResponseText(text, response);
}

/**
 * Fetch OSM data from Overpass API.
 * Tries each endpoint in OVERPASS_API_ENDPOINTS until one succeeds.
 */
export async function fetchOSMData(
  points: LatLonPoint[],
  categories: OSMCategoryKey[]
): Promise<ParsedOverpassResult> {
  const query = buildQuery(points, categories);

  const startIndex = overpassEndpointIndex;
  let lastError: Error | null = null;

  for (let i = 0; i < OVERPASS_API_ENDPOINTS.length; i++) {
    const idx = (startIndex + i) % OVERPASS_API_ENDPOINTS.length;
    const endpoint = OVERPASS_API_ENDPOINTS[idx];

    try {
      const data = await fetchFromEndpoint(endpoint, query);
      overpassEndpointIndex = (idx + 1) % OVERPASS_API_ENDPOINTS.length;
      return parseOverpassResponse(data);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (__DEV__) {
        console.warn(
          `[overpassService] Endpoint failed: ${endpoint}`,
          lastError.message
        );
      }
    }
  }

  throw (
    lastError ??
    new Error("All Overpass API endpoints failed. Please try again later.")
  );
}

/**
 * Calculate polygon area in km² (approximate, spherical Earth)
 */
export function calculateArea(points: LatLonPoint[]): number {
  if (points.length < 3) return 0;

  const R = 6371; // Earth radius in km
  let area = 0;

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const lat1 = (points[i].latitude * Math.PI) / 180;
    const lat2 = (points[j].latitude * Math.PI) / 180;
    const dLon = ((points[j].longitude - points[i].longitude) * Math.PI) / 180;
    area += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs((area * R * R) / 2);
}

/**
 * Haversine distance between two points in km.
 */
function haversineKm(a: LatLonPoint, b: LatLonPoint): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Total path distance along consecutive points (not closed) in km.
 * Used for "Measure Distance" (route/waypoints).
 */
export function calculatePathDistance(points: LatLonPoint[]): number {
  if (points.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += haversineKm(points[i], points[i + 1]);
  }
  return sum;
}

/**
 * Distance of each segment between consecutive points, in km.
 * Returns array of length (points.length - 1): [d(0→1), d(1→2), ...].
 */
export function getSegmentDistances(points: LatLonPoint[]): number[] {
  if (points.length < 2) return [];
  const segments: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push(haversineKm(points[i], points[i + 1]));
  }
  return segments;
}
