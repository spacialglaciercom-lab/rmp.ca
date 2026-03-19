/** Shared types for the VRP solver plugin system. */

export interface VRPSolverStop {
  lat: number;
  lon: number;
  label: string;
  /** Per-stop demand (units/kg). Parsed from 4th column of coordinates input. */
  demand?: number;
  /** Estimated arrival time at this stop (Unix epoch seconds). VROOM only. */
  arrivalTime?: number;
}

export interface VRPSolverRouteStats {
  /** Total distance for this route in metres. */
  distance: number;
  /** Total driving + service duration for this route in seconds. */
  duration: number;
}

export type DistMatrix = { distance: number; time: number }[][];

export interface VRPSolverInput {
  /** All locations. Depot is index 0. */
  locations: VRPSolverStop[];
  numVehicles: number;
  vehicleCapacity: number;
  objective: "min_time" | "min_distance" | "balance_load" | "min_vehicles";
  /** Pre-built distance/time matrix. Required by local solvers (requiresMatrix === true). */
  matrix?: DistMatrix;
  // VROOM-specific extras (ignored by local solvers)
  /** Per-stop service time in seconds. */
  serviceTimeSecs?: number;
  /** Whether shift time windows are enabled. */
  useTimeWindows?: boolean;
  /** Shift open epoch (Unix seconds). */
  windowOpen?: number;
  /** Shift close epoch (Unix seconds). */
  windowClose?: number;
}

export interface VRPRouteMetrics {
  physical_distance_m: number;
  adjusted_cost_m: number;
  elevation_gain_m: number;
  turns: { left: number; right: number; u_turn: number; straight: number };
}

export interface VRPSolverOutput {
  stops: VRPSolverStop[];
  routes?: VRPSolverStop[][];
  totalDistanceKm: string;
  totalTimeMin: number;
  routeStats?: VRPSolverRouteStats[];
  routeMetrics?: VRPRouteMetrics[];
  unassigned?: string[];
}

export interface VRPSolver {
  readonly id: string;
  readonly label: string;
  /** When true, VRPPlanner will build a distance matrix before calling solve(). */
  readonly requiresMatrix: boolean;
  solve(input: VRPSolverInput): Promise<VRPSolverOutput>;
}
