/**
 * Real-time snap GPS to route using Turf.
 * Optimized for long routes (50 km+ GPX). Offline, no API calls.
 */

import * as turf from "@turf/turf";

/** [longitude, latitude] per GeoJSON. */
export type Position = [number, number];

/** GeoJSON LineString feature (route geometry). Compatible with Turf. */
export interface RouteLine {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Position[] };
  properties?: Record<string, unknown>;
}

export type GPSPoint = {
  lon: number;
  lat: number;
  accuracy?: number;
  timestamp?: number;
};

export type MatchedPoint = {
  snapped: Position;
  distanceToRoute: number;
  routeProgressMeters: number;
  routeProgressPercent: number;
  currentSegmentIndex: number;
  bearing: number;
  isOffRoute: boolean;
};

/**
 * Pre-compute once when you load the route (from GPX or optimizer).
 */
export function createRouteLine(
  coords: Position[] | RouteLine
): RouteLine {
  if (Array.isArray(coords)) {
    return turf.lineString(coords) as RouteLine;
  }
  return coords as RouteLine;
}

/**
 * Total length of the route in meters.
 */
export function getRouteLengthMeters(routeLine: RouteLine): number {
  return turf.length(routeLine, { units: "meters" });
}

/**
 * Snap GPS to route — optimized for long routes (50 km+ GPX).
 * Uses Turf 7.3/7.4 property fallbacks (pointDistance/dist, lineDistance/location, segmentIndex/index).
 */
export function snapToRoute(
  gps: GPSPoint,
  routeLine: RouteLine,
  previousMatch?: MatchedPoint,
  offRouteThresholdMeters: number = 30
): MatchedPoint {
  const point = turf.point([gps.lon, gps.lat]);

  const snapped = turf.nearestPointOnLine(routeLine, point, {
    units: "meters",
  });

  const props = snapped.properties as Record<string, number | undefined>;
  const distanceToRoute =
    props.pointDistance ?? props.dist ?? 0;
  const routeProgressMeters =
    props.lineDistance ?? props.location ?? 0;

  const totalLength = turf.length(routeLine, { units: "meters" });
  const routeProgressPercent = Math.min(
    totalLength > 0 ? (routeProgressMeters / totalLength) * 100 : 0,
    100
  );

  const currentSegmentIndex = props.segmentIndex ?? props.index ?? 0;

  const coords = routeLine.geometry.coordinates;
  const bearing = turf.bearing(
    turf.point(coords[currentSegmentIndex]),
    turf.point(coords[Math.min(currentSegmentIndex + 1, coords.length - 1)])
  );

  const isOffRoute = distanceToRoute > offRouteThresholdMeters;

  let finalSnapped = snapped.geometry.coordinates as Position;
  if (previousMatch && !isOffRoute) {
    if (routeProgressMeters < previousMatch.routeProgressMeters - 50) {
      finalSnapped = previousMatch.snapped;
    }
  }

  return {
    snapped: finalSnapped,
    distanceToRoute,
    routeProgressMeters,
    routeProgressPercent,
    currentSegmentIndex,
    bearing,
    isOffRoute,
  };
}

/**
 * Next turn instruction (uses the segmentIndex Turf already gives us).
 */
export function getNextTurn(
  match: MatchedPoint,
  routeLine: RouteLine
): string {
  const coords = routeLine.geometry.coordinates;
  const nextIndex = Math.min(
    match.currentSegmentIndex + 1,
    coords.length - 2
  );

  const currentBearing = match.bearing;
  const nextBearing = turf.bearing(
    turf.point(coords[nextIndex]),
    turf.point(coords[nextIndex + 1])
  );

  const turnAngle = ((nextBearing - currentBearing + 540) % 360) - 180;

  if (Math.abs(turnAngle) < 15) return "Continue straight";
  return turnAngle > 0
    ? `Turn right ${Math.round(Math.abs(turnAngle))}°`
    : `Turn left ${Math.round(Math.abs(turnAngle))}°`;
}
