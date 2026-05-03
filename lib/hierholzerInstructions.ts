/**
 * Turn-by-turn instruction generator for Hierholzer route output.
 *
 * Given the ordered sequence of RoutePoints produced by the route optimizer,
 * this module computes bearing changes between consecutive segments and
 * emits human-readable navigation instructions without relying on any
 * external navigation SDK (Google Directions, OSRM, etc.).
 */

import type { RoutePoint } from "./route-optimizer-v2/types";
import { haversineMeters, calculateBearing } from "./_core/geo";

export interface NavigationInstruction {
  index: number;
  point: { lat: number; lon: number };
  type: TurnType;
  bearingBefore: number;
  bearingAfter: number;
  turnAngle: number;
  distanceFromPrevious: number;
  distanceToNext: number;
  text: string;
  shortText: string;
  /** OSRM-compatible maneuver for NavigationEngine interop. */
  maneuver: { type: string; modifier?: string };
}

export type TurnType =
  | "depart"
  | "arrive"
  | "continue"
  | "slight_left"
  | "slight_right"
  | "turn_left"
  | "turn_right"
  | "sharp_left"
  | "sharp_right"
  | "u_turn";

function haversine(
  p1: { lat: number; lon: number },
  p2: { lat: number; lon: number },
): number {
  return haversineMeters(p1.lat, p1.lon, p2.lat, p2.lon);
}

function bearing(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  return calculateBearing(from.lat, from.lon, to.lat, to.lon);
}

function normalizeDelta(angle: number): number {
  let a = angle;
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

function classifyTurn(delta: number): TurnType {
  const abs = Math.abs(delta);
  if (abs < 15) return "continue";
  if (abs < 45) return delta > 0 ? "slight_right" : "slight_left";
  if (abs < 120) return delta > 0 ? "turn_right" : "turn_left";
  if (abs < 160) return delta > 0 ? "sharp_right" : "sharp_left";
  return "u_turn";
}

function turnTypeToManeuver(t: TurnType): { type: string; modifier?: string } {
  switch (t) {
    case "depart":
      return { type: "depart" };
    case "arrive":
      return { type: "arrive" };
    case "continue":
      return { type: "new name", modifier: "straight" };
    case "slight_left":
      return { type: "turn", modifier: "slight left" };
    case "slight_right":
      return { type: "turn", modifier: "slight right" };
    case "turn_left":
      return { type: "turn", modifier: "left" };
    case "turn_right":
      return { type: "turn", modifier: "right" };
    case "sharp_left":
      return { type: "turn", modifier: "sharp left" };
    case "sharp_right":
      return { type: "turn", modifier: "sharp right" };
    case "u_turn":
      return { type: "turn", modifier: "uturn" };
  }
}

function formatDist(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  if (meters >= 100) return `${Math.round(meters / 10) * 10} m`;
  return `${Math.round(meters)} m`;
}

const HUMAN_LABEL: Record<TurnType, string> = {
  depart: "Head",
  arrive: "Arrive at destination",
  continue: "Continue straight",
  slight_left: "Bear left",
  slight_right: "Bear right",
  turn_left: "Turn left",
  turn_right: "Turn right",
  sharp_left: "Sharp left",
  sharp_right: "Sharp right",
  u_turn: "Make a U-turn",
};

const SHORT_LABEL: Record<TurnType, string> = {
  depart: "Depart",
  arrive: "Arrive",
  continue: "Straight",
  slight_left: "Bear L",
  slight_right: "Bear R",
  turn_left: "Left",
  turn_right: "Right",
  sharp_left: "Sharp L",
  sharp_right: "Sharp R",
  u_turn: "U-turn",
};

function cardinalDirection(deg: number): string {
  const dirs = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ];
  return dirs[Math.round(deg / 45) % 8];
}

/**
 * Generate turn-by-turn instructions from a Hierholzer-ordered array of
 * RoutePoints. Consecutive "continue" segments are merged so the list
 * only contains actionable turns plus depart/arrive.
 *
 * @param route   Ordered RoutePoints from the optimizer
 * @param options.minTurnAngle   Degrees below which a bearing change is treated
 *                                as "continue" (default 20).
 * @param options.mergeThreshold Merge consecutive continues shorter than this
 *                                distance in meters (default 30).
 */
