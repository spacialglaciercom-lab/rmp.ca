import { CollectionPoint } from "@/types";
import { RouteStatistics, TurnStatistics } from "@/types/routing";

/**
 * Calculate the Haversine distance between two coordinates in kilometers
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate bearing (direction) between two points in degrees (0-360)
 */
function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
  const bearing = Math.atan2(y, x);
  return (toDegrees(bearing) + 360) % 360;
}

function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Determine turn type based on change in bearing
 */
function determineTurnType(
  previousBearing: number,
  currentBearing: number,
): "right" | "left" | "uturn" | "straight" {
  let angle = currentBearing - previousBearing;

  // Normalize angle to -180 to 180
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;

  const absAngle = Math.abs(angle);

  if (absAngle > 150) return "uturn";
  if (absAngle < 30) return "straight";
  if (angle > 0) return "right";
  return "left";
}

/** Options for route statistics calculation */
export interface RouteStatisticsOptions {
  /** Use this road distance (km) instead of haversine sum. More accurate for CPP/OSM routes. */
  distanceKmOverride?: number;
  /** Backend optimizer stats to merge in (more accurate turns, efficiency, etc.) */
  optimizerStats?: {
    total_traversals?: number;
    total_distance_km?: number;
    right_turns?: number;
    left_turns?: number;
    u_turns?: number;
    straight?: number;
    dead_ends_identified?: number;
    u_turns_avoided?: number;
    efficiency?: number;
    oneway_violations?: Array<[string, string]>;
  };
}

/**
 * Calculate route statistics from collection points
 * @param points - Ordered collection points along the route
 * @param options - Optional overrides (e.g. distanceKmOverride from optimizer for accurate road distance)
 */
export function calculateRouteStatistics(
  points: CollectionPoint[],
  options?: RouteStatisticsOptions,
): RouteStatistics {
  if (points.length === 0) {
    return {
      totalDistance: 0,
      estimatedTime: 0,
      totalTraversals: 0,
      turns: {
        rightTurns: 0,
        leftTurns: 0,
        uTurns: 0,
        straightAhead: 0,
      },
      segmentsRouted: 0,
      segmentsExcluded: 0,
    };
  }

  if (points.length === 1) {
    return {
      totalDistance: 0,
      estimatedTime: 5, // 5 minutes for single point
      totalTraversals: 1,
      turns: {
        rightTurns: 0,
        leftTurns: 0,
        uTurns: 0,
        straightAhead: 0,
      },
      segmentsRouted: 1,
      segmentsExcluded: 0,
    };
  }

  let totalDistance = 0;
  const turns: TurnStatistics = {
    rightTurns: 0,
    leftTurns: 0,
    uTurns: 0,
    straightAhead: 0,
  };

  let previousBearing: number | null = null;

  // Calculate distance and turns between consecutive points
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    // Calculate distance
    const distance = haversineDistance(
      p1.latitude,
      p1.longitude,
      p2.latitude,
      p2.longitude,
    );
    totalDistance += distance;

    // Calculate bearing and turn type
    const currentBearing = calculateBearing(
      p1.latitude,
      p1.longitude,
      p2.latitude,
      p2.longitude,
    );

    if (previousBearing !== null) {
      const turnType = determineTurnType(previousBearing, currentBearing);
      switch (turnType) {
        case "right":
          turns.rightTurns++;
          break;
        case "left":
          turns.leftTurns++;
          break;
        case "uturn":
          turns.uTurns++;
          break;
        case "straight":
          turns.straightAhead++;
          break;
      }
    } else {
      // First segment: count as straight so total_traversals = right+left+u_turns+straight
      turns.straightAhead++;
    }

    previousBearing = currentBearing;
  }

  // Use optimizer's road distance when available (more accurate than haversine for CPP routes)
  const distanceForTime = options?.distanceKmOverride ?? totalDistance;
  const totalDistanceKm = options?.distanceKmOverride ?? totalDistance;

  // Estimated time: drive time at 25 km/h (realistic for residential trash collection).
  // Avoid per-point service time - CPP routes have thousands of graph nodes, not actual stops.
  const DRIVE_SPEED_KMH = 25;
  const MIN_AVG_SPEED_KMH = 10; // Reject estimates implying slower than this (wrong units or bad haversine)
  let estimatedTime = Math.round((distanceForTime / DRIVE_SPEED_KMH) * 60);
  const totalDistanceKmRounded = parseFloat(totalDistanceKm.toFixed(2));
  if (totalDistanceKmRounded > 0 && estimatedTime > 0) {
    const impliedSpeedKmh = (totalDistanceKmRounded / estimatedTime) * 60;
    if (impliedSpeedKmh < MIN_AVG_SPEED_KMH) {
      estimatedTime = Math.round(
        (totalDistanceKmRounded / DRIVE_SPEED_KMH) * 60,
      );
    }
  }

  // Total traversals = number of segments (for display; not used for time)
  const totalTraversals =
    options?.optimizerStats?.total_traversals ?? points.length - 1;

  // Segments routed = total segments (in real CPP, some might be excluded)
  const segmentsRouted = totalTraversals;
  const segmentsExcluded = 0; // In simplified version, no exclusions

  // Use optimizer turns if available (more accurate for graph-based routes)
  const finalTurns: TurnStatistics = options?.optimizerStats
    ? {
        rightTurns: options.optimizerStats.right_turns ?? 0,
        leftTurns: options.optimizerStats.left_turns ?? 0,
        uTurns: options.optimizerStats.u_turns ?? 0,
        straightAhead: options.optimizerStats.straight ?? 0,
      }
    : turns;

  return {
    totalDistance: totalDistanceKmRounded,
    estimatedTime,
    totalTraversals,
    turns: finalTurns,
    segmentsRouted,
    segmentsExcluded,
    // Backend stats
    efficiency: options?.optimizerStats?.efficiency,
    deadEndsIdentified: options?.optimizerStats?.dead_ends_identified,
    onewayViolations: options?.optimizerStats?.oneway_violations?.length,
    uTurnsAvoided: options?.optimizerStats?.u_turns_avoided,
  };
}

