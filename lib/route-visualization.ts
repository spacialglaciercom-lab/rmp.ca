/**
 * Route visualization utilities
 * Handles coloring and styling of routes based on turn types
 */

export type TurnType = "right" | "left" | "uturn" | "straight" | "unknown";

export interface RouteSegment {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  turnType: TurnType;
  distance: number;
}

/**
 * Get color for turn type
 */
export function getTurnColor(turnType: TurnType): string {
  switch (turnType) {
    case "right":
      return "#22c55e"; // Green - right turns are preferred
    case "straight":
      return "#3b82f6"; // Blue - straight ahead
    case "left":
      return "#f59e0b"; // Amber - left turns are penalized
    case "uturn":
      return "#ef4444"; // Red - U-turns are heavily penalized
    default:
      return "#6b7280"; // Gray - unknown
  }
}

/**
 * Calculate bearing between two points (in degrees)
 * 0° = North, 90° = East, 180° = South, 270° = West
 */
export function calculateBearing(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): number {
  const dLon = to.lon - from.lon;
  const y = Math.sin(dLon) * Math.cos(to.lat);
  const x =
    Math.cos(from.lat) * Math.sin(to.lat) -
    Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(dLon);

  const bearing = Math.atan2(y, x);
  return ((bearing * 180) / Math.PI + 360) % 360;
}

/**
 * Determine turn type based on bearing change
 */
export function determineTurnType(
  incomingBearing: number,
  outgoingBearing: number
): TurnType {
  let turnAngle = outgoingBearing - incomingBearing;

  // Normalize to -180 to 180
  if (turnAngle > 180) {
    turnAngle -= 360;
  } else if (turnAngle < -180) {
    turnAngle += 360;
  }

  // Classify turn
  if (Math.abs(turnAngle) < 15) {
    return "straight";
  } else if (turnAngle > 15 && turnAngle < 165) {
    return "right";
  } else if (turnAngle > 165 || turnAngle < -165) {
    return "uturn";
  } else if (turnAngle < -15 && turnAngle > -165) {
    return "left";
  }

  return "unknown";
}

/**
 * Calculate distance between two points (in km)
 */
export function calculateDistance(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Analyze route and generate colored segments
 */
export function analyzeRoute(
  points: Array<{ lat: number; lon: number }>
): RouteSegment[] {
  if (points.length < 2) {
    return [];
  }

  const segments: RouteSegment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const distance = calculateDistance(start, end);

    let turnType: TurnType = "unknown";

    if (i > 0) {
      const prevStart = points[i - 1];
      const incomingBearing = calculateBearing(prevStart, start);
      const outgoingBearing = calculateBearing(start, end);
      turnType = determineTurnType(incomingBearing, outgoingBearing);
    } else {
      turnType = "straight";
    }

    segments.push({
      start,
      end,
      turnType,
      distance,
    });
  }

  return segments;
}

/**
 * Generate route statistics
 */
export function generateRouteStats(segments: RouteSegment[]) {
  const stats = {
    totalDistance: 0,
    rightTurns: 0,
    leftTurns: 0,
    uTurns: 0,
    straightSegments: 0,
    averageSegmentDistance: 0,
  };

  for (const segment of segments) {
    stats.totalDistance += segment.distance;

    switch (segment.turnType) {
      case "right":
        stats.rightTurns++;
        break;
      case "left":
        stats.leftTurns++;
        break;
      case "uturn":
        stats.uTurns++;
        break;
      case "straight":
        stats.straightSegments++;
        break;
    }
  }

  if (segments.length > 0) {
    stats.averageSegmentDistance = stats.totalDistance / segments.length;
  }

  return stats;
}

/**
 * Format distance for display
 */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${(km * 1000).toFixed(0)}m`;
  }
  return `${km.toFixed(2)}km`;
}

/**
 * Format time for display (assuming 30 km/h average)
 */
export function formatTime(km: number): string {
  const minutes = Math.round((km / 30) * 60);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}min`;
}

/**
 * Get turn description
 */
export function getTurnDescription(turnType: TurnType): string {
  switch (turnType) {
    case "right":
      return "Turn Right";
    case "left":
      return "Turn Left";
    case "uturn":
      return "U-Turn";
    case "straight":
      return "Continue Straight";
    default:
      return "Unknown Turn";
  }
}
