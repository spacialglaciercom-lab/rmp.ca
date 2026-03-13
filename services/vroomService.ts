/**
 * VROOM service — client for the VROOM-Express VRP solver.
 *
 * VROOM (Vehicle Routing Open-source Optimization Machine) solves CVRP,
 * VRPTW, PDPTW, and related problems. This service wraps the VROOM REST API
 * exposed by vroom-express (POST /) via the Node.js proxy at
 * /api/vroom/optimize.
 *
 * API reference: https://github.com/VROOM-Project/vroom/blob/master/docs/API.md
 */

import { getApiBaseUrl } from "@/shared/oauth";

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface VroomJob {
  /** Unique positive integer ID. */
  id: number;
  /** Location as [longitude, latitude]. */
  location: [number, number];
  /** Service time at this stop in seconds (default 0). */
  service?: number;
  /** Optional time windows [[earliest, latest]] in Unix epoch seconds. */
  time_windows?: [number, number][];
  /** Delivery demand (one value per capacity dimension). */
  delivery?: number[];
  /** Human-readable label forwarded in the response. */
  description?: string;
}

export interface VroomShipment {
  pickup: Omit<VroomJob, "delivery">;
  delivery: Omit<VroomJob, "delivery">;
}

export interface VroomVehicle {
  /** Unique positive integer ID. */
  id: number;
  /** Start location [longitude, latitude] (depot). */
  start: [number, number];
  /** Return location; defaults to start if omitted. */
  end?: [number, number];
  /** Vehicle capacity (one value per dimension). */
  capacity?: number[];
  /** Shift time window [start, end] in Unix epoch seconds. */
  time_window?: [number, number];
}

export interface VroomRequest {
  jobs: VroomJob[];
  vehicles: VroomVehicle[];
  shipments?: VroomShipment[];
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface VroomStep {
  type: "start" | "job" | "pickup" | "delivery" | "end";
  id?: number;
  location?: [number, number];
  arrival: number;
  duration: number;
  service?: number;
  description?: string;
}

export interface VroomRoute {
  vehicle: number;
  steps: VroomStep[];
  cost: number;
  duration: number;
  distance: number;
}

export interface VroomUnassigned {
  id: number;
  type?: "job" | "pickup" | "delivery";
  location?: [number, number];
  description?: string;
}

export interface VroomSummary {
  cost: number;
  routes: number;
  unassigned: number;
  duration: number;
  distance: number;
  computing_times?: { loading: number; solving: number };
}

export interface VroomResponse {
  routes: VroomRoute[];
  unassigned: VroomUnassigned[];
  summary: VroomSummary;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

/**
 * Call the VROOM solver via the Node.js proxy at /api/vroom/optimize.
 * Throws on HTTP error or network failure.
 */
export async function solveWithVroom(
  request: VroomRequest,
  timeoutMs = 30_000,
): Promise<VroomResponse> {
  const base = getApiBaseUrl();
  const url = `${base.replace(/\/$/, "")}/api/vroom/optimize`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`VROOM solver returned ${res.status}: ${text}`);
  }

  return res.json() as Promise<VroomResponse>;
}
