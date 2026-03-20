/**
 * Real-time Traffic Feed Integration
 *
 * Fetches live traffic speed ratios for a bounding box and adjusts StreetEdge
 * speeds before the CPP turn-graph is built. A speed ratio < 1.0 means slower
 * than free-flow (e.g. 0.5 = half speed = doubled travel time). This naturally
 * feeds into totalCost in TurnEdge, making congested streets more expensive for
 * the CPP solver — the warm-start re-weighting path.
 *
 * Integration points (uncomment and configure for production):
 *   - HERE Traffic Flow API  (requires HERE_API_KEY in env)
 *   - Overture Transportation dataset (no key required, S3 download)
 *   - OpenStreetMap-based OSRM with live weights (self-hosted)
 *
 * The module returns an empty Map by default when no traffic source is
 * configured, so the CPP pipeline degrades gracefully to free-flow speeds.
 *
 * Edge keys use the StreetEdge `wayId` field (OSM way ID) to match the same
 * convention as `edgePenaltyMultipliers` in buildTurnExpandedGraph. This allows
 * traffic multipliers to merge directly with any existing ML or weather penalties.
 */

import type { StreetEdge } from "@/types/turnAware";
import { createLogger } from "@/lib/logger";

const log = createLogger("TrafficFeed");

/** [west, south, east, north] in WGS-84 degrees */
export type BBox = [number, number, number, number];

/**
 * Speed ratio per OSM way id.
 *   1.0 = free-flow (no adjustment)
 *   0.5 = half speed (2× travel time penalty)
 *   0.2 = minimum floor (severe congestion — 5× travel time)
 */
export type TrafficMultipliers = Map<string, number>;

const SPEED_FLOOR = 0.2; // never slower than 20 % of free-flow

// ---------------------------------------------------------------------------
// Traffic source adapters — wire one up in production
// ---------------------------------------------------------------------------

/**
 * HERE Traffic Flow API adapter.
 * Requires process.env.HERE_API_KEY to be set.
 * Returns speed ratios keyed by TMC location code, translated to way IDs
 * via an offline mapping table (not included — supply via HERE Map Data).
 *
 * @example
 *   const multipliers = await fetchFromHere(bbox);
 */
async function fetchFromHere(_bbox: BBox): Promise<TrafficMultipliers> {
  // const apiKey = process.env.HERE_API_KEY;
  // if (!apiKey) return new Map();
  // const url =
  //   `https://data.traffic.hereapi.com/v7/flow` +
  //   `?in=bbox:${_bbox[0]},${_bbox[1]},${_bbox[2]},${_bbox[3]}` +
  //   `&locationReferencing=olr&apiKey=${apiKey}`;
  // const res = await fetch(url);
  // const json = await res.json();
  // return parseHereFlowResponse(json);
  return new Map();
}

/**
 * OSRM-based traffic adapter.
 * An OSRM instance with live edge weights (e.g. via osrm-traffic-updater)
 * can expose per-edge speed ratios through a custom endpoint.
 *
 * @example
 *   const multipliers = await fetchFromOsrm(bbox, "https://router.example.com");
 */
async function fetchFromOsrm(
  _bbox: BBox,
  _osrmBase?: string,
): Promise<TrafficMultipliers> {
  // const base = _osrmBase ?? process.env.OSRM_BASE_URL;
  // if (!base) return new Map();
  // const url = `${base}/traffic?bbox=${_bbox.join(",")}`;
  // const res = await fetch(url);
  // const json = await res.json();
  // return parseOsrmTrafficResponse(json);
  return new Map();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch live traffic multipliers for a bounding box.
 *
 * Returns an empty Map when no traffic source is configured — the caller
 * should treat an empty map as "use free-flow speeds" without error.
 *
 * @param bbox  [west, south, east, north]
 */
export async function fetchTrafficMultipliers(
  bbox: BBox,
): Promise<TrafficMultipliers> {
  try {
    // Priority: HERE → OSRM → (empty fallback)
    const hereResult = await fetchFromHere(bbox);
    if (hereResult.size > 0) {
      log.debug(`HERE traffic: ${hereResult.size} way-speed entries`);
      return hereResult;
    }

    const osrmResult = await fetchFromOsrm(bbox);
    if (osrmResult.size > 0) {
      log.debug(`OSRM traffic: ${osrmResult.size} way-speed entries`);
      return osrmResult;
    }

    log.debug("No traffic source configured — using free-flow speeds");
    return new Map();
  } catch (err) {
    log.error(
      "Traffic fetch failed — falling back to free-flow",
      err instanceof Error ? err : new Error(String(err)),
    );
    return new Map();
  }
}

/**
 * Apply traffic speed multipliers to StreetEdges before graph construction.
 *
 * The multipliers map (wayId → ratio) is the same format used by
 * `edgePenaltyMultipliers` in buildTurnExpandedGraph, so both can be merged
 * with a single `Map.set` loop before passing to the turn-graph builder.
 *
 * @param edges        Original StreetEdges from OSM/Overture extraction.
 * @param multipliers  Speed ratios from fetchTrafficMultipliers().
 * @returns            Updated edges with adjusted speeds. Original array is not mutated.
 */
export function applyTrafficToEdges(
  edges: StreetEdge[],
  multipliers: TrafficMultipliers,
): StreetEdge[] {
  if (multipliers.size === 0) return edges;

  return edges.map((edge) => {
    if (!edge.wayId) return edge;
    const ratio = multipliers.get(edge.wayId);
    if (ratio === undefined) return edge;
    const clampedRatio = Math.max(SPEED_FLOOR, Math.min(1.0, ratio));
    return { ...edge, speed: edge.speed * clampedRatio };
  });
}

/**
 * Merge traffic multipliers into an existing edge-penalty map.
 *
 * Traffic slows edges by reducing speed (= increasing baseTime). To feed this
 * into the CPP penalty multiplier map (which adds a fraction on top of baseTime),
 * we convert speed ratios to equivalent time penalties:
 *   penalty = (1 / ratio) - 1   →  e.g. ratio 0.5 → penalty 1.0 (100 % slower)
 *
 * If the wayId already has an ML or weather penalty, we take the max to avoid
 * double-compounding beyond what is physically meaningful.
 *
 * @param existingPenalties  ML/weather edge penalty multipliers (may be undefined).
 * @param trafficMultipliers Speed ratios from fetchTrafficMultipliers().
 * @returns                  Merged penalty map ready for buildTurnExpandedGraph.
 */
export function mergeTrafficPenalties(
  existingPenalties: Map<string, number> | undefined,
  trafficMultipliers: TrafficMultipliers,
): Map<string, number> {
  const merged = new Map<string, number>(existingPenalties);
  for (const [wayId, ratio] of trafficMultipliers) {
    const clampedRatio = Math.max(SPEED_FLOOR, Math.min(1.0, ratio));
    const trafficPenalty = 1 / clampedRatio - 1;
    const existing = merged.get(wayId) ?? 0;
    merged.set(wayId, Math.max(existing, trafficPenalty));
  }
  return merged;
}

/**
 * Compute a bounding box from an array of StreetEdges.
 * Useful for fetching traffic data without a separate bbox calculation.
 */
export function edgesToBBox(edges: StreetEdge[]): BBox {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const edge of edges) {
    for (const [lat, lon] of edge.coordinates) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
    }
  }
  return [west, south, east, north];
}
