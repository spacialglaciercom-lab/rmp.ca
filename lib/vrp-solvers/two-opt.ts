/**
 * 2-Opt VRP: sweep construction + per-route 2-opt improvement.
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

  const depot = locations[0]!;
  const stopIndices = Array.from({ length: n - 1 }, (_, i) => i + 1);
  stopIndices.sort((a, b) => {
    const la = locations[a]!;
    const lb = locations[b]!;
    return (
      Math.atan2(la.lat - depot.lat, la.lon - depot.lon) -
      Math.atan2(lb.lat - depot.lat, lb.lon - depot.lon)
    );
  });

  const perRoute = Math.ceil(stopIndices.length / numVehicles);
  const routes: number[][] = [];
  for (let v = 0; v < numVehicles; v++) {
    const segment = stopIndices.slice(v * perRoute, (v + 1) * perRoute);
    if (segment.length === 0) continue;
    const route: number[] = [0];
    const rem = new Set(segment);
    let cur = 0;
    while (rem.size > 0) {
      let best = -1;
      let bestDist = Infinity;
      for (const node of rem) {
        const dist = d(cur, node);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
      if (best < 0) break;
      rem.delete(best);
      route.push(best);
      cur = best;
    }
    route.push(0);
    routes.push(route);
  }

  for (let ri = 0; ri < routes.length; ri++) {
    let improved = true;
    while (improved) {
      improved = false;
      const r = routes[ri]!;
      for (let i = 1; i < r.length - 2; i++) {
        for (let k = i + 1; k < r.length - 1; k++) {
          const delta =
            d(r[i - 1]!, r[k]!) +
            d(r[i]!, r[k + 1]!) -
            d(r[i - 1]!, r[i]!) -
            d(r[k]!, r[k + 1]!);
          if (delta < -1e-9) {
            let lo = i;
            let hi = k;
            while (lo < hi) {
              const tmp = r[lo]!;
              r[lo] = r[hi]!;
              r[hi] = tmp;
              lo++;
              hi--;
            }
            improved = true;
          }
        }
      }
    }
  }

  const finalRoutes = routes.filter((r) => r.length > 2);
  if (finalRoutes.length === 0)
    return { routes: [[0, 0]], totalDistance: 0, totalTime: 0 };

  let totalDistance = 0;
  let totalTime = 0;
  for (const r of finalRoutes) {
    for (let i = 0; i < r.length - 1; i++) {
      totalDistance += d(r[i]!, r[i + 1]!);
      totalTime += t(r[i]!, r[i + 1]!);
    }
  }
  return { routes: finalRoutes, totalDistance, totalTime };
}

export const twoOptSolver: VRPSolver = {
  id: "two_opt",
  label: "2-Opt (route untangling)",
  requiresMatrix: true,

  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const matrix = input.matrix!;
    const { routes: routeIndices, totalDistance, totalTime } = solve(
      matrix,
      input.locations,
      input.numVehicles,
    );
    const routes = routeIndices.map((r) => r.map((i) => input.locations[i]!));
    return {
      stops: routes.flat(),
      routes: routes.length > 1 ? routes : undefined,
      totalDistanceKm: totalDistance.toFixed(2),
      totalTimeMin: Math.round(totalTime / 60),
    };
  },
};