export function generateHierholzerInstructions(
  route: RoutePoint[],
  options: { minTurnAngle?: number; mergeThreshold?: number } = {},
): NavigationInstruction[] {
  if (route.length < 2) return [];

  const minAngle = options.minTurnAngle ?? 20;
  const points = route.map((p) => ({ lat: p.latitude, lon: p.longitude }));

  const segBearings: number[] = [];
  const segDistances: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segBearings.push(bearing(points[i], points[i + 1]));
    segDistances.push(haversine(points[i], points[i + 1]));
  }

  const raw: NavigationInstruction[] = [];

  // Depart
  raw.push({
    index: 0,
    point: points[0],
    type: "depart",
    bearingBefore: 0,
    bearingAfter: segBearings[0],
    turnAngle: 0,
    distanceFromPrevious: 0,
    distanceToNext: segDistances[0],
    text: `Head ${cardinalDirection(segBearings[0])}`,
    shortText: "Depart",
    maneuver: { type: "depart" },
  });

  // Intermediate turns
  let cumDist = segDistances[0];
  for (let i = 1; i < points.length - 1; i++) {
    const bBefore = segBearings[i - 1];
    const bAfter = segBearings[i];
    const delta = normalizeDelta(bAfter - bBefore);

    if (Math.abs(delta) < minAngle) {
      cumDist += segDistances[i];
      continue;
    }

    const turnType = classifyTurn(delta);
    const distFromPrev = cumDist;
    cumDist = segDistances[i];

    const distToNext = i < segDistances.length - 1 ? segDistances[i] : 0;

    raw.push({
      index: i,
      point: points[i],
      type: turnType,
      bearingBefore: bBefore,
      bearingAfter: bAfter,
      turnAngle: delta,
      distanceFromPrevious: distFromPrev,
      distanceToNext: distToNext,
      text: `In ${formatDist(distFromPrev)}, ${HUMAN_LABEL[turnType].toLowerCase()}`,
      shortText: SHORT_LABEL[turnType],
      maneuver: turnTypeToManeuver(turnType),
    });
  }

  // Arrive
  const lastBearing = segBearings[segBearings.length - 1];
  raw.push({
    index: points.length - 1,
    point: points[points.length - 1],
    type: "arrive",
    bearingBefore: lastBearing,
    bearingAfter: lastBearing,
    turnAngle: 0,
    distanceFromPrevious: cumDist,
    distanceToNext: 0,
    text: `In ${formatDist(cumDist)}, arrive at destination`,
    shortText: "Arrive",
    maneuver: { type: "arrive" },
  });

  return raw;
}

/**
 * Convert Hierholzer instructions into MatchedStep format so the
 * existing NavigationEngine can consume them directly.
 */
export function instructionsToMatchedSteps(
  route: RoutePoint[],
  instructions: NavigationInstruction[],
): Array<{
  geometry: { type: "LineString"; coordinates: [number, number][] };
  maneuver: { type: string; modifier?: string };
  name: string;
  distance: number;
  duration: number;
}> {
  if (instructions.length < 2) return [];

  const steps: Array<{
    geometry: { type: "LineString"; coordinates: [number, number][] };
    maneuver: { type: string; modifier?: string };
    name: string;
    distance: number;
    duration: number;
  }> = [];

  for (let s = 0; s < instructions.length - 1; s++) {
    const startIdx = instructions[s].index;
    const endIdx = instructions[s + 1].index;

    const coords: [number, number][] = [];
    let dist = 0;
    for (let i = startIdx; i <= endIdx && i < route.length; i++) {
      coords.push([route[i].longitude, route[i].latitude]);
      if (i > startIdx) {
        dist += haversine(
          { lat: route[i - 1].latitude, lon: route[i - 1].longitude },
          { lat: route[i].latitude, lon: route[i].longitude },
        );
      }
    }

    steps.push({
      geometry: { type: "LineString", coordinates: coords },
      maneuver: instructions[s].maneuver,
      name: instructions[s].text,
      distance: dist,
      duration: dist / 8.3, // ~30 km/h assumption
    });
  }

  return steps;
}

/**
 * Build a full MatchedRoute from the Hierholzer output so it can be fed
 * directly into NavigationEngine without any external map-matching API.
 */
export function buildMatchedRouteFromHierholzer(
  route: RoutePoint[],
  options?: { minTurnAngle?: number },
): {
  steps: Array<{
    geometry: { type: "LineString"; coordinates: [number, number][] };
    maneuver: { type: string; modifier?: string };
    name: string;
    distance: number;
    duration: number;
  }>;
  legs: Array<{ distance: number; duration: number }>;
  totalDistance: number;
  totalDuration: number;
  matchedGeometry: Array<{ lat: number; lon: number }>;
  instructions: NavigationInstruction[];
} {
  const instructions = generateHierholzerInstructions(route, options);
  const steps = instructionsToMatchedSteps(route, instructions);

  const geometry = route.map((p) => ({ lat: p.latitude, lon: p.longitude }));

  let totalDist = 0;
  for (let i = 1; i < geometry.length; i++) {
    totalDist += haversine(geometry[i - 1], geometry[i]);
  }
  const totalDuration = totalDist / 8.3;

  return {
    steps,
    legs: [{ distance: totalDist, duration: totalDuration }],
    totalDistance: totalDist,
    totalDuration,
    matchedGeometry: geometry,
    instructions,
  };
}
