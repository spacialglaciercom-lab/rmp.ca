import type { Node, Way, RoutePoint } from "@/lib/route-optimizer-v2/types";

export type GeoJSONGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] };

export interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONGeometry | null;
  properties?: Record<string, any>;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface GeoJSONConvertOptions {
  /** Keep only vehicular road classes (filters out footway, steps, etc.). Default true. */
  vehicularOnly?: boolean;
  /** Allowlist of classes to include (overrides vehicularOnly). */
  allowClasses?: string[];
  /** Blocklist of classes to exclude. */
  denyClasses?: string[];
  /**
   * Snap LineString endpoints that are within this distance (metres) of each other
   * to a single shared coordinate. Fixes topology gaps in imperfect GeoJSON/OSM
   * exports where two roads that should connect are off by a small rounding error.
   * Only endpoints (first/last coord) are snapped — interior shape points are
   * untouched so road geometry is preserved.
   * Recommended: 1.5 (catches sub-metre rounding noise without merging separate roads).
   * Default: 0 (disabled).
   */
  snapToleranceM?: number;
}

// ─── Endpoint snapping ──────────────────────────────────────────────────────

function haversineMetersGeo(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Snap LineString/MultiLineString endpoints that are within `toleranceM` metres
 * of each other to a single shared coordinate. Only the first and last coordinate
 * of each ring are candidates — interior shape points are left unchanged so road
 * geometry is preserved.
 *
 * Uses a grid-based spatial index for O(n) performance. Each grid cell is
 * 2× the tolerance wide so that any pair within tolerance is guaranteed to be
 * in the same or a directly adjacent cell.
 */
export function snapGeoJSONEndpoints(
  features: GeoJSONFeature[],
  toleranceM: number,
): GeoJSONFeature[] {
  if (toleranceM <= 0) return features;

  // 1 degree of latitude ≈ 111 000 m; longitude varies but we use the same
  // approximation (conservative — slightly over-snaps at equator, fine).
  const cellDeg = (toleranceM * 2) / 111_000;

  type EP = [number, number]; // [lat, lon]
  const grid = new Map<string, EP>(); // one representative per cell
  // coordKey → canonical [lat, lon]
  const canonical = new Map<string, EP>();

  function cellKey(lat: number, lon: number): string {
    return `${Math.floor(lat / cellDeg)},${Math.floor(lon / cellDeg)}`;
  }
  function epKey(lat: number, lon: number): string {
    // 7 decimal places ≈ 1 cm precision, same as geojsonToOsmData
    return `${lat.toFixed(7)},${lon.toFixed(7)}`;
  }

  function register(rawLon: number, rawLat: number): void {
    const k = epKey(rawLat, rawLon);
    if (canonical.has(k)) return; // already processed

    // Search the 3×3 neighbourhood of cells for an existing representative
    const ci = Math.floor(rawLat / cellDeg);
    const cj = Math.floor(rawLon / cellDeg);
    let found: EP | null = null;
    outer: for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const rep = grid.get(`${ci + di},${cj + dj}`);
        if (
          rep &&
          haversineMetersGeo(rawLat, rawLon, rep[0], rep[1]) <= toleranceM
        ) {
          found = rep;
          break outer;
        }
      }
    }

    if (found) {
      canonical.set(k, found);
    } else {
      const ep: EP = [rawLat, rawLon];
      canonical.set(k, ep);
      grid.set(cellKey(rawLat, rawLon), ep);
    }
  }

  function snap(c: number[]): number[] {
    const rawLon = Number(c[0]);
    const rawLat = Number(c[1]);
    const rep = canonical.get(epKey(rawLat, rawLon));
    if (!rep || (rep[0] === rawLat && rep[1] === rawLon)) return c;
    return c.length > 2 ? [rep[1], rep[0], ...c.slice(2)] : [rep[1], rep[0]];
  }

  // Pass 1: register all endpoints so every coordinate knows its canonical home
  for (const f of features) {
    if (!f?.geometry) continue;
    if (f.geometry.type === "LineString") {
      const cs = f.geometry.coordinates;
      if (cs.length >= 2) {
        register(Number(cs[0]![0]), Number(cs[0]![1]));
        register(Number(cs[cs.length - 1]![0]), Number(cs[cs.length - 1]![1]));
      }
    } else if (f.geometry.type === "MultiLineString") {
      for (const line of f.geometry.coordinates) {
        if (line.length >= 2) {
          register(Number(line[0]![0]), Number(line[0]![1]));
          register(
            Number(line[line.length - 1]![0]),
            Number(line[line.length - 1]![1]),
          );
        }
      }
    }
  }

  // Pass 2: rewrite only the endpoint coordinates that moved
  return features.map((f) => {
    if (!f?.geometry) return f;
    if (f.geometry.type === "LineString") {
      const cs = f.geometry.coordinates;
      if (cs.length < 2) return f;
      const s0 = snap(cs[0]!);
      const sN = snap(cs[cs.length - 1]!);
      if (s0 === cs[0] && sN === cs[cs.length - 1]) return f; // nothing changed
      const next = [...cs];
      next[0] = s0;
      next[cs.length - 1] = sN;
      return { ...f, geometry: { ...f.geometry, coordinates: next } };
    } else if (f.geometry.type === "MultiLineString") {
      let changed = false;
      const nextLines = f.geometry.coordinates.map((line) => {
        if (line.length < 2) return line;
        const s0 = snap(line[0]!);
        const sN = snap(line[line.length - 1]!);
        if (s0 === line[0] && sN === line[line.length - 1]) return line;
        changed = true;
        const nl = [...line];
        nl[0] = s0;
        nl[line.length - 1] = sN;
        return nl;
      });
      if (!changed) return f;
      return { ...f, geometry: { ...f.geometry, coordinates: nextLines } };
    }
    return f;
  });
}

