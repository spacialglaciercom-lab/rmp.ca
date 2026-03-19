/**
 * Default fallback solver: zone-clustering + nearest-neighbor + 2-opt improvement.
 * Used when no recognised algorithm id is provided.
 */

import type { VRPSolver, VRPSolverInput, VRPSolverOutput } from "./types";
import {
  clusterByZones,
  orderClustersByStart,
  nearestNeighborRoute,
  twoOptImprove,
} from "./utils";

export const defaultSolver: VRPSolver = {
  id: "default",
  label: "Default (Zone-cluster + 2-Opt)",
  requiresMatrix: true,

  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const { locations, matrix: matrixOpt } = input;
    const matrix = matrixOpt!;
    const n = locations.length;

    const numZones = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(n))));
    const clusters = clusterByZones(locations, numZones);
    const orderedClusters = orderClustersByStart(clusters, locations, 0);

    const routeIndices: number[] = [];
    for (const cluster of orderedClusters) {
      const startInCluster = cluster.indexOf(0);
      const startIdx = startInCluster >= 0 ? startInCluster : 0;
      const segment = nearestNeighborRoute(matrix, cluster, startIdx);
      routeIndices.push(...segment);
    }

    const withReturn = [...routeIndices, 0];
    const improved = twoOptImprove(matrix, withReturn);

    let totalDist = 0;
    let totalTime = 0;
    for (let i = 0; i < improved.length - 1; i++) {
      const a = improved[i];
      const b = improved[i + 1];
      totalDist += matrix[a]?.[b]?.distance ?? 0;
      totalTime += matrix[a]?.[b]?.time ?? 0;
    }

    return {
      stops: improved.map((i) => locations[i]),
      totalDistanceKm: totalDist.toFixed(2),
      totalTimeMin: Math.round(totalTime / 60),
    };
  },
};
