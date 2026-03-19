/**
 * Or-Opt: sweep construction + iterative relocation of chains of 1-3 consecutive
 * stops to the best position across all routes. Accepts first improving move each
 * pass and restarts until no improvement.
 */

import type { VRPSolver, VRPSolverInput, VRPSolverOutput, VRPSolverStop } from "./types";

function solve(
  matrix: { distance: number; time: number }[][],
  locations: VRPSolverStop[],
  numVehicles: number,
  balanceLoad: boolean = false,
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

  const intermediateCount = (r: number[]) => Math.max(0, r.length - 2);

  let improved = true;
  const MAX_PASSES = 100;
  let passes = 0;

  while (improved && passes < MAX_PASSES) {
    improved = false;
    passes++;

    outer: for (let ri = 0; ri < routes.length; ri++) {
      const routeA = routes[ri]!;
      if (routeA.length < 3) continue;

      for (let k = 1; k <= 3; k++) {
        for (let pos = 1; pos + k <= routeA.length - 1; pos++) {
          const chainFirst = routeA[pos]!;
          const chainLast = routeA[pos + k - 1]!;
          const prev = routeA[pos - 1]!;
          const next = routeA[pos + k]!;

          const removeGain =
            d(prev, chainFirst) + d(chainLast, next) - d(prev, next);

          let bestGain = 1e-9;
          let bestRj = -1;
          let bestIns = -1;
          let bestRev = false;

          for (let rj = 0; rj < routes.length; rj++) {
            const routeB = routes[rj]!;
            for (let ins = 0; ins < routeB.length - 1; ins++) {
              if (rj === ri && ins >= pos - 1 && ins < pos + k) continue;

              const a = routeB[ins]!;
              const b = routeB[ins + 1]!;

              const costFwd = d(a, chainFirst) + d(chainLast, b) - d(a, b);
              if (removeGain - costFwd > bestGain) {
                bestGain = removeGain - costFwd;
                bestRj = rj;
                bestIns = ins;
                bestRev = false;
              }

              if (k > 1) {
                const costRev = d(a, chainLast) + d(chainFirst, b) - d(a, b);
                if (removeGain - costRev > bestGain) {
                  bestGain = removeGain - costRev;
                  bestRj = rj;
                  bestIns = ins;
                  bestRev = true;
                }
              }
            }
          }

          if (bestRj < 0) continue;

          if (balanceLoad && bestRj !== ri) {
            const routeB = routes[bestRj]!;
            const newCountA = intermediateCount(routeA) - k;
            const newCountB = intermediateCount(routeB) + k;
            const counts = routes.map((r, idx) => {
              if (idx === ri) return newCountA;
              if (idx === bestRj) return newCountB;
              return intermediateCount(r);
            });
            const maxC = Math.max(...counts);
            const minC = Math.min(...counts);
            if (maxC - minC > 1) continue;
          }

          improved = true;
          const chain = routeA.slice(pos, pos + k);
          const insertChain = bestRev ? [...chain].reverse() : chain;

          if (bestRj === ri) {
            const r = [...routeA];
            r.splice(pos, k);
            const adjIns = bestIns >= pos ? bestIns - k : bestIns;
            r.splice(adjIns + 1, 0, ...insertChain);
            routes[ri] = r;
          } else {
            const rA = [...routeA];
            rA.splice(pos, k);
            routes[ri] = rA;
            const rB = [...routes[bestRj]!];
            rB.splice(bestIns + 1, 0, ...insertChain);
            routes[bestRj] = rB;
          }

          break outer;
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

export const orOptSolver: VRPSolver = {
  id: "or_opt",
  label: "Or-Opt (local search)",
  requiresMatrix: true,

  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const matrix = input.matrix!;
    const balanceLoad = input.objective === "balance_load";
    const { routes: routeIndices, totalDistance, totalTime } = solve(
      matrix,
      input.locations,
      input.numVehicles,
      balanceLoad,
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
