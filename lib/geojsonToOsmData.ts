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
}

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
    const id = props?.id ? String(props.id) : `g${nextWayId++}`;

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

  for (const f of fc.features ?? []) {
    if (!f || f.type !== "Feature" || !f.geometry) continue;
    if (f.geometry.type === "LineString") {
      pushWay(f.geometry.coordinates, f.properties);
    } else if (f.geometry.type === "MultiLineString") {
      f.geometry.coordinates.forEach((line, i) => {
        const subProps =
          f.properties && f.properties.id != null
            ? { ...f.properties, id: `${f.properties.id}_${i}` }
            : f.properties;
        pushWay(line, subProps);
      });
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
