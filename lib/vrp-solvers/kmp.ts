/**
 * VRP solver that delegates to the Kotlin Multiplatform shared-logic module.
 * Requires: ./gradlew :shared-logic:assemble (builds shared-logic to build/js/packages/shared-logic).
 */

import type { VRPSolver, VRPSolverInput, VRPSolverOutput } from "./types";

export interface SharedLogicCvrpResult {
  stops: Array<{ lat: number; lon: number; label: string }>;
  routes: Array<Array<{ lat: number; lon: number; label: string }>>;
  totalDistanceKm: string;
  totalTimeMin: number;
}

declare const SharedLogicBridge: {
  solveCvrp(
    locations: Array<{ lat: number; lon: number; label: string }>,
    numVehicles: number,
    matrix: Array<Array<{ distance: number; time: number }>>,
  ): SharedLogicCvrpResult;
};

function getBridge(): typeof SharedLogicBridge | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("shared-logic");
    // Kotlin/JS exports as m.sharedlogic.SharedLogicBridge; stub or missing build throws
    return (
      m.sharedlogic?.SharedLogicBridge ??
      m.SharedLogicBridge ??
      m.default?.sharedlogic?.SharedLogicBridge ??
      m.default?.SharedLogicBridge ??
      m.default ??
      null
    );
  } catch {
    return null;
  }
}

export const kmpSolver: VRPSolver = {
  id: "kmp",
  label: "KMP (Clarke-Wright)",
  requiresMatrix: true,

  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const bridge = getBridge();
    if (!bridge) {
      throw new Error(
        "shared-logic not built. Run: ./gradlew :shared-logic:assemble",
      );
    }
    const matrix = input.matrix;
    if (!matrix) {
      throw new Error("KMP solver requires a pre-built distance matrix.");
    }
    const locations = input.locations.map((loc) => ({
      lat: loc.lat,
      lon: loc.lon,
      label: loc.label,
    }));
    const matrixJs = matrix.map((row) =>
      row.map((cell) => ({ distance: cell.distance, time: cell.time })),
    );
    const result = bridge.solveCvrp(
      locations,
      input.numVehicles,
      matrixJs,
    ) as SharedLogicCvrpResult & {
      stops_1?: { array_1?: Array<{ lat_1: number; lon_1: number; label_1: string }> };
      routes_1?: { array_1?: Array<{ array_1?: Array<{ lat_1: number; lon_1: number; label_1: string }> }> };
      totalDistanceKm_1?: string;
      totalTimeMin_1?: number;
    };
    // Kotlin/JS exports use _1 suffix (stops_1, routes_1, lat_1, etc.); support both shapes
    const stopsRaw = result.stops_1?.array_1 ?? result.stops;
    const routesRaw = result.routes_1?.array_1 ?? result.routes;
    const toStop = (s: { lat?: number; lon?: number; label?: string; lat_1?: number; lon_1?: number; label_1?: string }) => ({
      lat: s.lat_1 ?? s.lat ?? 0,
      lon: s.lon_1 ?? s.lon ?? 0,
      label: s.label_1 ?? s.label ?? "",
    });
    const stops = Array.isArray(stopsRaw)
      ? stopsRaw.map(toStop)
      : (stopsRaw as unknown as Array<unknown>)?.map?.((s) => toStop(s as Record<string, unknown>)) ?? [];
    const routes = Array.isArray(routesRaw)
      ? routesRaw.map((route) => {
          const arr = (route as { array_1?: unknown[] })?.array_1 ?? (Array.isArray(route) ? route : []);
          return arr.map((s) => toStop(s as Record<string, unknown>));
        })
      : undefined;
    return {
      stops,
      routes: routes && routes.length > 1 ? routes : undefined,
      totalDistanceKm: result.totalDistanceKm_1 ?? result.totalDistanceKm ?? "0",
      totalTimeMin: result.totalTimeMin_1 ?? result.totalTimeMin ?? 0,
    };
  },
};
