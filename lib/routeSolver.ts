/**
 * Route Solver Service
 *
 * Step 4 of route planning workflow:
 * - Solve TSP/CVRP using local heuristic or server-side pgRouting
 * - Support multiple algorithms (nearest neighbor, 2-opt, Christofides)
 * - Handle time windows and capacity constraints
 */
import { trpc } from "./trpc";
import {
  estimateRouteStats,
  solveLocal,
  type SolverOptions,
  type SolverPoint,
  type SolverResult,
} from "./routeSolverLocal";
import { RouteOptimizerModule, type CppSolverOptions } from "@/modules/route-optimizer";

export type { SolverOptions, SolverPoint, SolverResult };
export { estimateRouteStats, solveLocal };

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
 * Chinese Postman Problem (CPP) native solver using Rust UniFFI.
 * Requires the raw GeoJSON string of the route network.
 */
export async function solveCppRoute(
  geojsonStr: string,
  options?: CppSolverOptions
): Promise<Omit<SolverResult, "orderedPoints"> & { orderedIds: string[] }> {
  try {
    if (!RouteOptimizerModule) {
      throw new Error("Native RouteOptimizerModule is not available");
    }

    const start = Date.now();
    const result = await RouteOptimizerModule.solveCppFromGeojson(geojsonStr, options || { startNode: undefined });

    // Convert Rust keys (orderedIds, totalDistanceM, etc.) to JS keys
    return {
      orderedIds: result.orderedIds,
      totalDistance: result.totalDistanceM,
      totalDuration: result.totalDurationS,
      segments: result.segments.map((s: any) => ({
        from: s.fromId,
        to: s.toId,
        distance: s.distanceM,
        duration: s.durationS,
      })),
      algorithm: result.algorithm,
      solveTime: Date.now() - start,
    };
  } catch (error) {
    console.error("Failed to solve CPP via native module:", error);
    throw error;
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

  return solveLocal(points, options);
}
