import type { RoutingConfig } from "@/lib/routing-config";
import {
  routeThroughWaypoints,
  type RouteOptions,
} from "@/lib/mapMatching";

export type LatLon = { lat: number; lon: number };

export type StitchRouteSegmentsResult = {
  points: LatLon[];
  /** Sum of routed connector leg distances (metres), excluding original segment geometry. */
  connectorDistanceM: number;
};

/**
 * Join ordered route fragments with real road geometry between each pair of endpoints.
 * Used when an optimizer emits disconnected components or a flat list has teleport gaps.
 *
 * @returns null if any inter-segment connector cannot be routed.
 */
export async function stitchRouteSegmentsWithRouting(
  segments: LatLon[][],
  config: RoutingConfig,
  options?: RouteOptions,
): Promise<StitchRouteSegmentsResult | null> {
  const nonempty = segments.filter((s) => s.length > 0);
  if (nonempty.length === 0) return { points: [], connectorDistanceM: 0 };
  if (nonempty.length === 1)
    return { points: [...nonempty[0]!], connectorDistanceM: 0 };

  let stitched: LatLon[] = [...nonempty[0]!];
  let connectorDistanceM = 0;
  for (let i = 1; i < nonempty.length; i++) {
    const prevEnd = stitched[stitched.length - 1];
    const nextSeg = nonempty[i]!;
    const nextStart = nextSeg[0];
    if (!prevEnd || !nextStart) continue;

    const connector = await routeThroughWaypoints(
      [prevEnd, nextStart],
      config,
      options,
    );
    if (!connector || connector.matchedGeometry.length < 2) return null;

    connectorDistanceM += connector.totalDistance;
    stitched = stitched.concat(
      connector.matchedGeometry.slice(1),
      nextSeg.slice(1),
    );
  }
  return { points: stitched, connectorDistanceM };
}
