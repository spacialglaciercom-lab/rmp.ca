/**
 * Routing cost plugins: modular cost modifiers for directed edge weights.
 * Symmetrical to the Python backend (backend/app/routing_plugins.py).
 * Used by the offline TS graph builder when optimizing from GeoJSON with [lon, lat, z].
 */

// ---------------------------------------------------------------------------
// Math helpers (mirror Python backend)
// ---------------------------------------------------------------------------

import { haversineMeters as haversineMetersCore, calculateBearing as calculateBearingCore } from "./_core/geo";

/**
 * Haversine distance in meters between two WGS84 points.
 * Argument order is (lon, lat, lon, lat) to mirror the Python backend
 * (backend/app/routing_plugins.py). Delegates to the canonical
 * lat-first primitive in `_core/geo.ts`.
 */
export function haversineMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  return haversineMetersCore(lat1, lon1, lat2, lon2);
}

/**
 * Forward azimuth from (lon1, lat1) to (lon2, lat2) in degrees.
 * Returns 0–360 (0 = North, 90 = East, 180 = South, 270 = West).
 */
export function calculateBearing(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  return calculateBearingCore(lat1, lon1, lat2, lon2);
}

/**
 * Change in heading from bearingIn to bearingOut, in degrees.
 * Range: -180 to 180. Positive = right turn, negative = left turn.
 */
export function getTurnAngle(bearingIn: number, bearingOut: number): number {
  let diff = (bearingOut - bearingIn + 360) % 360;
  return diff <= 180 ? diff : diff - 360;
}

/**
 * Grade percentage from A to B: ((elevB - elevA) / distanceM) * 100.
 * Returns 0 if distanceM < 1.0 to avoid extreme spikes from tiny segments.
 */
export function gradePercent(
  elevA: number,
  elevB: number,
  distanceM: number,
): number {
  if (distanceM < 1.0) return 0;
  return ((elevB - elevA) / distanceM) * 100;
}

/**
 * Fuel cost multiplier from grade. 0% grade → 1.0.
 * Uphill: mult = 1.0 + (gradePct * 0.1). Downhill: mult = 1.0 + (gradePct * 0.04).
 * Clamped from below by minMultiplier.
 */
export function fuelMultiplier(
  gradePct: number,
  minMultiplier: number = 0.5,
): number {
  const mult =
    gradePct >= 0 ? 1.0 + gradePct * 0.1 : 1.0 + gradePct * 0.04;
  return Math.max(minMultiplier, mult);
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

/** Coords as [lon, lat] or [lon, lat, z]. */
export type Coord = number[];

export interface RoutingCostPlugin {
  /**
   * Bulk pre-process nodes (e.g. sample DEM). TS implementation typically no-op;
   * elevations come from coords[2]. Default: return {}.
   */
  preProcessNodes(coordsList: Coord[]): Record<number, Record<string, unknown>>;

  /**
   * Cost multiplier for the directed edge U -> V.
   * Base cost is multiplied by this (1.0 = no change).
   */
  calculateMultiplier(
    coordsU: Coord,
    coordsV: Coord,
    dataU: Record<string, unknown>,
    dataV: Record<string, unknown>,
    distanceM: number,
  ): number;

  /**
   * Cost multiplier for transitioning from edge (T -> U) to edge (U -> V).
   * Default: 1.0. Override for turn-dependent costs.
   */
  calculateTransitionMultiplier(
    coordsT: Coord,
    coordsU: Coord,
    coordsV: Coord,
  ): number;
}

function defaultPreProcessNodes(
  _coordsList: Coord[],
): Record<number, Record<string, unknown>> {
  return {};
}

function defaultTransitionMultiplier(
  _coordsT: Coord,
  _coordsU: Coord,
  _coordsV: Coord,
): number {
  return 1.0;
}

/** Base interface with defaults; implementors override what they need. */
export function createRoutingCostPlugin(
  impl: Partial<{
    preProcessNodes: RoutingCostPlugin["preProcessNodes"];
    calculateMultiplier: RoutingCostPlugin["calculateMultiplier"];
    calculateTransitionMultiplier: RoutingCostPlugin["calculateTransitionMultiplier"];
  }> & { calculateMultiplier: RoutingCostPlugin["calculateMultiplier"] },
): RoutingCostPlugin {
  return {
    preProcessNodes: impl.preProcessNodes ?? defaultPreProcessNodes,
    calculateMultiplier: impl.calculateMultiplier,
    calculateTransitionMultiplier:
      impl.calculateTransitionMultiplier ?? defaultTransitionMultiplier,
  };
}

// ---------------------------------------------------------------------------
// FuelAwarePlugin (elevation from coords[2])
// ---------------------------------------------------------------------------

export const FuelAwarePlugin: RoutingCostPlugin = createRoutingCostPlugin({
  preProcessNodes: () => ({}),

  calculateMultiplier(
    coordsU: Coord,
    coordsV: Coord,
    _dataU: Record<string, unknown>,
    _dataV: Record<string, unknown>,
    distanceM: number,
  ): number {
    const zU = coordsU[2] ?? 0;
    const zV = coordsV[2] ?? 0;
    const g = gradePercent(zU as number, zV as number, distanceM);
    return fuelMultiplier(g, 0.5);
  },
});

// ---------------------------------------------------------------------------
// TurnPenaltyPlugin (UPS-style: left and U-turn penalties)
// ---------------------------------------------------------------------------

const STRAIGHT_DEG = 45;

export function createTurnPenaltyPlugin(options?: {
  straightMult?: number;
  rightMult?: number;
  leftMult?: number;
  uTurnMult?: number;
  straightDeg?: number;
}): RoutingCostPlugin {
  const straightMult = options?.straightMult ?? 1.0;
  const rightMult = options?.rightMult ?? 1.0;
  const leftMult = options?.leftMult ?? 1.4;
  const uTurnMult = options?.uTurnMult ?? 20.0;
  const straightDeg = options?.straightDeg ?? STRAIGHT_DEG;

  return createRoutingCostPlugin({
    preProcessNodes: () => ({}),
    calculateMultiplier: () => 1.0,

    calculateTransitionMultiplier(
      coordsT: Coord,
      coordsU: Coord,
      coordsV: Coord,
    ): number {
      const lonT = coordsT[0] ?? 0;
      const latT = coordsT[1] ?? 0;
      const lonU = coordsU[0] ?? 0;
      const latU = coordsU[1] ?? 0;
      const lonV = coordsV[0] ?? 0;
      const latV = coordsV[1] ?? 0;
      const bearingIn = calculateBearing(lonT, latT, lonU, latU);
      const bearingOut = calculateBearing(lonU, latU, lonV, latV);
      const angle = getTurnAngle(bearingIn, bearingOut);

      if (-straightDeg <= angle && angle <= straightDeg) return straightMult;
      if (45 <= angle && angle <= 135) return rightMult;
      if (-135 <= angle && angle <= -45) return leftMult;
      return uTurnMult;
    },
  });
}

/** Default turn penalty plugin instance. */
export const TurnPenaltyPlugin = createTurnPenaltyPlugin();
