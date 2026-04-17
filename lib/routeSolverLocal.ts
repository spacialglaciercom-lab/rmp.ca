/**
 * Local route heuristic solver (no tRPC / React Native). Used on-device and in Node/Vitest.
 */

import { haversineMeters as haversineDistance } from "./_core/geo";

export interface SolverPoint {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  demand?: number;
  serviceTime?: number;
  timeWindow?: {
    start?: string;
    end?: string;
  };
}

export interface SolverResult {
  orderedPoints: SolverPoint[];
  totalDistance: number;
  totalDuration: number;
  segments: {
    from: string;
    to: string;
    distance: number;
    duration: number;
    geometry?: [number, number][];
  }[];
  algorithm: string;
  solveTime: number;
}

export interface SolverOptions {
  algorithm: "nearest-neighbor" | "2-opt" | "christofides" | "vroom" | "pgrouting";
  depot?: SolverPoint;
  vehicleCapacity?: number;
  maxStops?: number;
  useRoadNetwork?: boolean;
  returnToDepot?: boolean;
}

function buildDistanceMatrix(points: SolverPoint[]): number[][] {
  const n = points.length;
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 0;
      } else {
        matrix[i][j] = haversineDistance(
          points[i].lat,
          points[i].lon,
          points[j].lat,
          points[j].lon,
        );
      }
    }
  }
  return matrix;
}

function nearestNeighbor(points: SolverPoint[], depotIndex: number = 0): number[] {
  const n = points.length;
  const visited = new Set<number>([depotIndex]);
  const order: number[] = [depotIndex];
  const matrix = buildDistanceMatrix(points);

  while (visited.size < n) {
    const last = order[order.length - 1];
    let nearestDist = Infinity;
    let nearestIdx = -1;

    for (let i = 0; i < n; i++) {
      if (!visited.has(i) && matrix[last][i] < nearestDist) {
        nearestDist = matrix[last][i];
        nearestIdx = i;
      }
    }

    if (nearestIdx >= 0) {
      order.push(nearestIdx);
      visited.add(nearestIdx);
    }
  }

  return order;
}

function twoOptImprove(order: number[], matrix: number[][], maxIterations: number = 100): number[] {
  let improved = true;
  let iterations = 0;
  let bestOrder = [...order];

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 1; i < order.length - 2; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const currentDist =
          matrix[bestOrder[i - 1]][bestOrder[i]] + matrix[bestOrder[j]][bestOrder[(j + 1) % order.length]];

        const newDist =
          matrix[bestOrder[i - 1]][bestOrder[j]] + matrix[bestOrder[i]][bestOrder[(j + 1) % order.length]];

        if (newDist < currentDist) {
          const newOrder = [
            ...bestOrder.slice(0, i),
            ...bestOrder.slice(i, j + 1).reverse(),
            ...bestOrder.slice(j + 1),
          ];
          bestOrder = newOrder;
          improved = true;
        }
      }
    }
  }

  return bestOrder;
}

function calculateRouteDistance(order: number[], matrix: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += matrix[order[i]][order[i + 1]];
  }
  return total;
}

function orOptImprove(order: number[], matrix: number[][], maxIterations: number = 50): number[] {
  let improved = true;
  let iterations = 0;
  let bestOrder = [...order];

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 1; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        if (j === i || j === i - 1) continue;

        const newOrder = [...bestOrder];
        const [node] = newOrder.splice(i, 1);
        newOrder.splice(j > i ? j - 1 : j, 0, node);

        const oldDist = calculateRouteDistance(bestOrder, matrix);
        const newDist = calculateRouteDistance(newOrder, matrix);

        if (newDist < oldDist) {
          bestOrder = newOrder;
          improved = true;
        }
      }
    }
  }

  return bestOrder;
}

export async function solveLocal(
  points: SolverPoint[],
  options: SolverOptions = { algorithm: "2-opt" },
): Promise<SolverResult> {
  const startTime = Date.now();

  if (points.length === 0) {
    throw new Error("No points to solve");
  }

  if (points.length === 1) {
    return {
      orderedPoints: points,
      totalDistance: 0,
      totalDuration: 0,
      segments: [],
      algorithm: "trivial",
      solveTime: Date.now() - startTime,
    };
  }

  const allPoints = options.depot ? [options.depot, ...points] : points;
  const matrix = buildDistanceMatrix(allPoints);
  const depotIndex = options.depot ? 0 : 0;

  let order: number[];

  switch (options.algorithm) {
    case "nearest-neighbor":
      order = nearestNeighbor(allPoints, depotIndex);
      break;

    case "2-opt":
    case "christofides":
      order = nearestNeighbor(allPoints, depotIndex);
      order = twoOptImprove(order, matrix);
      order = orOptImprove(order, matrix);
      break;

    default:
      order = nearestNeighbor(allPoints, depotIndex);
      order = twoOptImprove(order, matrix);
  }

  if (options.returnToDepot && options.depot) {
    order.push(depotIndex);
  }

  let totalDistance = 0;
  let totalDuration = 0;
  const segments: SolverResult["segments"] = [];

  for (let i = 0; i < order.length - 1; i++) {
    const from = order[i];
    const to = order[i + 1];
    const distance = matrix[from][to];
    totalDistance += distance;

    const duration = distance / (30 * 1000 / 3600);
    totalDuration += duration;

    const serviceTime = allPoints[to].serviceTime ?? 120;
    totalDuration += serviceTime;

    segments.push({
      from: allPoints[from].id,
      to: allPoints[to].id,
      distance,
      duration,
    });
  }

  const orderedPoints = order.map((i) => allPoints[i]);

  return {
    orderedPoints,
    totalDistance,
    totalDuration,
    segments,
    algorithm: options.algorithm,
    solveTime: Date.now() - startTime,
  };
}

export function estimateRouteStats(points: SolverPoint[]): {
  totalDistance: number;
  estimatedDuration: number;
  boundingBox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
} {
  if (points.length === 0) {
    return {
      totalDistance: 0,
      estimatedDuration: 0,
      boundingBox: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
    };
  }

  let minLat = Infinity,
    maxLat = -Infinity;
  let minLon = Infinity,
    maxLon = -Infinity;

  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }

  const diagonal = haversineDistance(minLat, minLon, maxLat, maxLon);
  const estimatedDistance = diagonal * Math.sqrt(points.length) * 1.5;

  const avgServiceTime =
    points.reduce((sum, p) => sum + (p.serviceTime ?? 120), 0) / points.length;
  const estimatedDuration = estimatedDistance / (30 * 1000 / 3600) + points.length * avgServiceTime;

  return {
    totalDistance: Math.round(estimatedDistance),
    estimatedDuration: Math.round(estimatedDuration),
    boundingBox: { minLat, maxLat, minLon, maxLon },
  };
}
