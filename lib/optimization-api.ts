/**
 * Types and API client for Trash Collection Router optimization API.
 * Supports CPP Standard and MC-CARP Hybrid algorithms.
 */

export type AlgorithmType = "cpp_standard" | "mc_carp_hybrid";

export interface VehicleConstraints {
  capacity_kg: number;
  max_route_duration_minutes: number;
  depot_node_id: string;
  average_service_speed_kmh: number;
}

export type WaypointType = "depot_start" | "service" | "deadhead" | "depot_end";

export interface Waypoint {
  type: WaypointType;
  node?: string;
  edge?: string;
  demand_kg?: number;
  path?: string[];
  reason?: string;
}

export interface Route {
  route_id: string;
  edges: string[];
  distance_km: number;
  demand_kg: number;
  capacity_utilization: number;
  estimated_duration_min: number;
  deadhead_distance_km: number;
  waypoints: Waypoint[];
}

export interface OptimizationResult {
  algorithm_used: AlgorithmType;
  total_distance_km: number;
  routes: Route[];
  unassigned_edges: string[];
  metrics: {
    total_deadhead_km: number;
    average_capacity_utilization: number;
    vehicles_required: number;
    total_demand_kg: number;
    min_trucks_theoretical: number;
    [key: string]: unknown;
  };
  debug_trace?: Array<{
    seq: number;
    elapsed_ms: number;
    event: string;
    data: Record<string, unknown>;
  }>;
}

export interface OptimizationRequest {
  algorithm: AlgorithmType;
  vehicle_constraints?: VehicleConstraints;
  osm_data?: unknown;
  required_edges?: string[];
  debug?: boolean;
}

export class OptimizationError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: unknown
  ) {
    super(message);
    this.name = "OptimizationError";
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Call POST /route/optimize on the Trash Collection Router API.
 */
export async function optimizeRoute(
  request: OptimizationRequest,
  baseUrl: string,
  options?: { timeoutMs?: number }
): Promise<OptimizationResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/route/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new OptimizationError(
        `Optimization failed (HTTP ${response.status})`,
        response.status,
        errorBody
      );
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof OptimizationError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new OptimizationError(
        `Request timed out after ${timeoutMs / 1000} seconds`,
        408,
        {}
      );
    }
    throw new OptimizationError(
      `Network error: ${(err as Error).message}`,
      0,
      {}
    );
  }
}
