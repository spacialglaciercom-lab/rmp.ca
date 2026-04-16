import { DEFAULT_STATIC_PENALTIES } from "@/types/turnAware";

/** Calculate bearing between two coordinates (degrees 0–360). */
export function calculateBearing(
  start: [number, number],
  end: [number, number],
): number {
  const lat1 = (start[0] * Math.PI) / 180;
  const lat2 = (end[0] * Math.PI) / 180;
  const dLon = ((end[1] - start[1]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/** Classify turn based on angle difference. */
export function classifyTurn(
  incomingBearing: number,
  outgoingBearing: number,
): keyof typeof DEFAULT_STATIC_PENALTIES {
  const angleDiff = (outgoingBearing - incomingBearing + 360) % 360;
  if (angleDiff >= 340 || angleDiff <= 20) return "straight";
  if (angleDiff > 20 && angleDiff <= 160) return "right";
  if (angleDiff > 160 && angleDiff <= 200) return "u-turn";
  return "left";
}
