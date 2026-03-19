/**
 * OR-Tools solver plugin.
 * Wraps the Python backend API at /api/vrp/solve.
 */

import type { VRPSolver, VRPSolverInput, VRPSolverOutput, VRPSolverStop, VRPRouteMetrics } from "./types";
import { getApiBaseUrl } from "@/shared/oauth";

interface VrpLocation {
  lat: number;
  lon: number;
}

interface VrpStop {
  id: number;
  location: VrpLocation;
  demand?: number[];
  time_window?: [number, number];
  service_duration?: number;
  label?: string;
}

interface VrpVehicle {
  id: number;
  start_location: VrpLocation;
  end_location?: VrpLocation;
  capacity?: number[];
  time_window?: [number, number];
}

interface VrpRequest {
  stops: VrpStop[];
  vehicles: VrpVehicle[];
  use_time_windows?: boolean;
  objective?: string;
}

interface VrpRouteStep {
  type: string;
  id?: number;
  location: VrpLocation;
  arrival: number;
  duration: number;
  wait: number;
  distance: number;
}

interface VrpRoute {
  vehicle_id: number;
  steps: VrpRouteStep[];
  total_distance: number;
  total_duration: number;
  metrics?: VRPRouteMetrics;
}

interface VrpResponse {
  routes: VrpRoute[];
  total_distance: number;
  total_duration: number;
  unassigned: number[];
}

export const ortoolsSolver: VRPSolver = {
  id: "ortools",
  label: "Google OR-Tools (Server)",
  requiresMatrix: false,

  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const {
      locations,
      numVehicles,
      vehicleCapacity,
      serviceTimeSecs = 0,
      useTimeWindows = false,
      windowOpen,
      windowClose,
    } = input;

    const depot = locations[0];
    if (!depot) throw new Error("OR-Tools: no depot location");

    // Map to VrpRequest
    const stops: VrpStop[] = locations.slice(1).map((loc, i) => ({
      id: i + 1,
      location: { lat: loc.lat, lon: loc.lon },
      demand: [loc.demand ?? 1],
      service_duration: serviceTimeSecs,
      time_window:
        useTimeWindows && windowOpen != null && windowClose != null
          ? [windowOpen, windowClose]
          : undefined,
      label: loc.label,
    }));

    const vehicles: VrpVehicle[] = Array.from(
      { length: numVehicles },
      (_, i) => ({
        id: i,
        start_location: { lat: depot.lat, lon: depot.lon },
        end_location: { lat: depot.lat, lon: depot.lon },
        capacity: [vehicleCapacity],
        time_window:
          useTimeWindows && windowOpen != null && windowClose != null
            ? [windowOpen, windowClose]
            : undefined,
      }),
    );

    const req: VrpRequest = {
      stops,
      vehicles,
      use_time_windows: useTimeWindows,
      objective: input.objective,
    };

    // Call Backend
    const base = getApiBaseUrl();
    const url = `${base.replace(/\/$/, "")}/api/vrp/solve`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch (networkErr) {
      const msg =
        networkErr instanceof Error ? networkErr.message : String(networkErr);
      const isOffline =
        /network request failed|failed to fetch|could not connect|connection refused|offline/i.test(msg) ||
        (networkErr instanceof TypeError && msg.includes("fetch"));
      throw new Error(
        isOffline
          ? "Backend offline or unreachable. Start the server (pnpm run dev:server). On a device, set EXPO_PUBLIC_API_BASE_URL to your computer's IP (e.g. http://192.168.1.5:3000) and ensure same Wi‑Fi."
          : `OR-Tools request failed: ${msg}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      if (res.status === 404) {
        throw new Error(
          `OR-Tools: API route not found (404). ` +
            `Ensure EXPO_PUBLIC_API_BASE_URL points to the Node server (e.g. http://localhost:3000 or 8082 if port 3000 is busy). ` +
            `On the Node server, set OPTIMIZER_BACKEND_URL to the Python backend (e.g. http://localhost:8000). Response: ${text}`,
        );
      }
      if (res.status === 503) {
        throw new Error(
          `OR-Tools: Optimizer not configured (503). ` +
            `On the Node server set OPTIMIZER_BACKEND_URL to the Python backend (e.g. http://localhost:8000). Response: ${text}`,
        );
      }
      throw new Error(`OR-Tools solver returned ${res.status}: ${text}`);
    }

    const data: VrpResponse = await res.json();

    // Transform response
    const routes = data.routes
      .map((r): VRPSolverStop[] => {
        return r.steps
          .filter((s) => s.type === "job" && s.id != null)
          .map((s): VRPSolverStop | null => {
            const originalStop = stops.find((job) => job.id === s.id);
            return originalStop
              ? {
                  lon: s.location.lon,
                  lat: s.location.lat,
                  label: originalStop.label ?? `Stop ${s.id}`,
                  demand: originalStop.demand?.[0],
                  arrivalTime: s.arrival > 0 ? s.arrival : undefined,
                }
              : null;
          })
          .filter((x): x is VRPSolverStop => x !== null);
      })
      .filter((r) => r.length > 0);

    const routeMetrics = data.routes
      .filter((r) => r.metrics != null)
      .map((r) => r.metrics as VRPRouteMetrics);

    return {
      stops: routes.flat(),
      routes: routes.length > 1 ? routes : undefined,
      totalDistanceKm: (data.total_distance / 1000).toFixed(2),
      // Fallback if backend doesn't calc duration perfectly yet
      totalTimeMin: Math.round(data.total_duration / 60) || Math.round(data.total_distance / 10 / 60),
      routeMetrics: routeMetrics.length > 0 ? routeMetrics : undefined,
    };
  },
};
