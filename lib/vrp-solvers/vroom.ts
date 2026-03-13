/**
 * VROOM solver plugin — wraps the vroom-express REST API.
 * Handles CVRP and VRPTW; does NOT require a local distance matrix.
 */

import type { VRPSolver, VRPSolverInput, VRPSolverOutput, VRPSolverStop } from "./types";
import {
  solveWithVroom,
  type VroomJob,
  type VroomVehicle,
} from "@/services/vroomService";

export const vroomSolver: VRPSolver = {
  id: "vroom",
  label: "VROOM (server-optimized, CVRP/VRPTW)",
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
    if (!depot) throw new Error("VROOM: no depot location");

    const jobs: VroomJob[] = locations.slice(1).map((loc, i) => {
      const job: VroomJob = {
        id: i + 1,
        location: [loc.lon, loc.lat],
        service: serviceTimeSecs,
        delivery: [loc.demand ?? 1],
        description: loc.label,
      };
      if (useTimeWindows && windowOpen != null && windowClose != null) {
        job.time_windows = [[windowOpen, windowClose]];
      }
      return job;
    });

    const vehicles: VroomVehicle[] = Array.from(
      { length: numVehicles },
      (_, vi) => {
        const v: VroomVehicle = {
          id: vi + 1,
          start: [depot.lon, depot.lat],
          end: [depot.lon, depot.lat],
          capacity: [vehicleCapacity],
        };
        if (useTimeWindows && windowOpen != null && windowClose != null) {
          v.time_window = [windowOpen, windowClose];
        }
        return v;
      },
    );

    const vroomRes = await solveWithVroom({ jobs, vehicles });

    const routes: VRPSolverStop[][] = vroomRes.routes
      .map((r): VRPSolverStop[] => {
        return r.steps
          .filter((s) => s.type === "job" && s.id != null)
          .map((s): VRPSolverStop | null => {
            const j = jobs[s.id! - 1];
            return j
              ? {
                  lon: j.location[0],
                  lat: j.location[1],
                  label: j.description ?? `Stop ${s.id}`,
                  demand: j.delivery?.[0],
                  arrivalTime: s.arrival > 0 ? s.arrival : undefined,
                }
              : null;
          })
          .filter((x): x is VRPSolverStop => x !== null);
      })
      .filter((r) => r.length > 0);

    const routeStats = vroomRes.routes.map((r) => ({
      distance: r.distance,
      duration: r.duration,
    }));

    const unassigned = vroomRes.unassigned
      .map((u) => {
        const j = jobs.find((jb) => jb.id === u.id);
        return j?.description ?? `Job #${u.id}`;
      })
      .filter(Boolean) as string[];

    return {
      stops: routes.flat(),
      routes: routes.length > 1 ? routes : undefined,
      totalDistanceKm: (vroomRes.summary.distance / 1000).toFixed(2),
      totalTimeMin: Math.round(vroomRes.summary.duration / 60),
      routeStats,
      unassigned: unassigned.length > 0 ? unassigned : undefined,
    };
  },
};
