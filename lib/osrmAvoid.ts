/**
 * OSRM avoid-location helpers.
 *
 * OSRM's HTTP API does NOT support excluding specific node/way IDs.
 * Instead we force a detour by inserting an intermediate waypoint that is
 * offset ~80 m perpendicular to the approach bearing, pushing OSRM off the
 * avoided road segment onto an alternate path.
 */

import type { AvoidedNode } from "@/stores/mapStateStore";
import { haversineMeters, calculateBearing, toRad, toDeg } from "@/lib/_core/geo";

/** Earth radius in metres. */
const R = 6_371_000;

/**
 * Project a point (lat, lon) by `distanceM` metres in direction `bearingDeg`.
 * Uses the spherical earth direct formula.
 */
function projectPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): { lat: number; lon: number } {
  const d = distanceM / R;
  const b = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

/**
 * Returns an intermediate waypoint offset ~80 m perpendicular to the approach
 * bearing at the avoided location.  OSRM will route through this waypoint,
 * which forces it onto a different road segment.
 *
 * @param avoidLat         Latitude of the avoided location.
 * @param avoidLon         Longitude of the avoided location.
 * @param approachBearingDeg  Bearing (0–360°) from which traffic approaches the avoided spot.
 */
export function buildDetourWaypoint(
  avoidLat: number,
  avoidLon: number,
  approachBearingDeg: number,
): { lat: number; lon: number } {
  // Perpendicular = 90° clockwise from the approach bearing
  const perpBearing = (approachBearingDeg + 90) % 360;
  return projectPoint(avoidLat, avoidLon, perpBearing, 80);
}

/**
 * Find the index of the geometry point closest to a given lat/lon.
 */
function nearestGeomIndex(
  geometry: Array<{ lat: number; lon: number }>,
  target: { lat: number; lon: number },
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < geometry.length; i++) {
    const d = haversineMeters(geometry[i].lat, geometry[i].lon, target.lat, target.lon);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Insert detour intermediate waypoints for every avoided node into a
 * waypoints array.
 *
 * For each avoided location we:
 * 1. Find where it falls in the matched geometry.
 * 2. Compute the local approach bearing from the geometry segment before it.
 * 3. Build a perpendicular detour waypoint 80 m to the right.
 * 4. Splice it into the waypoints list at the correct segment.
 *
 * @param waypoints       The original ordered VRP waypoints.
 * @param avoided         List of avoided locations.
 * @param matchedGeometry Matched route geometry from the previous routing call.
 * @returns New waypoints array with detour points inserted.
 */
export function insertAvoidDetours(
  waypoints: Array<{ lat: number; lon: number }>,
  avoided: AvoidedNode[],
  matchedGeometry: Array<{ lat: number; lon: number }>,
): Array<{ lat: number; lon: number }> {
  if (avoided.length === 0 || matchedGeometry.length < 2) return waypoints;

  // Build detour entries: each has a waypoint and its geometry index
  const detours: Array<{
    geomIdx: number;
    approachBearing: number;
    avoidPt: { lat: number; lon: number };
  }> = avoided.map((node) => {
    const geomIdx = nearestGeomIndex(matchedGeometry, node);
    // Approach bearing: from the geometry point just before the avoid spot
    const prevIdx = Math.max(0, geomIdx - 1);
    const approachBearing = calculateBearing(
      matchedGeometry[prevIdx].lat,
      matchedGeometry[prevIdx].lon,
      matchedGeometry[geomIdx].lat,
      matchedGeometry[geomIdx].lon,
    );
    return { geomIdx, approachBearing, avoidPt: { lat: node.lat, lon: node.lon } };
  });

  // Sort detours by their position in the geometry
  detours.sort((a, b) => a.geomIdx - b.geomIdx);

  // Now insert detour waypoints between the appropriate original waypoints.
  // Strategy: find which segment [waypointA, waypointB] each avoid point falls
  // in, then insert the detour waypoint between A and B.
  const result: Array<{ lat: number; lon: number }> = [...waypoints];
  let insertOffset = 0; // track how many we've inserted so far

  for (const d of detours) {
    const detourWp = buildDetourWaypoint(
      d.avoidPt.lat,
      d.avoidPt.lon,
      d.approachBearing,
    );

    // Find the waypoint segment where this avoid location sits.
    // We find the two consecutive waypoints whose geometry indices straddle the avoid geomIdx.
    let insertAfter = 0; // index in `result` to insert after
    for (let w = 0; w < result.length - 1; w++) {
      const wIdx = nearestGeomIndex(matchedGeometry, result[w]);
      const wNextIdx = nearestGeomIndex(matchedGeometry, result[w + 1]);
      if (d.geomIdx >= wIdx && d.geomIdx <= wNextIdx) {
        insertAfter = w;
        break;
      }
      insertAfter = w; // fallback: insert after last matched
    }

    result.splice(insertAfter + 1 + insertOffset, 0, detourWp);
    insertOffset++;
  }

  return result;
}
