// Utility helpers for validating and sanitizing latitude/longitude point arrays.

export interface LatLonPoint {
  lat: number;
  lon: number;
}

/**
 * Remove any points where lat or lon is missing, NaN, or not a number.
 * This is defensive code for data coming from storage/logic that may
 * contain bogus values (e.g. after clearing a route on iOS the store
 * could briefly emit an array containing `[ { lat: NaN, lon: NaN } ]`).
 */
export function sanitizeLatLonArray(arr?: LatLonPoint[] | null): LatLonPoint[] {
  if (!arr) return [];
  return arr.filter(
    (p) =>
      p &&
      typeof p.lat === "number" &&
      typeof p.lon === "number" &&
      !isNaN(p.lat) &&
      !isNaN(p.lon),
  );
}

/**
 * Apply `sanitizeLatLonArray` to each vehicle and drop any vehicle with
 * no valid points.  Used when we support multi-vehicle preview.
 */
export function sanitizeByVehicle(
  arr?: Array<LatLonPoint[]> | null,
): Array<LatLonPoint[]> {
  if (!arr) return [];
  return arr
    .map((veh) => sanitizeLatLonArray(veh))
    .filter((veh) => veh.length > 0);
}

function haversineMeters(a: LatLonPoint, b: LatLonPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Split a single point list into separate polylines wherever consecutive points
 * are farther apart than `maxGapMeters` (disconnected optimizer components,
 * or legacy flat routes saved before segment metadata existed).
 */
export function splitRouteAtTeleportGaps(
  points: LatLonPoint[],
  maxGapMeters: number,
): LatLonPoint[][] {
  const pts = sanitizeLatLonArray(points);
  if (pts.length === 0) return [];
  const out: LatLonPoint[][] = [];
  let cur: LatLonPoint[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const p = pts[i]!;
    if (haversineMeters(prev, p) > maxGapMeters) {
      if (cur.length >= 1) out.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 0) out.push(cur);
  return out.filter((g) => g.length > 0);
}
