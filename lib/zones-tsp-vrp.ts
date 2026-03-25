/**
 * Single-vehicle TSP-shaped solve via POST /api/vrp/solve/sync (OR-Tools VRP).
 * First included point is depot (start = end); remaining points are jobs.
 */
import { getApiBaseUrl } from "@/shared/oauth";

export interface TspPin {
  id: string;
  lat: number;
  lon: number;
}

export interface TspSolveSuccess {
  ok: true;
  /** Ordered path for polyline (depot → jobs in visit order → depot). */
  routePoints: { lat: number; lon: number }[];
  totalDistanceMeters: number;
  /** Backend aggregate duration (solver units; typically seconds). */
  totalDuration: number;
  optimizedSequenceCount: number;
}

export interface TspSolveError {
  ok: false;
  message: string;
}

export type TspSolveResult = TspSolveSuccess | TspSolveError;

interface VrpStop {
  id: number;
  location: { lat: number; lon: number };
  demand: number[];
}

interface VrpVehicle {
  id: number;
  start_location: { lat: number; lon: number };
  end_location: { lat: number; lon: number };
  capacity: number[];
}

interface VrpResponse {
  routes: {
    vehicle_id: number;
    steps: {
      type: string;
      id?: number;
      location: { lat: number; lon: number };
      distance?: number;
      duration?: number;
    }[];
    total_distance: number;
    total_duration: number;
  }[];
  total_distance: number;
  total_duration: number;
  unassigned: number[];
}

/**
 * Run synchronous VRP for one closed vehicle route (TSP-style).
 * @param included Pins to visit (first = depot / start-end).
 */
export async function solveZonesTsp(included: TspPin[]): Promise<TspSolveResult> {
  if (included.length === 0) {
    return { ok: false, message: "No points to optimize." };
  }
  if (included.length === 1) {
    const p = included[0]!;
    return {
      ok: true,
      routePoints: [{ lat: p.lat, lon: p.lon }],
      totalDistanceMeters: 0,
      totalDuration: 0,
      optimizedSequenceCount: 1,
    };
  }

  const depot = included[0]!;
  const jobs = included.slice(1);
  const stops: VrpStop[] = jobs.map((p, i) => ({
    id: i + 1,
    location: { lat: p.lat, lon: p.lon },
    demand: [0],
  }));

  const body = {
    stops,
    vehicles: [
      {
        id: 0,
        start_location: { lat: depot.lat, lon: depot.lon },
        end_location: { lat: depot.lat, lon: depot.lon },
        capacity: [1_000_000],
      },
    ],
    use_time_windows: false,
    objective: "min_distance" as const,
  };

  const base = getApiBaseUrl().replace(/\/$/, "");
  const url = `${base}/api/vrp/solve/sync`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg || "Network error" };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      message: `TSP request failed (${res.status}): ${text || res.statusText}`,
    };
  }

  let data: VrpResponse;
  try {
    data = (await res.json()) as VrpResponse;
  } catch {
    return { ok: false, message: "Invalid JSON from optimizer." };
  }

  const route = data.routes?.[0];
  if (!route?.steps?.length) {
    return {
      ok: false,
      message: "Optimizer returned no route.",
    };
  }

  const jobSteps = route.steps.filter((s) => s.type === "job" && s.id != null);
  const orderedJobs = jobSteps
    .map((s) => {
      const stop = stops.find((st) => st.id === s.id);
      return stop
        ? { lat: stop.location.lat, lon: stop.location.lon }
        : { lat: s.location.lat, lon: s.location.lon };
    })
    .filter(Boolean) as { lat: number; lon: number }[];

  const routePoints: { lat: number; lon: number }[] = [
    { lat: depot.lat, lon: depot.lon },
    ...orderedJobs,
    { lat: depot.lat, lon: depot.lon },
  ];

  const totalDistanceMeters = Number(data.total_distance ?? route.total_distance ?? 0);
  const totalDuration = Number(data.total_duration ?? route.total_duration ?? 0);

  return {
    ok: true,
    routePoints,
    totalDistanceMeters,
    totalDuration,
    optimizedSequenceCount: jobSteps.length,
  };
}
