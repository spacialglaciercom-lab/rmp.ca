import { CollectionPoint } from "@/types";

/**
 * Calculate the perpendicular distance from a point to a line segment
 * @param point The point to measure distance from
 * @param lineStart The start of the line segment
 * @param lineEnd The end of the line segment
 * @returns Distance in kilometers
 */
function perpendicularDistance(
  point: { latitude: number; longitude: number },
  lineStart: { latitude: number; longitude: number },
  lineEnd: { latitude: number; longitude: number }
): number {
  // Convert to radians
  const lat1 = (lineStart.latitude * Math.PI) / 180;
  const lon1 = (lineStart.longitude * Math.PI) / 180;
  const lat2 = (lineEnd.latitude * Math.PI) / 180;
  const lon2 = (lineEnd.longitude * Math.PI) / 180;
  const lat3 = (point.latitude * Math.PI) / 180;
  const lon3 = (point.longitude * Math.PI) / 180;

  // Angular distance between start and end points
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  // Angular distance from start to point
  const dLat3 = lat3 - lat1;
  const dLon3 = lon3 - lon1;

  // Calculate the cross-track distance using spherical geometry
  const a = Math.sin(dLat3) * Math.sin(dLat) + Math.cos(dLat3) * Math.cos(dLat) * Math.sin(dLon3) * Math.sin(dLon);
  const b = Math.sin(dLat) * Math.sin(dLat) + Math.cos(dLat) * Math.cos(dLat) * Math.sin(dLon) * Math.sin(dLon);
  const c = Math.sin(dLat3) * Math.sin(dLon3) + Math.cos(dLat3) * Math.cos(dLat) * Math.sin(dLat) * Math.sin(dLon3);

  // Cross-track distance in radians
  const dxt = Math.asin(Math.sin(a) * Math.sin(b) / Math.sqrt(b * c + (1 - b) * (1 - c)));

  // Convert to kilometers (Earth's radius = 6371 km)
  const distance = Math.abs(dxt) * 6371;

  return distance;
}

/**
 * Simplified perpendicular distance calculation using Cartesian approximation
 * This is faster and works well for small geographic areas
 * @param point The point to measure distance from
 * @param lineStart The start of the line segment
 * @param lineEnd The end of the line segment
 * @returns Distance in kilometers
 */
function perpendicularDistanceCartesian(
  point: { latitude: number; longitude: number },
  lineStart: { latitude: number; longitude: number },
  lineEnd: { latitude: number; longitude: number }
): number {
  const x0 = point.longitude;
  const y0 = point.latitude;
  const x1 = lineStart.longitude;
  const y1 = lineStart.latitude;
  const x2 = lineEnd.longitude;
  const y2 = lineEnd.latitude;

  // Calculate the perpendicular distance using the point-to-line formula
  const numerator = Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2);

  if (denominator === 0) {
    // Start and end are the same point
    return Math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2) * 111; // Rough conversion to km
  }

  // Distance in degrees, convert to km (1 degree ≈ 111 km)
  return (numerator / denominator) * 111;
}

/**
 * Douglas-Peucker algorithm for polyline simplification
 * Reduces the number of points in a polyline while preserving its overall shape
 * @param points Array of collection points representing the route
 * @param tolerance Maximum perpendicular distance in kilometers for point removal
 * @returns Simplified array of collection points
 */
export function douglasPeucker(
  points: CollectionPoint[],
  tolerance: number = 0.01 // 10 meters default
): CollectionPoint[] {
  if (points.length <= 2) {
    return points;
  }

  // Find the point with the maximum distance from the line segment
  let maxDistance = 0;
  let maxIndex = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistanceCartesian(
      { latitude: points[i].latitude, longitude: points[i].longitude },
      { latitude: start.latitude, longitude: start.longitude },
      { latitude: end.latitude, longitude: end.longitude }
    );

    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDistance > tolerance) {
    // Recursively simplify the two segments
    const leftSegment = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const rightSegment = douglasPeucker(points.slice(maxIndex), tolerance);

    // Combine results, removing duplicate point at maxIndex
    return [...leftSegment.slice(0, -1), ...rightSegment];
  } else {
    // Remove all points between start and end
    return [start, end];
  }
}

/**
 * Simplify route with multiple tolerance levels
 * Returns a simplified route that retains important waypoints
 * @param points Array of collection points
 * @param targetReduction Target percentage of points to keep (0-1)
 * @returns Simplified array of collection points
 */
export function simplifyRouteByReduction(
  points: CollectionPoint[],
  targetReduction: number = 0.5 // Keep 50% of points by default
): CollectionPoint[] {
  if (points.length <= 2) {
    return points;
  }

  // Binary search for the right tolerance value
  let minTolerance = 0;
  let maxTolerance = 1; // 1 km max
  let bestResult = points;

  for (let iteration = 0; iteration < 20; iteration++) {
    const midTolerance = (minTolerance + maxTolerance) / 2;
    const simplified = douglasPeucker(points, midTolerance);

    const reductionRatio = simplified.length / points.length;

    if (reductionRatio > targetReduction) {
      // Too many points, increase tolerance
      minTolerance = midTolerance;
    } else {
      // Too few points, decrease tolerance
      maxTolerance = midTolerance;
      bestResult = simplified;
    }
  }

  return bestResult;
}

/**
 * Calculate the compression ratio and file size savings
 * @param originalPoints Original collection points
 * @param simplifiedPoints Simplified collection points
 * @returns Object with compression metrics
 */
export function calculateCompressionMetrics(
  originalPoints: CollectionPoint[],
  simplifiedPoints: CollectionPoint[]
): {
  originalCount: number;
  simplifiedCount: number;
  reductionPercentage: number;
  pointsRemoved: number;
} {
  const originalCount = originalPoints.length;
  const simplifiedCount = simplifiedPoints.length;
  const pointsRemoved = originalCount - simplifiedCount;
  const reductionPercentage = ((pointsRemoved / originalCount) * 100).toFixed(1);

  return {
    originalCount,
    simplifiedCount,
    reductionPercentage: parseFloat(reductionPercentage),
    pointsRemoved,
  };
}

/**
 * Estimate GPX file size based on number of points
 * @param pointCount Number of waypoints in the route
 * @returns Estimated file size in KB
 */
export function estimateGPXFileSize(pointCount: number): number {
  // Average GPX waypoint: ~200 bytes (including coordinates, elevation, time, etc.)
  // Plus ~1 KB for header and metadata
  const bytesPerPoint = 200;
  const headerSize = 1000;
  const totalBytes = headerSize + pointCount * bytesPerPoint;
  return totalBytes / 1024; // Convert to KB
}
