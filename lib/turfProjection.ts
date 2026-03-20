/**
 * Turf.js projection utilities for snapping GPS positions onto route geometry.
 *
 * Uses @turf/nearest-point-on-line to project a live GPS coordinate onto a
 * polyline (e.g. Overture segment geometry or a collection route). This
 * replaces Google Roads API snapping for the collection navigator — it's
 * purely client-side and free.
 */

import nearestPointOnLine from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";
import { haversineDistance } from "@/lib/offlineTurnDetection";

export interface ProjectionResult {
  /** Snapped point on the line. */
  snappedLat: number;
  snappedLon: number;
  /** Index of the line segment (0-based) the projected point falls on. */
  segmentIndex: number;
  /** Distance from the GPS point to the snapped point, in meters. */
  distanceFromRoute: number;
  /** Distance along the line from its start to the snapped point, in meters. */
  distanceAlong: number;
  /** Fractional position along the entire line [0..1]. */
  fractionAlong: number;
}

/**
 * Project a GPS point onto a polyline using turf's nearestPointOnLine.
 *
 * @param location  Live GPS position { lat, lon }.
 * @param line      Route polyline as an array of { lat, lon } (≥ 2 points).
 * @returns         ProjectionResult, or null if the line is too short.
 */
export function projectOntoLine(
  location: { lat: number; lon: number },
  line: ReadonlyArray<{ lat: number; lon: number }>,
): ProjectionResult | null {
  if (line.length < 2) return null;

  const geoLine = lineString(line.map((p) => [p.lon, p.lat]));
  const geoPoint = point([location.lon, location.lat]);

  const snapped = nearestPointOnLine(geoLine, geoPoint, { units: "meters" });

  const coords = snapped.geometry.coordinates;
  const props = snapped.properties;

  const totalLength = computeLineLength(line);
  const distAlong = props.location ?? 0;

  return {
    snappedLat: coords[1],
    snappedLon: coords[0],
    segmentIndex: props.index ?? 0,
    distanceFromRoute: props.dist ?? 0,
    distanceAlong: distAlong,
    fractionAlong: totalLength > 0 ? distAlong / totalLength : 0,
  };
}

/**
 * Project onto a line, but restrict the search window to a range of segments.
 * Useful for NavigationEngine where we only need to check near the current
 * position rather than the full route.
 *
 * @param location   Live GPS position.
 * @param line       Full route polyline.
 * @param startIdx   First segment index to consider (inclusive).
 * @param endIdx     Last point index to consider (inclusive).
 * @returns          ProjectionResult with segmentIndex relative to the full line.
 */
export function projectOntoLineWindow(
  location: { lat: number; lon: number },
  line: ReadonlyArray<{ lat: number; lon: number }>,
  startIdx: number,
  endIdx: number,
): ProjectionResult | null {
  const lo = Math.max(0, startIdx);
  const hi = Math.min(line.length - 1, endIdx);
  if (hi - lo < 1) return null;

  const window = line.slice(lo, hi + 1);
  const result = projectOntoLine(location, window);
  if (!result) return null;

  // Shift segment index back to full-line coordinates
  result.segmentIndex += lo;

  // Recompute distanceAlong relative to the full line start
  let prefixDist = 0;
  for (let i = 0; i < lo; i++) {
    prefixDist += haversineDistance(line[i], line[i + 1]);
  }
  result.distanceAlong += prefixDist;

  const totalLength = computeLineLength(line);
  result.fractionAlong =
    totalLength > 0 ? result.distanceAlong / totalLength : 0;

  return result;
}

/**
 * Compute the total length of a polyline in meters using the haversine formula.
 */
function computeLineLength(
  line: ReadonlyArray<{ lat: number; lon: number }>,
): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    total += haversineDistance(line[i], line[i + 1]);
  }
  return total;
}
