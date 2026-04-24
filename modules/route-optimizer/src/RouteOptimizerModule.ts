import { NativeModule, requireNativeModule } from "expo-modules-core";

/** A stop the solver visits. */
export type SolverPoint = {
  id: string;
  lat: number;
  lon: number;
  demand?: number;
  serviceTime?: number;
};

export type SolverAlgorithm = "nearest-neighbor" | "2-opt";

export type SolverOptions = {
  algorithm: SolverAlgorithm;
  returnToDepot?: boolean;
  maxIterations?: number;
};

export type RouteSegment = {
  fromId: string;
  toId: string;
  distanceM: number;
  durationS: number;
};

export type SolverResult = {
  orderedIds: string[];
  totalDistanceM: number;
  totalDurationS: number;
  segments: RouteSegment[];
  algorithm: string;
  solveTimeMs: number;
};

declare class RouteOptimizerNativeModule extends NativeModule {
  /** Solve a TSP-style route with on-device Rust. */
  solveRoute(
    points: SolverPoint[],
    depotIndex: number | null,
    options: SolverOptions,
  ): Promise<SolverResult>;

  /** Great-circle distance in metres (sync, cheap). */
  haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number;
}

export default requireNativeModule<RouteOptimizerNativeModule>("RouteOptimizer");
