/**
 * Sweep algorithm: partition stops by angle from depot into even sectors,
 * then order each sector with nearest-neighbor.
 */

import type { VRPSolver, VRPSolverInput, VRPSolverOutput, VRPSolverStop } from "./types";

function solve(
  matrix: { distance: number; time: number }[][],
  locations: VRPSolverStop[],
  numVehicles: number,
): { routes: number[][]; totalDistance: number; totalTime: number } {
  const n = matrix.length;
  if (n <= 1) return { routes: [[0]], totalDistance: 0, totalTime: 0 };

  const d = (i: number, j: number) => matrix[i]?.[j]?.distance ?? 0;
  const t = (i: number, j: number) => matrix[i]?.[j]?.time ?? 0;
  const depot = locations[0];
  if (!depot) return { routes: [[0]], totalDistance: 0, totalTime: 0 };

  const indices = Array.from({ length: n - 1 }, (_, i) => i + 1);
  indices.sort((a, b) => {
    const la = locations[a];
    const lb = locations[b];
    if (!la || !lb) return 0;
    const angleA = Math.atan2(la.lat - depot.lat, la.lon - depot.lon);
    const angleB = Math.atan2(lb.lat - depot.lat, lb.lon - depot.lon);
    return angleA - angleB;
  });

  const perRoute = Math.ceil(indices.length / numVehicles);
  const routeIndices: number[][] = [];
  for (let v = 0; v < numVehicles; v++) {
    const segment = indices.slice(
      v * perRoute,
      Math.min((v + 1) * perRoute, indices.length),
    );
    if (segment.length === 0) continue;
    const route: number[] = [0];
    const remaining = new Set(segment);
    let current = 0;
    while (remaining.size > 0) {
      let best = -1;
      let bestDist = Infinity;
      for (const node of remaining) {
        const dist = d(current, node);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
      if (best < 0) break;
      remaining.delete(best);
      route.push(best);
      current = best;
    }
    route.push(0);
    routeIndices.push(route);
  }

  let totalDistance = 0;
  let totalTime = 0;
  for (const r of routeIndices) {
    for (let k = 0; k < r.length - 1; k++) {
      totalDistance += d(r[k], r[k + 1]);
      totalTime += t(r[k], r[k + 1]);
    }
  }
  return { routes: routeIndices, totalDistance, totalTime };
}

export const sweepSolver: VRPSolver = {
  id: "sweep",
  label: "Sweep (balanced sectors)",
  requiresMatrix: true,

  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const matrix = input.matrix!;
    const { routes: routeIndices, totalDistance, totalTime } = solve(
      matrix,
      input.locations,
      input.numVehicles,
    );
    const routes = routeIndices.map((r) => r.map((i) => input.locations[i]));
    return {
      stops: routes.flat(),
      routes: routes.length > 1 ? routes : undefined,
      totalDistanceKm: totalDistance.toFixed(2),
      totalTimeMin: Math.round(totalTime / 60),
    };
  },
};
