/**
 * Clarke-Wright Savings algorithm for VRP with balanced distribution.
 * Depot is index 0. Merges on highest savings first but caps route size so stops
 * are spread evenly across drivers; then force-merges smallest routes if needed.
 */

import type { VRPSolver, VRPSolverInput, VRPSolverOutput } from "./types";

function solve(
  matrix: { distance: number; time: number }[][],
  numVehicles: number,
): { routes: number[][]; totalDistance: number; totalTime: number } {
  const n = matrix.length;
  if (n <= 1) return { routes: [[0]], totalDistance: 0, totalTime: 0 };

  const d = (i: number, j: number) => matrix[i]?.[j]?.distance ?? 0;
  const t = (i: number, j: number) => matrix[i]?.[j]?.time ?? 0;

  const maxIntermediateStops = Math.ceil((n - 1) / numVehicles);
  const cap = maxIntermediateStops + 1;

  const savings: { i: number; j: number; s: number }[] = [];
  for (let i = 1; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = d(0, i) + d(0, j) - d(i, j);
      savings.push({ i, j, s });
    }
  }
  savings.sort((a, b) => b.s - a.s);

  let routes: number[][] = [];
  for (let i = 1; i < n; i++) routes.push([0, i, 0]);

  const findRoute = (node: number) => routes.findIndex((r) => r.includes(node));
  const intermediateCount = (r: number[]) => Math.max(0, r.length - 2);

  for (const { i, j } of savings) {
    if (routes.length <= numVehicles) break;
    const ri = findRoute(i);
    const rj = findRoute(j);
    if (ri < 0 || rj < 0 || ri === rj) continue;

    const ra = [...routes[ri]];
    const rb = [...routes[rj]];
    const endOfA = ra[ra.length - 2];
    const startOfB = rb[1];
    const merged =
      endOfA === i && startOfB === j
        ? ra.slice(0, -1).concat(rb.slice(1))
        : endOfA === j && startOfB === i
          ? ra.slice(0, -1).concat(rb.slice(1))
          : (() => {
              const raRev = [...ra].reverse();
              const rbRev = [...rb].reverse();
              if (raRev[raRev.length - 2] === i && rbRev[1] === j)
                return raRev.slice(0, -1).concat(rbRev.slice(1));
              if (raRev[raRev.length - 2] === j && rbRev[1] === i)
                return raRev.slice(0, -1).concat(rbRev.slice(1));
              return null;
            })();
    if (!merged) continue;
    if (intermediateCount(merged) > cap) continue;

    routes = routes.filter((_, idx) => idx !== ri && idx !== rj);
    routes.push(merged);
  }

  while (routes.length > numVehicles) {
    let bestI = 0;
    let bestJ = 1;
    let bestMerged: number[] | null = null;
    let bestCost = Infinity;

    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const ra = routes[i];
        const rb = routes[j];
        const candidates: number[][] = [
          ra.slice(0, -1).concat(rb.slice(1)),
          ra.slice(0, -1).concat(rb.slice(1, -1).reverse(), [0]),
          [0].concat(ra.slice(1, -1).reverse(), rb.slice(1)),
          [0].concat(rb.slice(1, -1).reverse(), ra.slice(1)),
        ];
        for (const merged of candidates) {
          if (merged.length < 3) continue;
          let cost = 0;
          for (let k = 0; k < merged.length - 1; k++)
            cost += d(merged[k], merged[k + 1]);
          if (cost < bestCost) {
            bestCost = cost;
            bestI = i;
            bestJ = j;
            bestMerged = merged;
          }
        }
      }
    }

    if (bestMerged == null) break;
    routes = routes.filter((_, idx) => idx !== bestI && idx !== bestJ);
    routes.push(bestMerged);
  }

  let totalDistance = 0;
  let totalTime = 0;
  for (const r of routes) {
    for (let k = 0; k < r.length - 1; k++) {
      totalDistance += d(r[k], r[k + 1]);
      totalTime += t(r[k], r[k + 1]);
    }
  }
  return { routes, totalDistance, totalTime };
}

export const clarkeWrightSolver: VRPSolver = {
  id: "clarke_wright",
  label: "Clarke-Wright Savings",
  requiresMatrix: true,

  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const matrix = input.matrix!;
    const { routes: routeIndices, totalDistance, totalTime } = solve(
      matrix,
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
