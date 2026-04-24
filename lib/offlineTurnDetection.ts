/**
 * Offline turn detection from GPX points using bearing changes.
 * Fallback when OSRM/Valhalla map matching is not available.
 */

import { haversineMeters } from "./_core/geo";

export interface TurnInstruction {
  index: number;
  point: { lat: number; lon: number };
  type: string;
  angle: number;
  distanceFromPrevious: number;
  text: string;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineDistance(
  p1: { lat: number; lon: number },
  p2: { lat: number; lon: number },
): number {
  return haversineMeters(p1.lat, p1.lon, p2.lat, p2.lon);
}

function calculateBearing(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return toDeg(Math.atan2(y, x));
}

function normalizeBearing(angle: number): number {
  let a = angle;
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

function getTurnType(angle: number): string {
  const abs = Math.abs(angle);
  if (abs < 20) return "continue";
  if (abs < 45) return angle > 0 ? "slight_right" : "slight_left";
  if (abs < 120) return angle > 0 ? "turn_right" : "turn_left";
  if (abs < 160) return angle > 0 ? "sharp_right" : "sharp_left";
  return "u_turn";
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  if (meters >= 100) return `${Math.round(meters / 100) * 100} m`;
  return `${Math.round(meters)} m`;
}

/**
 * Detect turn instructions from a sequence of GPX points using bearing change.
 * @param points Array of { lat, lon }
 * @param thresholdDegrees Minimum angle (degrees) to consider a turn
 */
export function detectTurnsFromGPX(
  points: Array<{ lat: number; lon: number }>,
  thresholdDegrees: number = 30,
): TurnInstruction[] {
  const instructions: TurnInstruction[] = [];
  if (points.length < 3) return instructions;

  for (let i = 1; i < points.length - 1; i++) {
    const bearing1 = calculateBearing(points[i - 1], points[i]);
    const bearing2 = calculateBearing(points[i], points[i + 1]);
    const angleDelta = normalizeBearing(bearing2 - bearing1);

    if (Math.abs(angleDelta) > thresholdDegrees) {
      const distFromPrev = haversineDistance(points[i - 1], points[i]);
      const type = getTurnType(angleDelta);
      instructions.push({
        index: i,
        point: points[i],
        type,
        angle: angleDelta,
        distanceFromPrevious: distFromPrev,
        text: `${type.replace(/_/g, " ")} in ${formatDistance(distFromPrev)}`,
      });
    }
  }

  return instructions;
}
