/**
 * Canonical route import point shape shared by CSV, GeoJSON, and hooks.
 */
export type RoutePointType = "bin" | "dumpster" | "waypoint" | "depot";

export interface ParsedRoutePoint {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  address?: string;
  type?: RoutePointType;
  demand?: number;
  timeWindow?: {
    start?: string;
    end?: string;
  };
  serviceTime?: number;
  notes?: string;
}

export function normalizePointType(type: string | undefined): RoutePointType | undefined {
  if (!type) return undefined;
  const t = type.toLowerCase();
  if (t === "depot" || t === "start" || t === "end") return "depot";
  if (t === "dumpster" || t === "d") return "dumpster";
  if (t === "waypoint" || t === "stop") return "waypoint";
  return "bin";
}