// ─── Main converter ──────────────────────────────────────────────────────────

/** Convert GeoJSON roads (LineString/MultiLineString) to optimizer Nodes/Ways. */
export function geojsonToOsmData(
  fc: GeoJSONFeatureCollection,
  opts: GeoJSONConvertOptions = {},
): {
  nodes: Map<string, Node>;
  ways: Way[];
} {
  const defaultVehicular = new Set([
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "residential",
    "service",
    "unclassified",
    "living_street",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
  ]);
  const nonVehicular = new Set([
    "footway",
    "pedestrian",
    "steps",
    "path",
    "corridor",
    "cycleway",
    "bridleway",
    "elevator",
    "escalator",
    "platform",
    "raceway",
  ]);

  function isAllowedClass(c?: string): boolean {
    if (!c) return opts.vehicularOnly ? true : true; // unknown: allow, RouteOptimizer filters again
    const cls = String(c).toLowerCase();
    if (opts.allowClasses && opts.allowClasses.length)
      return opts.allowClasses.map((s) => s.toLowerCase()).includes(cls);
    if (opts.denyClasses && opts.denyClasses.length)
      if (opts.denyClasses.map((s) => s.toLowerCase()).includes(cls))
        return false;
    if (opts.vehicularOnly !== false) {
      if (nonVehicular.has(cls)) return false;
      // If a known vehicular set is used, allow it; otherwise defer
      if (defaultVehicular.has(cls)) return true;
    }
    return true;
  }
  const snapM = opts.snapToleranceM ?? 0;
  const features =
    snapM > 0
      ? snapGeoJSONEndpoints(fc.features ?? [], snapM)
      : (fc.features ?? []);

  const nodes = new Map<string, Node>();
  const coordToNodeId = new Map<string, string>();
  let nextNodeId = 1;
  let nextWayId = 1;
  const ways: Way[] = [];

  const fmt = (x: number) => Number(x.toFixed(7));
  const key = (lat: number, lon: number) => `${fmt(lat)},${fmt(lon)}`;

  function ensureNode(lat: number, lon: number, z?: number): string {
    const k = key(lat, lon);
    const existing = coordToNodeId.get(k);
    if (existing) {
      const n = nodes.get(existing);
      if (n && z !== undefined && n.z === undefined) n.z = z;
      return existing;
    }
    const id = String(nextNodeId++);
    const n: Node = { id, lat: fmt(lat), lon: fmt(lon) };
    if (z !== undefined) n.z = z;
    nodes.set(id, n);
    coordToNodeId.set(k, id);
    return id;
  }

  function pushWay(coords: number[][], props?: Record<string, any>) {
    if (!coords || coords.length < 2) return;
    // Filter by class when requested
    const roadClass =
      props?.highway ?? props?.class ?? props?.road_class ?? props?.category;
    if (!isAllowedClass(roadClass)) return;
    const nodeIds: string[] = [];
    for (const c of coords) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      const z = c.length >= 3 && typeof c[2] === "number" ? c[2] : undefined;
      nodeIds.push(ensureNode(lat, lon, z));
    }
    if (nodeIds.length < 2) return;
    // Always use a unique auto-generated ID to ensure each Way has a distinct wayId.
    // This prevents false mid-block classification in routeOptimizerSimple when
    // multiple sub-segments of a MultiLineString share a node.
    const id = `g${nextWayId++}`;

    // Infer tags from GeoJSON properties (common keys from OSM/Overture)
    const tags: Record<string, string> = {};
    const highway =
      props?.highway ??
      props?.class ??
      props?.road_class ??
      props?.category ??
      "residential";
    tags.highway = String(highway);
    if (props?.name) tags.name = String(props.name);
    if (props?.direction) tags.direction = String(props.direction); // forward|backward|both
    if (props?.oneway === true || props?.oneway === "yes") tags.oneway = "yes";
    if (props?.oneway === -1 || props?.direction === "backward")
      tags.oneway = "-1";
    // OSM: dual_carriageway=yes  |  Overture: is_dual_carriageway=true
    if (props?.dual_carriageway === "yes" || props?.is_dual_carriageway === true)
      tags.dual_carriageway = "yes";

    ways.push({ id, nodes: nodeIds, tags });
  }

  for (const f of features) {
    if (!f || f.type !== "Feature" || !f.geometry) continue;
    if (f.geometry.type === "LineString") {
      pushWay(f.geometry.coordinates, f.properties);
    } else if (f.geometry.type === "MultiLineString") {
      for (const line of f.geometry.coordinates) pushWay(line, f.properties);
    }
  }

  return { nodes, ways };
}

/**
 * Convert OSM nodes + ways to a GeoJSON FeatureCollection of LineStrings for the backend optimizer.
 * Used so the planner can call the same POST /api/optimize as the map page.
 */
export function osmDataToGeoJSON(
  nodes: Map<string, Node>,
  ways: Way[],
): GeoJSONFeatureCollection {
  const features: GeoJSONFeature[] = [];
  for (const way of ways) {
    const coords: number[][] = [];
    for (const id of way.nodes) {
      const n = nodes.get(id);
      if (!n) continue;
      coords.push([n.lon, n.lat]);
    }
    if (coords.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { ...way.tags, id: way.id },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Convert RoutePoints to a GeoJSON FeatureCollection for inspection. */
export function routePointsToGeoJSON(
  points: RoutePoint[],
): GeoJSONFeatureCollection {
  const coords = points.map((p) => [p.longitude, p.latitude]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { kind: "route" },
      },
    ],
  };
}
