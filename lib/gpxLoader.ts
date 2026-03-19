/**
 * Load GPX as a route line (Position[] for createRouteLine / navigation).
 * Uses existing gpxNavParser — no new dependencies. Supports 50 km+ GPX.
 */

import { parseGPXForNavigation } from "./gpxNavParser";
import type { Position } from "./routeSnap";

/**
 * Load GPX from a URL, a GPX XML string, or a File and return route coordinates
 * as [lon, lat][] for createRouteLine() and offline navigation.
 *
 * - string: if it looks like a URL (starts with http/https), fetches and parses;
 *   otherwise treated as GPX XML.
 * - File: reads via file.text() then parses (React Native / web compatible).
 */
export async function loadGpxAsRoute(
  gpxSource: File | string,
): Promise<Position[]> {
  let gpxString: string;

  if (typeof gpxSource === "string") {
    const trimmed = gpxSource.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const res = await fetch(trimmed);
      if (!res.ok) throw new Error(`Failed to fetch GPX: ${res.status}`);
      gpxString = await res.text();
    } else {
      gpxString = trimmed;
    }
  } else {
    gpxString = await gpxSource.text();
  }

  const parsed = parseGPXForNavigation(gpxString);
  const points = parsed.points.length > 0 ? parsed.points : parsed.waypoints;

  if (points.length === 0) {
    throw new Error("GPX contains no track, route, or waypoint points");
  }

  return points.map((p) => [p.lon, p.lat] as Position);
}
