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
export function sanitizeLatLonArray(
  arr?: LatLonPoint[] | null,
): LatLonPoint[] {
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