/**
 * Optimize route order using nearest neighbor + 2-opt algorithm to eliminate zigzag movements
 * This creates a much more efficient route by removing edge crossings
 */
export function optimizeRouteOrder(
  points: CollectionPoint[],
  startPoint?: { latitude: number; longitude: number },
): CollectionPoint[] {
  if (points.length <= 1) return points;

  // Step 1: Build initial route using nearest neighbor
  const unvisited = [...points];
  let route: CollectionPoint[] = [];

  // Start from specified start point or first point
  let current: { latitude: number; longitude: number };
  if (startPoint) {
    current = startPoint;
  } else {
    const first = unvisited.shift()!;
    route.push(first);
    current = { latitude: first.latitude, longitude: first.longitude };
  }

  // Nearest neighbor algorithm for initial route
  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = haversineDistance(
      current.latitude,
      current.longitude,
      unvisited[0].latitude,
      unvisited[0].longitude,
    );

    for (let i = 1; i < unvisited.length; i++) {
      const distance = haversineDistance(
        current.latitude,
        current.longitude,
        unvisited[i].latitude,
        unvisited[i].longitude,
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    const nearest = unvisited.splice(nearestIndex, 1)[0];
    route.push(nearest);
    current = { latitude: nearest.latitude, longitude: nearest.longitude };
  }

  // Step 2: Apply 2-opt optimization to eliminate zigzag and crossings
  if (route.length <= 3) return route;

  let improved = true;
  let iterations = 0;
  const maxIterations = 500; // Prevent infinite loops

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 1; i < route.length - 2; i++) {
      for (let j = i + 1; j < route.length - 1; j++) {
        // Calculate current distance for edges (i-1,i) and (j,j+1)
        const currentDist =
          haversineDistance(
            route[i - 1].latitude,
            route[i - 1].longitude,
            route[i].latitude,
            route[i].longitude,
          ) +
          haversineDistance(
            route[j].latitude,
            route[j].longitude,
            route[j + 1].latitude,
            route[j + 1].longitude,
          );

        // Calculate distance after reversing segment between i and j
        const newDist =
          haversineDistance(
            route[i - 1].latitude,
            route[i - 1].longitude,
            route[j].latitude,
            route[j].longitude,
          ) +
          haversineDistance(
            route[i].latitude,
            route[i].longitude,
            route[j + 1].latitude,
            route[j + 1].longitude,
          );

        // If reversing improves the route, do it
        if (newDist < currentDist - 0.0001) {
          // Reverse the segment between i and j (inclusive)
          const segment = route.slice(i, j + 1).reverse();
          route.splice(i, j - i + 1, ...segment);
          improved = true;
        }
      }
    }
  }

  return route;
}

/**
 * Format distance for display
 */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  return `${km.toFixed(1)}km`;
}

/**
 * Format time for display
 */
export function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}m`;
  }
  return `${hours}h ${mins}m`;
}
