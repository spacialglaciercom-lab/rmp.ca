/**
 * Route Solver Service
 *
 * Step 4 of route planning workflow:
 * - Solve TSP/CVRP using local heuristic or server-side pgRouting
 * - Support multiple algorithms (nearest neighbor, 2-opt, Christofides)
 * - Handle time windows and capacity constraints
 */

import { RouteOptimizerModule } from "../modules/route-optimizer";

import { trpc } from "./trpc";
import {
  estimateRouteStats,
  solveLocal,
  type SolverOptions,
  type SolverPoint,
  type SolverResult,
} from "./routeSolverLocal";

export type { SolverOptions, SolverPoint, SolverResult };
export { estimateRouteStats, solveLocal };

export async function solveNative(
  points: SolverPoint[],
  options: SolverOptions = { algorithm: "2-opt" },
): Promise<SolverResult> {
  try {
    const rawOptions = {
      algorithm: options.algorithm,
      returnToDepot: options.returnToDepot,
      maxIterations: 100, // Defaulting to 100
    };

    let depotIndex = null;
    let allPoints = points;
    if (options.depot) {
      depotIndex = 0;
      allPoints = [options.depot, ...points];
    }

    const nativePoints = allPoints.map(p => ({
      id: p.id,
      lat: p.lat,
      lon: p.lon,
      demand: p.demand,
      serviceTime: p.serviceTime
    }));

    // The native module expects 'algorithm' to be either 'nearest-neighbor' or '2-opt'
    const alg = (options.algorithm === '2-opt' || options.algorithm === 'nearest-neighbor') ? options.algorithm : '2-opt';

    const result = await RouteOptimizerModule.solveRoute(
      nativePoints,
      depotIndex,
      { ...rawOptions, algorithm: alg }
    );

    // Map orderedIds back to orderedPoints
    const pointMap = new Map(allPoints.map(p => [p.id, p]));
    const orderedPoints = result.orderedIds.map(id => pointMap.get(id)!).filter(Boolean);

    return {
      orderedPoints,
      totalDistance: result.totalDistanceM,
      totalDuration: result.totalDurationS,
      segments: result.segments.map(s => ({
        from: s.fromId,
        to: s.toId,
        distance: s.distanceM,
        duration: s.durationS
      })),
      algorithm: result.algorithm,
      solveTime: result.solveTimeMs
    };
  } catch (error) {
    console.error("Native solver failed, falling back to local JS:", error);
    return solveLocal(points, options);
  }
}


/**
 * Server-side solver using pgRouting or VROOM
 * Requires network connectivity and backend service
 */
export async function solveServer(
  points: SolverPoint[],
  options: SolverOptions = { algorithm: "pgrouting" },
): Promise<SolverResult> {
  const startTime = Date.now();

  try {
    const response = await trpc.spatial.solveTSP.mutate({
      points: points.map((p) => ({
        id: p.id,
        lat: p.lat,
        lon: p.lon,
        demand: p.demand,
        serviceTime: p.serviceTime,
        timeWindowStart: p.timeWindow?.start,
        timeWindowEnd: p.timeWindow?.end,
      })),
      depot: options.depot
        ? {
            id: options.depot.id,
            lat: options.depot.lat,
            lon: options.depot.lon,
          }
        : undefined,
      algorithm: options.algorithm,
      vehicleCapacity: options.vehicleCapacity,
      returnToDepot: options.returnToDepot,
    });

    const orderedPoints = response.order.map((idx: number) => points[idx]);

    return {
      orderedPoints,
      totalDistance: response.totalDistance,
      totalDuration: response.totalDuration,
      segments: response.segments,
      algorithm: response.algorithm,
      solveTime: Date.now() - startTime,
    };
  } catch (error) {
    console.error("Server solver failed, falling back to local:", error);
    return solveLocal(points, { ...options, algorithm: "2-opt" });
  }
}

/**
 * Main solver function - chooses local or server based on options
 */
export async function solveRoute(
  points: SolverPoint[],
  options: SolverOptions = { algorithm: "2-opt" },
): Promise<SolverResult> {
  if (options.algorithm === "pgrouting" || options.algorithm === "vroom") {
    return solveServer(points, options);
  }

  if (RouteOptimizerModule && typeof RouteOptimizerModule.solveRoute === 'function') {
    return solveNative(points, options);
  }

  return solveLocal(points, options);
}
