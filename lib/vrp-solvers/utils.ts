/** Shared geometric / routing utilities used by multiple VRP solvers. */

import type { VRPSolverStop, DistMatrix } from "./types";

const VALHALLA_MATRIX_URL =
  "https://valhalla1.openstreetmap.de/sources_to_targets";

/** Haversine distance between two WGS-84 coordinates, in km. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Build a full O(n²) distance/time matrix using haversine. Time estimated at 40 km/h. */
export function buildHaversineMatrix(locations: VRPSolverStop[]): DistMatrix {
  const n = locations.length;
  const AVG_SPEED_KMH = 40;
  const matrix: DistMatrix = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      const dist = haversineKm(
        locations[i].lat,
        locations[i].lon,
        locations[j].lat,
        locations[j].lon,
      );
      const timeSec = (dist / AVG_SPEED_KMH) * 3600;
      matrix[i][j] = { distance: dist, time: timeSec };
    }
  }
  return matrix;
}

/** Fetch a real-road distance/time matrix from the public Valhalla instance. */
export async function getValhallaMatrix(
  locations: VRPSolverStop[],
): Promise<DistMatrix> {
  const locs = locations.map((l) => ({ lat: l.lat, lon: l.lon }));
  const response = await fetch(VALHALLA_MATRIX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sources: locs,
      targets: locs,
      costing: "auto",
      directions_options: { units: "kilometers" },
    }),
  });
  if (!response.ok) throw new Error(`Valhalla HTTP ${response.status}`);
  const data = (await response.json()) as {
    sources_to_targets?: { distance?: number; time?: number }[][];
  };
  if (!data.sources_to_targets) throw new Error("Invalid Valhalla response");
  const matrix: DistMatrix = [];
  for (let i = 0; i < data.sources_to_targets.length; i++) {
    const row = data.sources_to_targets[i];
    matrix[i] = [];
    for (let j = 0; j < row.length; j++) {
      const cell = row[j];
      matrix[i][j] = {
        distance: typeof cell?.distance === "number" ? cell.distance : 0,
        time: typeof cell?.time === "number" ? cell.time : 0,
      };
    }
  }
  return matrix;
}

/** Cluster stops into geographic grid zones so nearby stops are grouped together. */
export function clusterByZones(
  locations: VRPSolverStop[],
  numZones: number,
): number[][] {
  const n = locations.length;
  if (n <= numZones) return locations.map((_, i) => [i]);
  const minLat = Math.min(...locations.map((p) => p.lat));
  const maxLat = Math.max(...locations.map((p) => p.lat));
  const minLon = Math.min(...locations.map((p) => p.lon));
  const maxLon = Math.max(...locations.map((p) => p.lon));
  const rows = Math.ceil(Math.sqrt(numZones));
  const cols = Math.ceil(numZones / rows);
  const cellLat = (maxLat - minLat) / rows || 0.001;
  const cellLon = (maxLon - minLon) / cols || 0.001;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const p = locations[i];
    const ri = Math.min(rows - 1, Math.floor((p.lat - minLat) / cellLat));
    const ci = Math.min(cols - 1, Math.floor((p.lon - minLon) / cellLon));
    const key = `${ri},${ci}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  }
  return Array.from(grid.values());
}

/** Order clusters so the start zone comes first, then nearest by centroid. */
export function orderClustersByStart(
  clusters: number[][],
  locations: VRPSolverStop[],
  startIndex: number,
): number[][] {
  const start = locations[startIndex];
  const withCentroid = clusters.map((indices) => {
    const lat =
      indices.reduce((s, i) => s + locations[i].lat, 0) / indices.length;
    const lon =
      indices.reduce((s, i) => s + locations[i].lon, 0) / indices.length;
    const dist = haversineKm(start.lat, start.lon, lat, lon);
    const containsStart = indices.includes(startIndex);
    return { indices, dist, containsStart };
  });
  withCentroid.sort((a, b) => {
    if (a.containsStart && !b.containsStart) return -1;
    if (!a.containsStart && b.containsStart) return 1;
    return a.dist - b.dist;
  });
  return withCentroid.map((c) => c.indices);
}

/** Nearest-neighbor TSP construction for a subset of indices. */
export function nearestNeighborRoute(
  matrix: DistMatrix,
  indices: number[],
  startIdxInSubset: number,
): number[] {
  if (indices.length <= 1) return [...indices];
  const route: number[] = [];
  const remaining = new Set(indices);
  const startGlobal = indices[startIdxInSubset];
  route.push(startGlobal);
  remaining.delete(startGlobal);
  let current = startGlobal;
  while (remaining.size > 0) {
    let nearest = -1;
    let bestDist = Infinity;
    for (const i of remaining) {
      const d = matrix[current]?.[i]?.distance ?? Infinity;
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    }
    if (nearest === -1) break;
    route.push(nearest);
    remaining.delete(nearest);
    current = nearest;
  }
  return route;
}

/** 2-opt improvement: iteratively reverse segments to reduce total distance. */
export function twoOptImprove(
  matrix: DistMatrix,
  routeIndices: number[],
): number[] {
  const n = routeIndices.length;
  if (n <= 3) return routeIndices;
  let route = [...routeIndices];
  let improved = true;
  let iterations = 0;
  const maxIter = 300;
  while (improved && iterations < maxIter) {
    improved = false;
    iterations++;
    for (let i = 0; i < n - 2; i++) {
      for (let j = i + 2; j < n; j++) {
        const a = route[i];
        const b = route[i + 1];
        const c = route[j];
        const dd = route[(j + 1) % n];
        const before =
          (matrix[a]?.[b]?.distance ?? Infinity) +
          (matrix[c]?.[dd]?.distance ?? Infinity);
        const after =
          (matrix[a]?.[c]?.distance ?? Infinity) +
          (matrix[b]?.[dd]?.distance ?? Infinity);
        if (after < before - 1e-6) {
          const segment = route.slice(i + 1, j + 1).reverse();
          route.splice(i + 1, j - i, ...segment);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return route;
}
