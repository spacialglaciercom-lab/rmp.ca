/**
 * Spatial gap detection and repair for route polylines.
 *
 * A "teleporting segment" is a straight-line jump between two consecutive
 * route points that are far apart and not connected by road geometry. These
 * appear as diagonal lines cutting across open areas on the map.
 *
 * Root causes this fixes:
 * 1. OSRM chunk-join mismatch: the `pop()` stitch between chunks can leave
 *    a coordinate gap when the last point of chunk N and first point of chunk
 *    N+1 don't perfectly align.
 * 2. Partial OSRM failures: if a chunk request fails mid-route, the geometry
 *    jumps directly to the next successful chunk's start point.
 * 3. Disconnected graph components: the route optimizer only traverses the
 *    largest connected component; transitions to isolated sub-graphs appear
 *    as straight lines.
 *
 * Strategy:
 * - Scan consecutive point pairs using Haversine distance.
 * - Any pair > GAP_THRESHOLD_M meters apart is flagged as a teleport.
 * - Each flagged gap is repaired by issuing a targeted 2-waypoint OSRM
 *   request so the road-following geometry fills the gap.
 * - If OSRM repair fails for a specific gap, the straight-line is kept
 *   (best effort — no geometry is worse than the original).
 */

import { haversineDistance } from "./offlineTurnDetection";
import type { RoutingConfig } from "./routing-config";
import { routeThroughWaypoints } from "./mapMatching";
import type { RouteOptions } from "./mapMatching";

export type LatLon = { lat: number; lon: number };

/** Gaps larger than this (in metres) are treated as teleporting segments. */
export const GAP_THRESHOLD_M = 400;

/** Cap on repairs per route to avoid runaway API calls on severely broken routes. */
const MAX_REPAIRS = 25;

/**
 * Return the indices i where distance(points[i], points[i+1]) > thresholdM.
 */
export function findGapIndices(
  points: LatLon[],
  thresholdM: number = GAP_THRESHOLD_M
): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (haversineDistance(points[i], points[i + 1]) > thresholdM) {
      gaps.push(i);
    }
  }
  return gaps;
}

/**
 * Scan a route and return how many teleporting gaps it contains.
 * Useful for debug logging.
 */
export function countGaps(
  points: LatLon[],
  thresholdM: number = GAP_THRESHOLD_M
): number {
  return findGapIndices(points, thresholdM).length;
}

/**
 * Repair teleporting gaps in a route by re-routing each gap through OSRM.
 *
 * For every consecutive pair that is further apart than `thresholdM` metres,
 * a 2-waypoint OSRM route request is issued and the returned road-following
 * geometry replaces the straight-line jump. Up to MAX_REPAIRS gaps are fixed.
 *
 * Returns a new array — the original `points` array is not mutated.
 *
 * @param points       Route geometry to scan (matched or raw lat/lon)
 * @param config       Routing config — must have a valid `baseUrl` for OSRM
 * @param options      Route options passed through to OSRM (vehicle type etc.)
 * @param thresholdM   Gap distance in metres that triggers a repair (default 400)
 */
export async function repairRouteGaps(
  points: LatLon[],
  config: RoutingConfig,
  options?: RouteOptions,
  thresholdM: number = GAP_THRESHOLD_M
): Promise<LatLon[]> {
  if (points.length < 2) return points;

  const gapIndices = findGapIndices(points, thresholdM);
  if (gapIndices.length === 0) return points;

  const toRepair = gapIndices.slice(0, MAX_REPAIRS);

  // Issue all repair requests in parallel for speed
  const repairResults = await Promise.all(
    toRepair.map(async (idx) => {
      try {
        const from = points[idx];
        const to = points[idx + 1];
        const matched = await routeThroughWaypoints([from, to], config, options);
        if (matched && matched.matchedGeometry.length >= 2) {
          return { idx, segment: matched.matchedGeometry };
        }
      } catch {
        // Repair failed — keep the straight-line segment
      }
      return { idx, segment: null };
    })
  );

  // Build lookup: gap index → repaired geometry
  const repairs = new Map<number, LatLon[]>();
  for (const { idx, segment } of repairResults) {
    if (segment) repairs.set(idx, segment);
  }

  // Stitch repaired segments back into the route
  const result: LatLon[] = [];
  for (let i = 0; i < points.length; i++) {
    result.push(points[i]);
    if (i < points.length - 1 && repairs.has(i)) {
      const seg = repairs.get(i)!;
      // Slice off first and last points — they're already present as
      // points[i] (just pushed) and points[i+1] (pushed next iteration)
      result.push(...seg.slice(1, -1));
    }
  }

  return result;
}
