/**
 * OSRM /nearest endpoint wrapper.
 * Snaps a lat/lon to the closest road node in the OSRM graph.
 * Used to show snap-to-road debug info in the route node popup.
 */

export interface NearestResult {
  snappedLat: number;
  snappedLon: number;
  /** Straight-line distance in metres from the queried point to the snapped location. */
  snapDistanceM: number;
  /** Road name from OSRM nearest (may be empty string). */
  name: string;
  /** OSM node ID of the snapped waypoint (if OSRM returns it). */
  nodeId?: number;
}

/**
 * Query OSRM's /nearest endpoint to find the road node closest to (lat, lon).
 * Returns null on any network/parse error.
 */
export async function snapToRoad(
  lat: number,
  lon: number,
  baseUrl: string,
): Promise<NearestResult | null> {
  try {
    const url = `${baseUrl}/nearest/v1/driving/${lon},${lat}?number=1`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code !== "Ok" || !data.waypoints?.length) return null;

    const wp = data.waypoints[0];
    const [snapLon, snapLat] = wp.location ?? [lon, lat];

    // Haversine distance between queried point and snapped point
    const R = 6_371_000; // Earth radius in metres
    const dLat = ((snapLat - lat) * Math.PI) / 180;
    const dLon = ((snapLon - lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) *
        Math.cos((snapLat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const snapDistanceM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return {
      snappedLat: snapLat,
      snappedLon: snapLon,
      snapDistanceM,
      name: wp.name ?? "",
      nodeId: typeof wp.nodes?.[0] === "number" ? wp.nodes[0] : undefined,
    };
  } catch {
    return null;
  }
}
