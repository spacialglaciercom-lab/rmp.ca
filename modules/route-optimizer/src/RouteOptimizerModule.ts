import { requireNativeModule } from "expo-modules-core";

export interface SolverPoint {
  id: string;
  lat: number;
  lon: number;
  demand?: number;
  serviceTime?: number;
}

export type SolverAlgorithm = "nearest-neighbor" | "2-opt";

export interface SolverOptions {
  algorithm: SolverAlgorithm;
  returnToDepot?: boolean;
  maxIterations?: number;
}

export interface CppSolverOptions {
  startNode?: string;
}

export interface RouteSegment {
  fromId: string;
  toId: string;
  distanceM: number;
  durationS: number;
}

export interface SolverResult {
  orderedIds: string[];
  totalDistanceM: number;
  totalDurationS: number;
  segments: RouteSegment[];
  algorithm: string;
  solveTimeMs: number;
}

export interface NativeRouteOptimizerModule {
  solveRoute(
    points: SolverPoint[],
    depotIndex: number | null,
    options: SolverOptions
  ): Promise<SolverResult>;

  solveCppFromGeojson(
    geojsonStr: string,
    options: CppSolverOptions
  ): Promise<SolverResult>;

  haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number;
}

export default requireNativeModule<NativeRouteOptimizerModule>("RouteOptimizer");
