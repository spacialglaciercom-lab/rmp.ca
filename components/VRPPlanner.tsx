import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  ScrollView,
  Platform,
  Keyboard,
  Modal,
  Pressable,
  InteractionManager,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { impactAsync as hapticImpact, ImpactFeedbackStyle } from "@/lib/safe-haptics";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import { routeThroughWaypoints, buildOfflineMatchedRoute } from "@/lib/mapMatching";
import { getRoutingConfigAsync } from "@/lib/routing-config";
import { getRouteOptionsForRouting } from "@/stores/routeParametersStore";
import { storage } from "@/lib/storage";
import { generateRouteId } from "@/lib/utils";
import type { Route, CollectionPoint } from "@/types";
import instructionManager from "@/services/InstructionManager";
import { useDeliveryInstructions } from "@/context/DeliveryInstructionsContext";

type InputMode = "coordinates" | "address";

const OBJECTIVE_OPTIONS = [
  { value: "min_time", label: "Minimize total time" },
  { value: "min_distance", label: "Minimize total distance" },
  { value: "balance_load", label: "Balance load evenly" },
  { value: "min_vehicles", label: "Minimize vehicles used" },
] as const;

const ALGORITHM_OPTIONS = [
  { value: "clarke_wright", label: "Clarke-Wright Savings" },
  { value: "sweep", label: "Sweep (balanced sectors)" },
  { value: "or_opt", label: "Or-Opt (local search)" },
  { value: "two_opt", label: "2-Opt (route untangling)" },
] as const;

const VALHALLA_MATRIX_URL = "https://valhalla1.openstreetmap.de/sources_to_targets";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const nl = "\n";

interface VRPStop {
  lat: number;
  lon: number;
  label: string;
}

interface VRPResult {
  /** Flattened list of all stops in order (for preview/export). */
  stops: VRPStop[];
  /** When present, one route per vehicle (separate lists for UI). */
  routes?: VRPStop[][];
  totalDistance: string;
  totalTime: number;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
}

function parseCoordinates(text: string): VRPStop[] {
  const lines = text.trim().split("\n");
  const locations: VRPStop[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      const label = parts[2] ?? `Stop ${locations.length + 1}`;
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        locations.push({ lat, lon, label });
      }
    }
  }
  return locations;
}

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query.trim(),
    format: "json",
    limit: "10",
  });
  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RouteMasterPro/1.0 (route planning app)",
    },
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = (await response.json()) as NominatimResult[];
  return Array.isArray(data) ? data : [];
}

/** Nominatim allows 1 request per second. Delay between batch geocode calls. */
const NOMINATIM_DELAY_MS = 1100;

/**
 * Geocode a list of addresses (one per line) via Nominatim.
 * Respects 1 req/s; returns VRPStop[] for each address that resolved (skips failures).
 */
async function geocodeAddressesBatch(
  addressLines: string[],
  onProgress?: (done: number, total: number) => void
): Promise<VRPStop[]> {
  const trimmed = addressLines.map((l) => l.trim()).filter(Boolean);
  const stops: VRPStop[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    onProgress?.(i + 1, trimmed.length);
    try {
      const results = await searchNominatim(trimmed[i]);
      const first = results[0];
      if (first) {
        const lat = parseFloat(first.lat);
        const lon = parseFloat(first.lon);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          const label = first.display_name.split(",").slice(0, 2).join(",").trim() || `Stop ${stops.length + 1}`;
          stops.push({ lat, lon, label });
        }
      }
    } catch {
      // Skip failed; caller can see count vs input length
    }
    if (i < trimmed.length - 1) {
      await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
    }
  }
  return stops;
}

async function getValhallaMatrix(locations: VRPStop[]): Promise<{ distance: number; time: number }[][]> {
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

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { sources_to_targets?: { distance?: number; time?: number }[][] };

  if (!data.sources_to_targets) throw new Error("Invalid response format");

  const matrix: { distance: number; time: number }[][] = [];
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

/** Haversine distance in km (for clustering only) */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

/** Build distance/time matrix using haversine (no API). Time estimated at ~40 km/h. */
function buildHaversineMatrix(locations: VRPStop[]): { distance: number; time: number }[][] {
  const n = locations.length;
  const AVG_SPEED_KMH = 40;
  const matrix: { distance: number; time: number }[][] = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      const dist = haversineKm(locations[i].lat, locations[i].lon, locations[j].lat, locations[j].lon);
      const timeSec = (dist / AVG_SPEED_KMH) * 3600;
      matrix[i][j] = { distance: dist, time: timeSec };
    }
  }
  return matrix;
}

/**
 * Cluster stops into geographic zones (by grid) so we visit nearby areas together.
 * Returns array of clusters; each cluster is an array of location indices.
 */
function clusterByZones(locations: VRPStop[], numZones: number): number[][] {
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

/**
 * Order clusters so we visit the start zone first, then nearby zones (by centroid distance).
 */
function orderClustersByStart(
  clusters: number[][],
  locations: VRPStop[],
  startIndex: number
): number[][] {
  const start = locations[startIndex];
  const withCentroid = clusters.map((indices) => {
    const lat = indices.reduce((s, i) => s + locations[i].lat, 0) / indices.length;
    const lon = indices.reduce((s, i) => s + locations[i].lon, 0) / indices.length;
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

/**
 * Nearest-neighbor TSP for a subset of indices. Returns ordered indices (including return to start).
 */
function nearestNeighborRoute(
  matrix: { distance: number; time: number }[][],
  indices: number[],
  startIdxInSubset: number
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

/**
 * 2-opt improvement: repeatedly reverse segments if it shortens the route.
 * Uses the Valhalla distance matrix to remove backtracks and crossings.
 */
function twoOptImprove(
  matrix: { distance: number; time: number }[][],
  routeIndices: number[]
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
        const d = route[(j + 1) % n];
        const before = (matrix[a]?.[b]?.distance ?? Infinity) + (matrix[c]?.[d]?.distance ?? Infinity);
        const after = (matrix[a]?.[c]?.distance ?? Infinity) + (matrix[b]?.[d]?.distance ?? Infinity);
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

export interface VRPConfig {
  vehicles: number;
  capacity: number;
  maxRouteTimeHours: number;
  depotAddress: string;
  travelSpeedFactor: number;
  objective: (typeof OBJECTIVE_OPTIONS)[number]["value"];
  algorithm: (typeof ALGORITHM_OPTIONS)[number]["value"];
}

/**
 * Lightweight Clarke-Wright savings algorithm for VRP with balanced distribution.
 * Depot is index 0. Merges on highest savings first but caps route size so stops
 * are spread evenly across drivers; then force-merges smallest routes if needed.
 */
function clarkeWrightSavings(
  matrix: { distance: number; time: number }[][],
  numVehicles: number
): { routes: number[][]; totalDistance: number; totalTime: number } {
  const n = matrix.length;
  if (n <= 1) return { routes: [[0]], totalDistance: 0, totalTime: 0 };

  const d = (i: number, j: number) => matrix[i]?.[j]?.distance ?? 0;
  const t = (i: number, j: number) => matrix[i]?.[j]?.time ?? 0;

  // Fair share of intermediate stops per route; allow up to +1 to keep merging possible
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
    // Only allow merge if no route exceeds balanced cap
    if (intermediateCount(merged) > cap) continue;

    routes = routes.filter((_, idx) => idx !== ri && idx !== rj);
    routes.push(merged);
  }

  // Force-merge until we have exactly numVehicles: merge pair that minimizes added distance
  while (routes.length > numVehicles) {
    let bestI = 0;
    let bestJ = 1;
    let bestMerged: number[] | null = null;
    let bestCost = Infinity;

    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const ra = routes[i];
        const rb = routes[j];
        const aEnd = ra[ra.length - 2];
        const aStart = ra[1];
        const bEnd = rb[rb.length - 2];
        const bStart = rb[1];
        const candidates: number[][] = [
          ra.slice(0, -1).concat(rb.slice(1)),           // ...aEnd, bStart...
          ra.slice(0, -1).concat(rb.slice(1, -1).reverse(), [0]), // ...aEnd, bEnd..bStart, 0
          [0].concat(ra.slice(1, -1).reverse(), rb.slice(1)),     // 0, aStart..aEnd, bStart...
          [0].concat(rb.slice(1, -1).reverse(), ra.slice(1)),     // 0, bStart..bEnd, aStart...
        ];
        for (const merged of candidates) {
          if (merged.length < 3) continue;
          let cost = 0;
          for (let k = 0; k < merged.length - 1; k++) cost += d(merged[k], merged[k + 1]);
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

/**
 * Sweep algorithm: partition stops by angle from depot into even sectors,
 * then order each sector with nearest-neighbor. Even and geographically logical.
 */
function sweepVRP(
  matrix: { distance: number; time: number }[][],
  locations: VRPStop[],
  numVehicles: number
): { routes: number[][]; totalDistance: number; totalTime: number } {
  const n = matrix.length;
  if (n <= 1) return { routes: [[0]], totalDistance: 0, totalTime: 0 };

  const d = (i: number, j: number) => matrix[i]?.[j]?.distance ?? 0;
  const t = (i: number, j: number) => matrix[i]?.[j]?.time ?? 0;
  const depot = locations[0];
  if (!depot) return { routes: [[0]], totalDistance: 0, totalTime: 0 };

  // Sort stop indices by angle from depot (0 = east, counter-clockwise)
  const indices = Array.from({ length: n - 1 }, (_, i) => i + 1);
  indices.sort((a, b) => {
    const la = locations[a];
    const lb = locations[b];
    if (!la || !lb) return 0;
    const angleA = Math.atan2(la.lat - depot.lat, la.lon - depot.lon);
    const angleB = Math.atan2(lb.lat - depot.lat, lb.lon - depot.lon);
    return angleA - angleB;
  });

  // Partition into numVehicles contiguous segments (even sizes)
  const perRoute = Math.ceil(indices.length / numVehicles);
  const routeIndices: number[][] = [];
  for (let v = 0; v < numVehicles; v++) {
    const segment = indices.slice(v * perRoute, Math.min((v + 1) * perRoute, indices.length));
    if (segment.length === 0) continue;
    // Nearest-neighbor within segment: start at depot, repeatedly go to nearest unvisited
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


/**
 * Or-Opt: nearest-neighbor construction then iterative relocation of chains of
 * 1, 2, or 3 consecutive stops to the best position across all routes.
 * Accepts the first improving move each pass and restarts until no improvement.
 */
function twoOptVRP(
  matrix: { distance: number; time: number }[][],
  locations: VRPStop[],
  numVehicles: number
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
        if (dist < bestDist) { bestDist = dist; best = node; }
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
            d(r[i - 1]!, r[k]!) + d(r[i]!, r[k + 1]!) -
            d(r[i - 1]!, r[i]!) - d(r[k]!, r[k + 1]!);
          if (delta < -1e-9) {
            let lo = i; let hi = k;
            while (lo < hi) {
              const tmp = r[lo]!; r[lo] = r[hi]!; r[hi] = tmp; lo++; hi--;
            }
            improved = true;
          }
        }
      }
    }
  }

  const finalRoutes = routes.filter((r) => r.length > 2);
  if (finalRoutes.length === 0) return { routes: [[0, 0]], totalDistance: 0, totalTime: 0 };

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
function orOptVRP(
  matrix: { distance: number; time: number }[][],
  locations: VRPStop[],
  numVehicles: number,
  balanceLoad: boolean = false
): { routes: number[][]; totalDistance: number; totalTime: number } {
  const n = matrix.length;
  if (n <= 1) return { routes: [[0]], totalDistance: 0, totalTime: 0 };

  const d = (i: number, j: number) => matrix[i]?.[j]?.distance ?? 0;
  const t = (i: number, j: number) => matrix[i]?.[j]?.time ?? 0;

  // ── Construction: sweep partition + nearest-neighbor tour per vehicle ──
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
        if (dist < bestDist) { bestDist = dist; best = node; }
      }
      if (best < 0) break;
      rem.delete(best);
      route.push(best);
      cur = best;
    }
    route.push(0);
    routes.push(route);
  }

  // Helper: intermediate stop count (exclude depot at start/end)
  const intermediateCount = (r: number[]) => Math.max(0, r.length - 2);

  // ── Or-Opt improvement ──
  // Each pass: find the single best relocate move (chain of k=1/2/3 stops from
  // any route to any gap in any route, forward or reversed). Accept and restart.
  // When balanceLoad is true, reject inter-route moves that would make load imbalance > 1.
  let improved = true;
  const MAX_PASSES = 100;
  let passes = 0;

  while (improved && passes < MAX_PASSES) {
    improved = false;
    passes++;

    outer:
    for (let ri = 0; ri < routes.length; ri++) {
      const routeA = routes[ri]!;
      if (routeA.length < 3) continue;

      for (let k = 1; k <= 3; k++) {
        for (let pos = 1; pos + k <= routeA.length - 1; pos++) {
          const chainFirst = routeA[pos]!;
          const chainLast = routeA[pos + k - 1]!;
          const prev = routeA[pos - 1]!;
          const next = routeA[pos + k]!;

          // Savings from removing this chain from routeA
          const removeGain = d(prev, chainFirst) + d(chainLast, next) - d(prev, next);

          let bestGain = 1e-9;
          let bestRj = -1;
          let bestIns = -1;
          let bestRev = false;

          for (let rj = 0; rj < routes.length; rj++) {
            const routeB = routes[rj]!;
            for (let ins = 0; ins < routeB.length - 1; ins++) {
              // Skip the gap that would re-insert the chain at its current position
              if (rj === ri && ins >= pos - 1 && ins < pos + k) continue;

              const a = routeB[ins]!;
              const b = routeB[ins + 1]!;

              // Forward insertion
              const costFwd = d(a, chainFirst) + d(chainLast, b) - d(a, b);
              if (removeGain - costFwd > bestGain) {
                bestGain = removeGain - costFwd;
                bestRj = rj; bestIns = ins; bestRev = false;
              }

              // Reversed insertion (only meaningful for k > 1)
              if (k > 1) {
                const costRev = d(a, chainLast) + d(chainFirst, b) - d(a, b);
                if (removeGain - costRev > bestGain) {
                  bestGain = removeGain - costRev;
                  bestRj = rj; bestIns = ins; bestRev = true;
                }
              }
            }
          }

          if (bestRj < 0) continue;

          // When balance_load: reject inter-route moves that would make counts differ by more than 1
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
            if (maxC - minC > 1) continue; // skip this move to keep load balanced
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
  if (finalRoutes.length === 0) return { routes: [[0, 0]], totalDistance: 0, totalTime: 0 };

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
/**
 * Solve VRP: dispatches to the selected algorithm. Depot is always index 0.
 */
function solveVRP(
  matrix: { distance: number; time: number }[][],
  locations: VRPStop[],
  config?: Partial<VRPConfig>
): VRPResult {
  const n = locations.length;
  if (n <= 1) {
    return {
      stops: locations,
      totalDistance: "0.00",
      totalTime: 0,
    };
  }

  const numVehicles = config?.vehicles != null && config.vehicles > 0
    ? Math.min(12, Math.max(1, config.vehicles))
    : 1;

  if (config?.algorithm === "clarke_wright") {
    const { routes: routeIndices, totalDistance, totalTime } = clarkeWrightSavings(matrix, numVehicles);
    const routes: VRPStop[][] = routeIndices.map((r) =>
      r.map((i) => locations[i])
    );
    const stops: VRPStop[] = routes.flatMap((r) => r);
    return {
      stops,
      routes: routes.length > 1 ? routes : undefined,
      totalDistance: totalDistance.toFixed(2),
      totalTime: Math.round(totalTime / 60),
    };
  }

  if (config?.algorithm === "sweep") {
    const { routes: routeIndices, totalDistance, totalTime } = sweepVRP(matrix, locations, numVehicles);
    const routes: VRPStop[][] = routeIndices.map((r) =>
      r.map((i) => locations[i])
    );
    const stops: VRPStop[] = routes.flatMap((r) => r);
    return {
      stops,
      routes: routes.length > 1 ? routes : undefined,
      totalDistance: totalDistance.toFixed(2),
      totalTime: Math.round(totalTime / 60),
    };
  }

  if (config?.algorithm === "two_opt") {
    const { routes: routeIndices, totalDistance, totalTime } = twoOptVRP(matrix, locations, numVehicles);
    const routes: VRPStop[][] = routeIndices.map((r) => r.map((i) => locations[i]!));
    const stops: VRPStop[] = routes.flatMap((r) => r);
    return {
      stops,
      routes: routes.length > 1 ? routes : undefined,
      totalDistance: totalDistance.toFixed(2),
      totalTime: Math.round(totalTime / 60),
    };
  }
  if (config?.algorithm === "or_opt") {
    const balanceLoad = config?.objective === "balance_load";
    const { routes: routeIndices, totalDistance, totalTime } = orOptVRP(matrix, locations, numVehicles, balanceLoad);
    const routes: VRPStop[][] = routeIndices.map((r) => r.map((i) => locations[i]!));
    const stops: VRPStop[] = routes.flatMap((r) => r);
    return {
      stops,
      routes: routes.length > 1 ? routes : undefined,
      totalDistance: totalDistance.toFixed(2),
      totalTime: Math.round(totalTime / 60),
    };
  }

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
    totalDistance: totalDist.toFixed(2),
    totalTime: Math.round(totalTime / 60),
  };
}

export interface VRPPlannerProps {
  /** When true, render content in a View instead of ScrollView. Use on native when VRPPlanner is inside another ScrollView/FlatList to avoid nested scroll issues. */
  nestedInScrollView?: boolean;
}

const DEFAULT_VRP_CONFIG: VRPConfig = {
  vehicles: 2,
  capacity: 1000,
  maxRouteTimeHours: 8,
  depotAddress: "",
  travelSpeedFactor: 1,
  objective: "min_time",
  algorithm: "clarke_wright",
};

/** Delivery instructions card: load from one JSON file; list is auto-matched to route stops by address. */
function DeliveryInstructionsCard({ fillScreen = false }: { fillScreen?: boolean }) {
  const colors = useColors();
  const { instructions, loadFromFile, loadError, clearLoadError } = useDeliveryInstructions();
  return (
    <View style={[styles.card, fillScreen && styles.cardFill, { backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>
        Delivery Instructions
      </Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>
        {instructions.length} instruction{instructions.length !== 1 ? "s" : ""} loaded. Auto-matched to route stops by address during export.
      </Text>
      <TouchableOpacity
        style={[styles.runButton, { backgroundColor: colors.primary, marginTop: 8, alignSelf: "flex-start" }]}
        onPress={loadFromFile}
        activeOpacity={0.8}
      >
        <Text style={styles.runButtonText}>Load from JSON file</Text>
      </TouchableOpacity>
      {loadError ? (
        <TouchableOpacity
          onPress={clearLoadError}
          style={{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: colors.error + "30", borderRadius: 8 }}
        >
          <Text style={[styles.helperText, { color: colors.error }]}>{loadError}</Text>
          <Text style={[styles.helperText, { color: colors.muted, marginTop: 2 }]}>Tap to dismiss</Text>
        </TouchableOpacity>
      ) : null}
      {instructions.length > 0 ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          {instructions.slice(0, 5).map((inst, idx) => (
            <View key={inst.id ?? idx} style={{ paddingVertical: 6, paddingHorizontal: 8, backgroundColor: colors.background + "80", borderRadius: 8, marginBottom: 4 }}>
              <Text style={[styles.sectionHeaderSmall, { color: colors.foreground, marginBottom: 2 }]} numberOfLines={1}>
                {inst.address} · {inst.title}
              </Text>
              <Text style={[styles.helperText, { color: colors.muted }]} numberOfLines={2}>
                {inst.details}
              </Text>
            </View>
          ))}
          {instructions.length > 5 && (
            <Text style={[styles.helperText, { color: colors.muted }]}>
              +{instructions.length - 5} more
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function VRPPlanner({ nestedInScrollView = false }: VRPPlannerProps = {}) {
  const colors = useColors();
  const cyan = colors.accentCyan ?? colors.primary;
  const magenta = colors.accentMagenta ?? "#d946ef";

  const [inputMode, setInputMode] = useState<InputMode>("coordinates");
  const [coordinates, setCoordinates] = useState("");
  const [addressesText, setAddressesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VRPResult | null>(null);
  const [useValhallaApi, setUseValhallaApi] = useState(true);
  const scrollViewRef = useRef<ScrollView | null>(null);

  /** Refs for iOS: avoid full re-render on every keystroke (reduces freeze when keyboard opens). */
  const coordinatesRef = useRef("");
  const addressesTextRef = useRef("");
  const nominatimValueRef = useRef("");
  const coordinatesInputRef = useRef<TextInput | null>(null);
  const addressesInputRef = useRef<TextInput | null>(null);
  const nominatimInputRef = useRef<TextInput | null>(null);
  const vehiclesRef = useRef(String(DEFAULT_VRP_CONFIG.vehicles));
  const capacityRef = useRef(String(DEFAULT_VRP_CONFIG.capacity));
  const maxRouteTimeHoursRef = useRef(String(DEFAULT_VRP_CONFIG.maxRouteTimeHours));
  const depotAddressRef = useRef("");
  const travelSpeedFactorRef = useRef(String(DEFAULT_VRP_CONFIG.travelSpeedFactor));
  const [coordinatesKey, setCoordinatesKey] = useState(0);
  const [addressesKey, setAddressesKey] = useState(0);
  const [nominatimKey, setNominatimKey] = useState(0);
  /** Bump to remount numeric/advanced inputs with fresh defaultValue (e.g. after Clear). */
  const [numericInputsKey, setNumericInputsKey] = useState(0);
  /** On iOS, use uncontrolled inputs everywhere to prevent keyboard-open freeze from re-renders. */
  const useUncontrolledInputs = Platform.OS === "ios";

  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);

  const [vehicles, setVehicles] = useState(String(DEFAULT_VRP_CONFIG.vehicles));
  const [capacity, setCapacity] = useState(String(DEFAULT_VRP_CONFIG.capacity));
  const [maxRouteTimeHours, setMaxRouteTimeHours] = useState(String(DEFAULT_VRP_CONFIG.maxRouteTimeHours));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [depotAddress, setDepotAddress] = useState("");
  const [startFromCurrentPosition, setStartFromCurrentPosition] = useState(false);
  const [travelSpeedFactor, setTravelSpeedFactor] = useState(String(DEFAULT_VRP_CONFIG.travelSpeedFactor));
  const [objective, setObjective] = useState<(typeof OBJECTIVE_OPTIONS)[number]["value"]>(DEFAULT_VRP_CONFIG.objective);
  const [algorithm, setAlgorithm] = useState<(typeof ALGORITHM_OPTIONS)[number]["value"]>(DEFAULT_VRP_CONFIG.algorithm);
  const [pickerOpen, setPickerOpen] = useState<"objective" | "algorithm" | null>(null);

  const [nominatimQuery, setNominatimQuery] = useState("");
  const [nominatimResults, setNominatimResults] = useState<NominatimResult[]>([]);
  const [nominatimLoading, setNominatimLoading] = useState(false);

  const router = useRouter();
  const { dispatch } = useRouting();

  const [previewLoading, setPreviewLoading] = useState(false);
  const [exportGpxLoading, setExportGpxLoading] = useState(false);

  /** Get road-matched geometry for each route (for GPX export). Falls back to stop-only if routing unavailable. */
  const getRoadMatchedGeometries = useCallback(
    async (routes: VRPStop[][]): Promise<Array<Array<{ lat: number; lon: number }>>> => {
      const routingConfig = await getRoutingConfigAsync();
      const canRoute =
        !!(routingConfig.baseUrl || (routingConfig.provider === "google" && routingConfig.googleApiKey));
      const geometries: Array<Array<{ lat: number; lon: number }>> = [];
      for (const stopList of routes) {
        const pts = stopList.map((s) => ({ lat: s.lat, lon: s.lon }));
        if (pts.length < 2) {
          geometries.push(pts);
          continue;
        }
        let matched: { matchedGeometry: Array<{ lat: number; lon: number }> } | null = null;
        if (canRoute) {
          try {
            matched = await routeThroughWaypoints(pts, routingConfig, getRouteOptionsForRouting());
          } catch {
            // fall through to offline
          }
        }
        if (matched && matched.matchedGeometry.length >= 2) {
          geometries.push(matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })));
        } else {
          const offline = buildOfflineMatchedRoute(pts);
          if (offline.matchedGeometry.length >= 2) {
            geometries.push(offline.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })));
          } else {
            geometries.push(pts);
          }
        }
      }
      return geometries;
    },
    []
  );

  const handlePreviewRoute = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const routes = result.routes && result.routes.length > 1 ? result.routes : null;
    setPreviewLoading(true);
    try {
      const routingConfig = await getRoutingConfigAsync();
      const canRoute =
        (routingConfig.baseUrl || (routingConfig.provider === "google" && routingConfig.googleApiKey));

      if (routes && routes.length > 1) {
        // Multi-vehicle: compute one road-matched route per vehicle and dispatch separate tracks
        const routeGeometries: Array<Array<{ lat: number; lon: number }>> = [];
        for (let v = 0; v < routes.length; v++) {
          const stopList = routes[v];
          const pts = stopList.map((s) => ({ lat: s.lat, lon: s.lon }));
          if (pts.length < 2) {
            routeGeometries.push(pts);
            continue;
          }
          let matched: { matchedGeometry: Array<{ lat: number; lon: number }> } | null = null;
          if (canRoute) {
            matched = await routeThroughWaypoints(pts, routingConfig, getRouteOptionsForRouting());
          }
          if (matched && matched.matchedGeometry.length >= 2) {
            routeGeometries.push(matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })));
          } else {
            const offline = buildOfflineMatchedRoute(pts);
            if (offline.matchedGeometry.length >= 2) {
              routeGeometries.push(offline.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })));
            } else {
              routeGeometries.push(pts);
            }
          }
        }
        dispatch({
          type: "SET_PREVIEW_ROUTES",
          payload: routeGeometries,
        });
      } else {
        // Single route: keep existing behavior (result.stops or first route)
        const points = result.stops.map((s, i) => ({ lat: s.lat, lon: s.lon, label: `#${i + 1}` }));
        if (points.length >= 2 && canRoute) {
          const matched = await routeThroughWaypoints(
            points.map((p) => ({ lat: p.lat, lon: p.lon })),
            routingConfig,
            getRouteOptionsForRouting()
          );
          if (matched && matched.matchedGeometry.length >= 2) {
            dispatch({
              type: "SET_PREVIEW_ROUTE",
              payload: matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })),
            });
            router.push("/(tabs)/map");
            return;
          }
        }
        const pts = result.stops.map((s) => ({ lat: s.lat, lon: s.lon }));
        const offline = buildOfflineMatchedRoute(pts);
        if (offline.matchedGeometry.length >= 2) {
          dispatch({
            type: "SET_PREVIEW_ROUTE",
            payload: offline.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })),
          });
        } else {
          dispatch({ type: "SET_PREVIEW_ROUTE", payload: points });
        }
      }
    } catch (e) {
      const points = result.stops.map((s, i) => ({ lat: s.lat, lon: s.lon, label: `#${i + 1}` }));
      if (routes && routes.length > 1) {
        const fallback = routes.map((r) => r.map((s) => ({ lat: s.lat, lon: s.lon })));
        dispatch({ type: "SET_PREVIEW_ROUTES", payload: fallback });
      } else {
        dispatch({ type: "SET_PREVIEW_ROUTE", payload: points });
      }
    } finally {
      setPreviewLoading(false);
    }
    router.push("/(tabs)/map");
  };

  const handleSaveAsCurrentRoute = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const points: CollectionPoint[] = result.stops.map((s, i) => ({
      id: `vrp-${i}-${s.lat}-${s.lon}`,
      address: s.label ?? `Stop ${i + 1}`,
      latitude: s.lat,
      longitude: s.lon,
      collectionType: "residential",
      status: "pending",
    }));
    const routeToSave: Route = {
      id: generateRouteId(),
      date: new Date().toISOString().slice(0, 10),
      points,
      totalPoints: points.length,
      completedPoints: 0,
      estimatedDuration: Math.max(1, Math.round(points.length * 0.5)),
      status: "not_started",
      routeSource: "vrp",
    };
    await storage.saveRoute(routeToSave);
    Alert.alert("Saved", `${points.length} stops saved as current route. Open Home to see the Processing Queue.`);
    router.push("/(tabs)/");
  };

  const escapeCsvCell = (value: string): string => {
    if (value.includes('"') || value.includes(",") || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };


  const buildGpxForRoute = (
    routeStops: VRPStop[],
    routeNum: number,
    date: string,
    trackPoints?: Array<{ lat: number; lon: number }>
  ): string => {
    const wpts = routeStops
      .map((s, i) => {
        const name = s.label ? s.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : `Stop ${i + 1}`;
        return `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><name>${name}</name></wpt>`;
      })
      .join(nl);
    const track = trackPoints && trackPoints.length >= 2 ? trackPoints : routeStops;
    const trkpts = track
      .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`)
      .join(nl);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="RMP VRP Planner" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <metadata><name>Vehicle ${routeNum} – ${date}</name></metadata>`,
      wpts,
      `  <trk><name>Vehicle ${routeNum}</name><trkseg>`,
      trkpts,
      '  </trkseg></trk>',
      '</gpx>',
    ].join(nl);
  };

  const handleExportGpx = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const date = new Date().toISOString().slice(0, 10);
    const routes: VRPStop[][] = result.routes && result.routes.length > 1 ? result.routes : [result.stops];

    setExportGpxLoading(true);
    try {
      const roadGeometries = await getRoadMatchedGeometries(routes);

      const allWpts = result.stops
        .map((s, i) => {
          const name = (s.label ?? `Stop ${i + 1}`).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          return `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><name>${name}</name></wpt>`;
        })
        .join(nl);

      const tracks = routes
        .map((routeStops, ri) => {
          const trackPoints = roadGeometries[ri];
          const pts = trackPoints && trackPoints.length >= 2 ? trackPoints : routeStops;
          const trkpts = pts
            .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`)
            .join(nl);
          return [`  <trk><name>Vehicle ${ri + 1}</name><trkseg>`, trkpts, '  </trkseg></trk>'].join(nl);
        })
        .join(nl);

      const gpx = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="RMP VRP Planner" xmlns="http://www.topografix.com/GPX/1/1">',
        `  <metadata><name>VRP Routes – ${date}</name></metadata>`,
        allWpts,
        tracks,
        '</gpx>',
      ].join(nl);

      const fileName = `vrp_routes_${date}.gpx`;
      if (Platform.OS === "web") {
        const blob = new Blob([gpx], { type: "application/gpx+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        Alert.alert("Exported", `GPX saved as ${fileName} (snapped to roads)`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void> };
        const fileUri = `${FileSystem.cacheDirectory ?? ""}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, gpx, { encoding: FileSystem.EncodingType.UTF8 });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, { mimeType: "application/gpx+xml", dialogTitle: "Export VRP routes (GPX)" });
        } else {
          Alert.alert("Saved", `GPX saved to ${fileUri}`);
        }
        Alert.alert("Exported", `GPX saved as ${fileName} (snapped to roads)`);
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Export failed", "Could not export GPX. Please try again.");
    } finally {
      setExportGpxLoading(false);
    }
  };

  const handleExportGpxPerVehicle = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const date = new Date().toISOString().slice(0, 10);
    const routes: VRPStop[][] = result.routes && result.routes.length > 1 ? result.routes : [result.stops];

    if (routes.length === 1) {
      Alert.alert("Single route", "Only one vehicle – exporting as single GPX file.");
      try {
        await handleExportGpx();
      } catch (e) {
        console.error(e);
        Alert.alert("Export failed", "Could not export GPX. Please try again.");
      }
      return;
    }

    setExportGpxLoading(true);
    try {
      const roadGeometries = await getRoadMatchedGeometries(routes);

      const jszipMod = await import("jszip");
      const JSZip = (jszipMod as { default?: typeof jszipMod }).default ?? jszipMod;
      if (typeof JSZip !== "function") {
        throw new Error("JSZip not available");
      }
      const zip = new JSZip();
      const validRoutes = routes.filter((r) => r?.length > 0);
      if (validRoutes.length === 0) throw new Error("No routes to export");
      validRoutes.forEach((routeStops, ri) => {
        const trackPoints = roadGeometries[ri];
        const gpx = buildGpxForRoute(routeStops, ri + 1, date, trackPoints);
        zip.file(`vehicle_${ri + 1}.gpx`, gpx);
      });
      const isWeb = Platform.OS === "web";
      const zipOutput = await zip.generateAsync({
        type: isWeb ? "uint8array" : "base64",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const fileName = `vrp_routes_per_vehicle_${date}.zip`;

      if (isWeb) {
        const blob = new Blob([zipOutput as Uint8Array], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert("Exported", `${validRoutes.length} GPX files (snapped to roads) saved in ${fileName}`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void> };
        const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
        if (!cacheDir) {
          throw new Error("No cache directory available");
        }
        const fileUri = `${cacheDir}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, zipOutput as string, { encoding: FileSystem.EncodingType.Base64 });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, { mimeType: "application/zip", dialogTitle: "Export GPX per vehicle (ZIP)" });
        } else {
          Alert.alert("Saved", `ZIP saved to ${fileUri}`);
        }
        Alert.alert("Exported", `${validRoutes.length} GPX files (snapped to roads) saved in ${fileName}`);
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Export failed", "Could not export GPX files. Please try again.");
    } finally {
      setExportGpxLoading(false);
    }
  };

  const handleExportCsv = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const comment = "# Rows are in drive order per route. Route = vehicle/route number (1, 2, 3...).";
    const header = "Route,VisitOrder,StopLabel,Latitude,Longitude";
    const rows: string[] = [];

    const headerWithInstructions = `${header},Instructions`;
    const rowForStop = (s: VRPStop, routeNum: number, visitOrder: number) => {
      const label = escapeCsvCell(s.label ?? `Stop ${visitOrder}`);
      const matched = instructionManager.matchForRouteStop(s.label ?? "");
      const instr = matched
        ? escapeCsvCell(`${matched.title}: ${matched.details}`)
        : "";
      return `${routeNum},${visitOrder},${label},${s.lat},${s.lon},${instr}`;
    };

    if (result.routes && result.routes.length > 1) {
      result.routes.forEach((routeStops, routeIdx) => {
        const routeNum = routeIdx + 1;
        routeStops.forEach((s, i) => {
          rows.push(rowForStop(s, routeNum, i + 1));
        });
      });
    } else {
      result.stops.forEach((s, i) => {
        rows.push(rowForStop(s, 1, i + 1));
      });
    }

    const csv = [comment, headerWithInstructions, ...rows].join("\n");
    const fileName = `vrp_route_${new Date().toISOString().slice(0, 10)}.csv`;

    try {
      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert("Exported", `CSV saved as ${fileName}`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as { isAvailableAsync: () => Promise<boolean>; shareAsync: (uri: string, opts?: { mimeType?: string; dialogTitle?: string }) => Promise<void> };
        const fileUri = `${FileSystem.cacheDirectory ?? ""}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "text/csv",
            dialogTitle: "Export VRP route (CSV)",
          });
        } else {
          Alert.alert("Saved", `CSV saved to ${fileUri}`);
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Export failed", "Could not export CSV. Please try again.");
    }
  };

  const runVRP = async () => {
    Keyboard.dismiss();
    const coordsValue = useUncontrolledInputs ? coordinatesRef.current : coordinates;
    const addressesValue = useUncontrolledInputs ? addressesTextRef.current : addressesText;
    const useCurrentAsDepot = startFromCurrentPosition;
    const minStops = useCurrentAsDepot ? 1 : 2;
    const locations = inputMode === "coordinates"
      ? parseCoordinates(coordsValue)
      : await (async () => {
          const lines = addressesValue.trim().split("\n").map((l) => l.trim()).filter(Boolean);
          if (lines.length < minStops) return [];
          setGeocodeProgress({ done: 0, total: lines.length });
          const stops = await geocodeAddressesBatch(lines, (d, t) => setGeocodeProgress({ done: d, total: t }));
          setGeocodeProgress(null);
          return stops;
        })();
    if (useCurrentAsDepot) {
      if (!locations || locations.length < 1) {
        Alert.alert(
          "Error",
          inputMode === "coordinates"
            ? "Enter at least 1 coordinate when using Start from current position."
            : "Enter at least 1 address when using Start from current position."
        );
        return;
      }
    } else if (!locations || locations.length < 2) {
      Alert.alert(
        "Error",
        inputMode === "coordinates"
          ? "Enter at least 2 coordinates (lat,lon or lat,lon,label per line)."
          : "Enter at least 2 addresses (one per line) and ensure geocoding succeeds."
      );
      return;
    }

    hapticImpact(ImpactFeedbackStyle.Medium);
    setLoading(true);
    setResult(null);
    try {
      let locationsForMatrix = locations;
      if (useCurrentAsDepot) {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Location", "Location permission is required to start from current position.");
          setLoading(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const current: VRPStop = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "Current position",
        };
        locationsForMatrix = [current, ...locations];
      }

      const matrix = useValhallaApi
        ? await getValhallaMatrix(locationsForMatrix)
        : buildHaversineMatrix(locationsForMatrix);
      const vehiclesStr = useUncontrolledInputs ? vehiclesRef.current : vehicles;
      const capacityStr = useUncontrolledInputs ? capacityRef.current : capacity;
      const maxRouteTimeHoursStr = useUncontrolledInputs ? maxRouteTimeHoursRef.current : maxRouteTimeHours;
      const depotStr = useUncontrolledInputs ? depotAddressRef.current : depotAddress;
      const speedStr = useUncontrolledInputs ? travelSpeedFactorRef.current : travelSpeedFactor;
      const config: Partial<VRPConfig> = {
        vehicles: Math.max(1, parseInt(vehiclesStr, 10) || DEFAULT_VRP_CONFIG.vehicles),
        capacity: Math.max(1, parseInt(capacityStr, 10) || DEFAULT_VRP_CONFIG.capacity),
        maxRouteTimeHours: Math.max(1, parseInt(maxRouteTimeHoursStr, 10) || DEFAULT_VRP_CONFIG.maxRouteTimeHours),
        depotAddress: depotStr.trim(),
        travelSpeedFactor: Math.max(0.1, parseFloat(speedStr) || 1),
        objective,
        algorithm,
      };
      const solution = solveVRP(matrix, locationsForMatrix, config);
      setResult(solution);
    } catch (error) {
      Alert.alert(
        "Error",
        useValhallaApi
          ? "Failed to calculate route. Check your internet connection."
          : "Failed to calculate route."
      );
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    hapticImpact();
    if (useUncontrolledInputs) {
      coordinatesRef.current = "";
      addressesTextRef.current = "";
      vehiclesRef.current = String(DEFAULT_VRP_CONFIG.vehicles);
      capacityRef.current = String(DEFAULT_VRP_CONFIG.capacity);
      maxRouteTimeHoursRef.current = String(DEFAULT_VRP_CONFIG.maxRouteTimeHours);
      depotAddressRef.current = "";
      travelSpeedFactorRef.current = String(DEFAULT_VRP_CONFIG.travelSpeedFactor);
      setCoordinatesKey((k) => k + 1);
      setAddressesKey((k) => k + 1);
      setNumericInputsKey((k) => k + 1);
    }
    setCoordinates("");
    setAddressesText("");
    setVehicles(String(DEFAULT_VRP_CONFIG.vehicles));
    setCapacity(String(DEFAULT_VRP_CONFIG.capacity));
    setMaxRouteTimeHours(String(DEFAULT_VRP_CONFIG.maxRouteTimeHours));
    setDepotAddress("");
    setStartFromCurrentPosition(false);
    setTravelSpeedFactor(String(DEFAULT_VRP_CONFIG.travelSpeedFactor));
    setResult(null);
  };

  const runNominatimSearch = async () => {
    Keyboard.dismiss();
    const query = useUncontrolledInputs ? nominatimValueRef.current : nominatimQuery;
    if (!query.trim()) {
      Alert.alert("Search", "Enter a place name or address.");
      return;
    }
    hapticImpact();
    setNominatimLoading(true);
    setNominatimResults([]);
    try {
      const results = await searchNominatim(query);
      setNominatimResults(results);
      if (results.length === 0) {
        Alert.alert("No results", `No places found for "${query.trim()}"`);
      }
    } catch (error) {
      Alert.alert("Error", "Search failed. Check your internet connection.");
      console.error(error);
    } finally {
      setNominatimLoading(false);
    }
  };

  const addNominatimToVRP = (place: NominatimResult, label?: string) => {
    hapticImpact();
    const name = label ?? (place.display_name.split(",").slice(0, 2).join(",").trim() || "Stop");
    const line = `${place.lat},${place.lon}, ${name}\n`;
    if (useUncontrolledInputs) {
      const next = (coordinatesRef.current.trim() ? coordinatesRef.current.trim() + "\n" : "") + line;
      coordinatesRef.current = next;
      coordinatesInputRef.current?.setNativeProps?.({ text: next });
      nominatimValueRef.current = "";
      setNominatimKey((k) => k + 1);
      nominatimInputRef.current?.setNativeProps?.({ text: "" });
    } else {
      setCoordinates((prev) => (prev.trim() ? prev.trim() + "\n" + line : line));
      setNominatimQuery("");
    }
    setNominatimResults([]);
  };

  const runGeocodeAddresses = async () => {
    Keyboard.dismiss();
    const addressesValue = useUncontrolledInputs ? addressesTextRef.current : addressesText;
    const lines = addressesValue.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      Alert.alert("No addresses", "Enter one address per line, then tap Geocode and add to VRP.");
      return;
    }
    hapticImpact();
    setGeocodeProgress({ done: 0, total: lines.length });
    try {
      const stops = await geocodeAddressesBatch(lines, (done, total) => {
        setGeocodeProgress({ done, total });
      });
      setGeocodeProgress(null);
      if (stops.length === 0) {
        Alert.alert("No results", "No addresses could be geocoded. Check the text and try again.");
        return;
      }
      const newLines = stops.map((s) => `${s.lat},${s.lon},${s.label}`).join("\n");
      setCoordinates((prev) => (prev.trim() ? prev.trim() + "\n" + newLines : newLines));
      setAddressesText("");
      if (stops.length < lines.length) {
        Alert.alert(
          "Partially done",
          `Geocoded ${stops.length} of ${lines.length} addresses. Failed rows were skipped.`
        );
      }
    } catch (e) {
      setGeocodeProgress(null);
      Alert.alert("Error", "Geocoding failed. Check your internet connection.");
      console.error(e);
    }
  };

  const handleInputFocus = useCallback(() => {
    if (nestedInScrollView) return;
    // Defer scroll so it doesn't run during the keyboard-open animation on iOS.
    // Running scrollTo during keyboard transition can worsen main-thread hang (UIKit run loop timeout).
    if (Platform.OS === "ios") {
      const delayMs = 500;
      setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          scrollViewRef.current?.scrollTo({ y: 50, animated: true });
        });
      }, delayMs);
    } else {
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: 50, animated: true });
      }, 300);
    }
  }, [nestedInScrollView]);

  const inputBorder = { borderColor: cyan + "66", backgroundColor: colors.background + "F5" };

  /** On web home screen: Plan deliveries + Search place fill the viewport. */
  const fillScreen = nestedInScrollView && Platform.OS === "web";
  const planCardStyle = [styles.card, { backgroundColor: colors.surface, borderWidth: 1, borderColor: magenta + "44" }, fillScreen && styles.cardFill];

  const content = (
    <>
        <View style={planCardStyle}>
          <Text style={[styles.sectionHeader, { color: colors.foreground }]}>
            Plan deliveries (VRP)
          </Text>

          {/* Input mode: Coordinates | Address */}
          <View style={[styles.segmentedRow, { marginBottom: 12 }]}>
            <TouchableOpacity
              style={[
                styles.segmentedOption,
                inputMode === "coordinates" && { backgroundColor: cyan + "33", borderColor: cyan },
                { borderColor: colors.border },
              ]}
              onPress={() => { hapticImpact(); setInputMode("coordinates"); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentedLabel, { color: inputMode === "coordinates" ? cyan : colors.muted }]}>
                Coordinates
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentedOption,
                inputMode === "address" && { backgroundColor: cyan + "33", borderColor: cyan },
                { borderColor: colors.border },
              ]}
              onPress={() => { hapticImpact(); setInputMode("address"); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentedLabel, { color: inputMode === "address" ? cyan : colors.muted }]}>
                Address
              </Text>
            </TouchableOpacity>
          </View>

          {inputMode === "coordinates" ? (
            <TextInput
              key={useUncontrolledInputs ? `coords-${coordinatesKey}` : undefined}
              ref={coordinatesInputRef}
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground }, fillScreen && { flex: 1, minHeight: 120 }]}
              multiline
              numberOfLines={5}
              placeholder="45.5017,-73.5673, Downtown\n45.5234,-73.5834, West End"
              placeholderTextColor={colors.muted}
              {...(useUncontrolledInputs
                ? { defaultValue: "", onChangeText: (t) => { coordinatesRef.current = t; } }
                : { value: coordinates, onChangeText: setCoordinates })}
              onFocus={handleInputFocus}
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
            />
          ) : (
            <>
              <TextInput
                key={useUncontrolledInputs ? `addr-${addressesKey}` : undefined}
                ref={addressesInputRef}
                style={[styles.input, { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground, minHeight: 80 }, fillScreen && { flex: 1, minHeight: 120 }]}
                multiline
                numberOfLines={4}
                placeholder="123 Main St, Montreal\n456 Oak Ave, Toronto\n..."
                placeholderTextColor={colors.muted}
                {...(useUncontrolledInputs
                  ? { defaultValue: "", onChangeText: (t) => { addressesTextRef.current = t; } }
                  : { value: addressesText, onChangeText: setAddressesText })}
                onFocus={handleInputFocus}
                autoCapitalize="none"
                textAlignVertical="top"
                editable={!geocodeProgress}
              />
              <Text style={[styles.helperText, { color: colors.muted, marginTop: 6 }]}>
                Geocode confidence ≥ 90%; automatically clusters if &gt;1 depot detected.
              </Text>
              {geocodeProgress ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
                  <ActivityIndicator size="small" color={cyan} />
                  <Text style={[styles.helperText, { color: colors.muted, marginLeft: 8 }]}>
                    Geocoding {geocodeProgress.done}/{geocodeProgress.total}…
                  </Text>
                </View>
              ) : null}
            </>
          )}

          {/* Vehicle Configuration */}
          <Text style={[styles.sectionHeaderSmall, { color: colors.foreground, marginTop: 16, marginBottom: 8 }]}>
            Vehicle configuration
          </Text>
          <View style={styles.vehicleRow}>
            <View style={[styles.vehicleInputWrap, inputBorder]}>
              <Text style={[styles.vehicleLabel, { color: colors.muted }]}>Vehicles</Text>
              <TextInput
                key={useUncontrolledInputs ? `vehicles-${numericInputsKey}` : undefined}
                style={[styles.vehicleInput, { color: colors.foreground }]}
                {...(useUncontrolledInputs
                  ? { defaultValue: vehicles, onChangeText: (t) => { vehiclesRef.current = t; } }
                  : { value: vehicles, onChangeText: setVehicles })}
                keyboardType="number-pad"
                placeholder="2"
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={[styles.vehicleInputWrap, inputBorder]}>
              <Text style={[styles.vehicleLabel, { color: colors.muted }]}>Capacity (kg/pcs)</Text>
              <TextInput
                key={useUncontrolledInputs ? `capacity-${numericInputsKey}` : undefined}
                style={[styles.vehicleInput, { color: colors.foreground }]}
                {...(useUncontrolledInputs
                  ? { defaultValue: capacity, onChangeText: (t) => { capacityRef.current = t; } }
                  : { value: capacity, onChangeText: setCapacity })}
                keyboardType="number-pad"
                placeholder="1000"
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={[styles.vehicleInputWrap, inputBorder]}>
              <Text style={[styles.vehicleLabel, { color: colors.muted }]}>Max Route Time (h)</Text>
              <TextInput
                key={useUncontrolledInputs ? `maxRoute-${numericInputsKey}` : undefined}
                style={[styles.vehicleInput, { color: colors.foreground }]}
                {...(useUncontrolledInputs
                  ? { defaultValue: maxRouteTimeHours, onChangeText: (t) => { maxRouteTimeHoursRef.current = t; } }
                  : { value: maxRouteTimeHours, onChangeText: setMaxRouteTimeHours })}
                keyboardType="number-pad"
                placeholder="8"
                placeholderTextColor={colors.muted}
              />
            </View>
          </View>

          {/* Advanced options (collapsible) */}
          <TouchableOpacity
            style={[styles.advancedHeader, { borderBottomColor: colors.border }]}
            onPress={() => { hapticImpact(); setAdvancedOpen((o) => !o); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.sectionHeaderSmall, { color: colors.foreground }]}>Advanced options</Text>
            <Ionicons name={advancedOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
          </TouchableOpacity>
          {advancedOpen && (
            <View style={[styles.advancedBody, { borderBottomColor: colors.border }]}>
              <Text style={[styles.helperText, { color: colors.muted, marginBottom: 6 }]}>Depot address</Text>
              <TextInput
                key={useUncontrolledInputs ? `depot-${numericInputsKey}` : undefined}
                style={[styles.input, styles.depotInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground }]}
                placeholder="Defaults to 1st address"
                placeholderTextColor={colors.muted}
                {...(useUncontrolledInputs
                  ? { defaultValue: depotAddress, onChangeText: (t) => { depotAddressRef.current = t; } }
                  : { value: depotAddress, onChangeText: setDepotAddress })}
              />
              <Text style={[styles.helperText, { color: colors.muted, marginTop: 10, marginBottom: 6 }]}>Travel speed factor</Text>
              <TextInput
                key={useUncontrolledInputs ? `speed-${numericInputsKey}` : undefined}
                style={[styles.vehicleInput, styles.travelSpeedInput, { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground }]}
                {...(useUncontrolledInputs
                  ? { defaultValue: travelSpeedFactor, onChangeText: (t) => { travelSpeedFactorRef.current = t; } }
                  : { value: travelSpeedFactor, onChangeText: setTravelSpeedFactor })}
                keyboardType="decimal-pad"
                placeholder="1"
                placeholderTextColor={colors.muted}
              />
              <TouchableOpacity
                style={[styles.valhallaRow, { marginTop: 12, marginBottom: 4 }]}
                onPress={() => { hapticImpact(); setStartFromCurrentPosition((prev) => !prev); }}
                activeOpacity={0.7}
              >
                <View style={[styles.checkmark, { backgroundColor: startFromCurrentPosition ? colors.success : "transparent", borderWidth: 1, borderColor: startFromCurrentPosition ? colors.success : colors.border }]}>
                  {startFromCurrentPosition && <Text style={styles.checkmarkText}>✓</Text>}
                </View>
                <Text style={[styles.valhallaText, { color: colors.foreground }]}>
                  Start from current position
                </Text>
              </TouchableOpacity>
              <Text style={[styles.helperText, { color: colors.muted, marginTop: 10, marginBottom: 6 }]}>Objective</Text>
              <TouchableOpacity
                style={[styles.pickerTrigger, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={() => setPickerOpen("objective")}
              >
                <Text style={{ color: colors.foreground }}>{OBJECTIVE_OPTIONS.find((o) => o.value === objective)?.label ?? objective}</Text>
                <Ionicons name="chevron-down" size={18} color={colors.muted} />
              </TouchableOpacity>
              <Text style={[styles.helperText, { color: colors.muted, marginTop: 10, marginBottom: 6 }]}>Algorithm</Text>
              <TouchableOpacity
                style={[styles.pickerTrigger, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={() => setPickerOpen("algorithm")}
              >
                <Text style={{ color: colors.foreground }} numberOfLines={1}>
                  {ALGORITHM_OPTIONS.find((o) => o.value === algorithm)?.label ?? algorithm}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.muted} />
              </TouchableOpacity>
              <Text style={[styles.helperText, { color: colors.muted, marginTop: 6 }]}>
                Google OR-Tools metaheuristic strategy
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.valhallaRow}
            onPress={() => { hapticImpact(); setUseValhallaApi((prev) => !prev); }}
            activeOpacity={0.7}
          >
            <View style={[styles.checkmark, { backgroundColor: useValhallaApi ? colors.success : "transparent", borderWidth: 1, borderColor: useValhallaApi ? colors.success : colors.border }]}>
              {useValhallaApi && <Text style={styles.checkmarkText}>✓</Text>}
            </View>
            <Text style={[styles.valhallaText, { color: colors.foreground }]}>
              Use Valhalla API (more accurate road distances)
            </Text>
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.optimizeButton, { borderWidth: 2, borderColor: magenta + "99", backgroundColor: colors.primary }, loading && styles.disabled]}
              onPress={runVRP}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="navigate" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={[styles.optimizeButtonText, { color: "#ffffff" }]}>Optimize Routes & Export</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.clearButton, { backgroundColor: colors.muted + "40" }]} onPress={clearAll} activeOpacity={0.8}>
              <Text style={[styles.clearButtonText, { color: colors.foreground }]}>Clear</Text>
            </TouchableOpacity>
          </View>

        </View>

        {/* Picker modal */}
        <Modal visible={pickerOpen !== null} transparent animationType="slide">
          <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(null)}>
            <View style={[styles.pickerModal, { backgroundColor: colors.surface, borderColor: magenta + "66" }]}>
              <Text style={[styles.sectionHeaderSmall, { color: colors.foreground, marginBottom: 12 }]}>
                {pickerOpen === "objective" ? "Objective" : "Algorithm"}
              </Text>
              {pickerOpen === "objective" &&
                OBJECTIVE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.pickerOption, { borderBottomColor: colors.border }, objective === opt.value && { backgroundColor: cyan + "22" }]}
                    onPress={() => { setObjective(opt.value); setPickerOpen(null); hapticImpact(); }}
                  >
                    <Text style={[styles.pickerOptionText, { color: colors.foreground }]}>{opt.label}</Text>
                    {objective === opt.value ? <Ionicons name="checkmark" size={20} color={cyan} /> : null}
                  </TouchableOpacity>
                ))}
              {pickerOpen === "algorithm" &&
                ALGORITHM_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.pickerOption, { borderBottomColor: colors.border }, algorithm === opt.value && { backgroundColor: cyan + "22" }]}
                    onPress={() => { setAlgorithm(opt.value); setPickerOpen(null); hapticImpact(); }}
                  >
                    <Text style={[styles.pickerOptionText, { color: colors.foreground }]} numberOfLines={1}>{opt.label}</Text>
                    {algorithm === opt.value ? <Ionicons name="checkmark" size={20} color={cyan} /> : null}
                  </TouchableOpacity>
                ))}
            </View>
          </Pressable>
        </Modal>

        {/* Delivery instructions – load from one JSON file; auto-matched to route stops by address */}
        <DeliveryInstructionsCard fillScreen={fillScreen} />

        {/* Nominatim search – place name to coordinates */}
        <View style={[styles.card, fillScreen && styles.cardFill, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Search place (Nominatim)
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Search by place name or address to get coordinates, then add to VRP above.
          </Text>
          <TextInput
            key={useUncontrolledInputs ? `nominatim-${nominatimKey}` : undefined}
            ref={nominatimInputRef}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                color: colors.foreground,
                minHeight: 48,
              },
            ]}
            placeholder="e.g. Downtown Montreal, or 123 Main St, Toronto"
            placeholderTextColor={colors.muted}
            {...(useUncontrolledInputs
              ? { defaultValue: "", onChangeText: (t) => { nominatimValueRef.current = t; } }
              : { value: nominatimQuery, onChangeText: setNominatimQuery })}
            onSubmitEditing={runNominatimSearch}
            returnKeyType="search"
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.runButton,
                { backgroundColor: colors.primary },
                nominatimLoading && styles.disabled,
              ]}
              onPress={runNominatimSearch}
              disabled={nominatimLoading}
              activeOpacity={0.8}
            >
              {nominatimLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.runButtonText}>Search</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clearButton, { backgroundColor: colors.muted + "40" }]}
              onPress={() => {
                if (useUncontrolledInputs) {
                  nominatimValueRef.current = "";
                  setNominatimKey((k) => k + 1);
                }
                setNominatimQuery("");
                setNominatimResults([]);
                hapticImpact();
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.clearButtonText, { color: colors.foreground }]}>
                Clear
              </Text>
            </TouchableOpacity>
          </View>
          {nominatimResults.length > 0 ? (
            <View style={[styles.nominatimResults, { borderTopColor: colors.border }]}>
              <Text style={[styles.resultTitle, { color: colors.foreground, marginBottom: 8 }]}>
                Results – tap to add to VRP
              </Text>
              {nominatimResults.map((place, idx) => (
                <TouchableOpacity
                  key={`${place.lat}-${place.lon}-${idx}`}
                  style={[styles.nominatimRow, { borderBottomColor: colors.border }]}
                  onPress={() => addNominatimToVRP(place)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.stopLabel, { color: colors.foreground }]} numberOfLines={2}>
                    {place.display_name}
                  </Text>
                  <Text style={[styles.stopCoords, { color: colors.muted }]}>
                    {place.lat}, {place.lon}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        {result ? (
          <View style={[styles.resultCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.resultTitle, { color: colors.foreground }]}>
              Optimized Route
            </Text>
            <View
              style={[
                styles.statsRow,
                { borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.stat, { color: colors.muted }]}>
                📍 {result.stops.length} stops
                {result.routes && result.routes.length > 1
                  ? ` · ${result.routes.length} vehicles`
                  : ""}
              </Text>
              <Text style={[styles.stat, { color: colors.muted }]}>
                🛣️ {result.totalDistance} km
              </Text>
              <Text style={[styles.stat, { color: colors.muted }]}>
                ⏱️ {result.totalTime} min
              </Text>
            </View>
            {result.routes && result.routes.length > 1 ? (
              result.routes.map((routeStops, routeIdx) => (
                <View key={routeIdx} style={[styles.routeBlock, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.routeLabel, { color: cyan }]}>
                    Route {routeIdx + 1}
                  </Text>
                  {routeStops.map((stop, idx) => (
                    <View
                      key={idx}
                      style={[styles.stopRow, { borderBottomColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.stopNumber,
                          {
                            backgroundColor:
                              idx === 0 || idx === routeStops.length - 1
                                ? colors.success
                                : colors.primary,
                          },
                        ]}
                      >
                        <Text style={styles.stopNumberText}>
                          {idx === 0 ? "S" : idx === routeStops.length - 1 ? "E" : idx}
                        </Text>
                      </View>
                      <View style={styles.stopInfo}>
                        <Text style={[styles.stopLabel, { color: colors.foreground }]}>
                          {stop.label}
                        </Text>
                        <Text style={[styles.stopCoords, { color: colors.muted }]}>
                          {stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))
            ) : (
              result.stops.map((stop, idx) => (
                <View
                  key={idx}
                  style={[styles.stopRow, { borderBottomColor: colors.border }]}
                >
                  <View
                    style={[
                      styles.stopNumber,
                      {
                        backgroundColor:
                          idx === 0 || idx === result.stops.length - 1
                            ? colors.success
                            : colors.primary,
                      },
                    ]}
                  >
                    <Text style={styles.stopNumberText}>
                      {idx === 0 ? "S" : idx === result.stops.length - 1 ? "E" : idx}
                    </Text>
                  </View>
                  <View style={styles.stopInfo}>
                    <Text style={[styles.stopLabel, { color: colors.foreground }]}>
                      {stop.label}
                    </Text>
                    <Text style={[styles.stopCoords, { color: colors.muted }]}>
                      {stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}
                    </Text>
                  </View>
                </View>
              ))
            )}
            <View style={[styles.previewButtonRow, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}
                onPress={handleExportCsv}
                activeOpacity={0.8}
              >
                <Ionicons name="document-text-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>Export CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}
                onPress={handleExportGpx}
                activeOpacity={0.8}
                disabled={exportGpxLoading}
              >
                {exportGpxLoading ? (
                  <ActivityIndicator size="small" color={colors.foreground} style={{ marginRight: 6 }} />
                ) : (
                  <Ionicons name="navigate-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
                )}
                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>
                  {exportGpxLoading ? "Snapping to roads…" : "Export GPX"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}
                onPress={handleExportGpxPerVehicle}
                activeOpacity={0.8}
                disabled={exportGpxLoading}
              >
                {exportGpxLoading ? (
                  <ActivityIndicator size="small" color={colors.foreground} style={{ marginRight: 6 }} />
                ) : (
                  <Ionicons name="archive-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
                )}
                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>
                  {exportGpxLoading ? "Snapping to roads…" : "GPX per vehicle"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewButton, styles.previewButtonSecondary, { borderColor: colors.border }]}
                onPress={handleSaveAsCurrentRoute}
                activeOpacity={0.8}
              >
                <Ionicons name="home-outline" size={18} color={colors.foreground} style={{ marginRight: 6 }} />
                <Text style={[styles.previewButtonTextSecondary, { color: colors.foreground }]}>Save to Home</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.previewButton, { backgroundColor: cyan, borderColor: magenta + "99" }]}
                onPress={handlePreviewRoute}
                activeOpacity={0.8}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <ActivityIndicator size="small" color="#0a0a0a" style={{ marginRight: 6 }} />
                ) : (
                  <Ionicons name="map-outline" size={18} color="#0a0a0a" style={{ marginRight: 6 }} />
                )}
                <Text style={styles.previewButtonText}>{previewLoading ? "Snapping to roads…" : "Preview on map"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Extra padding at bottom for keyboard */}
        <View style={styles.bottomPadding} />
    </>
  );

  // Use keyboard-controller's KeyboardAvoidingView on native (avoids setCenter recursion / runloop hang on iOS).
  // On web, no keyboard avoiding needed.
  if (Platform.OS === "web") {
    return nestedInScrollView ? (
      fillScreen ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, styles.scrollContentFill]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={styles.nestedContent}>{content}</View>
      )
    ) : (
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >
        {content}
      </ScrollView>
    );
  }

  // On iOS: do NOT use KeyboardAvoidingView. It triggers layout (padding/height) on keyboard
  // frame updates, which can block the main thread and make typing lag or drop keystrokes.
  // Rely on ScrollView + deferred scroll on focus instead; user can scroll if keyboard covers content.
  // On Android: use KeyboardAvoidingView with "height" for normal behavior.
  if (Platform.OS === "ios") {
    return nestedInScrollView ? (
      <View style={styles.nestedContent}>{content}</View>
    ) : (
      <View style={styles.keyboardAvoid}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {content}
        </ScrollView>
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      style={nestedInScrollView ? undefined : styles.keyboardAvoid}
      behavior="height"
      keyboardVerticalOffset={0}
    >
      {nestedInScrollView ? (
        <View style={styles.nestedContent}>{content}</View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {content}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  scrollContentFill: {
    flexGrow: 1,
    flexDirection: "column",
  },
  nestedContent: {
    paddingBottom: 20,
  },
  cardFill: {
    flex: 1,
    marginHorizontal: 0,
    minHeight: 0,
  },
  card: {
    margin: 16,
    padding: 16,
    borderRadius: 10,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  sectionHeaderSmall: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  segmentedRow: {
    flexDirection: "row",
    gap: 8,
  },
  segmentedOption: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  segmentedLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
  },
  vehicleRow: {
    flexDirection: "row",
    gap: 10,
  },
  vehicleInputWrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  vehicleLabel: {
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  vehicleInput: {
    fontSize: 16,
    padding: 0,
    minHeight: 36,
  },
  advancedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    marginTop: 12,
    borderBottomWidth: 1,
  },
  advancedBody: {
    paddingVertical: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  depotInput: {
    minHeight: 44,
  },
  travelSpeedInput: {
    maxWidth: 80,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  pickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  optimizeButton: {
    flex: 3,
    flexDirection: "row",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  optimizeButtonText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  pickerModal: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 36,
  },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  pickerOptionText: {
    fontSize: 15,
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  valhallaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  checkmark: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  checkmarkText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  valhallaText: {
    fontSize: 15,
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    fontFamily: "monospace",
  },
  buttonRow: {
    flexDirection: "row",
    marginTop: 16,
    gap: 12,
  },
  runButton: {
    flex: 3,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.6,
  },
  runButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  clearButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  clearButtonText: {
    fontSize: 17,
    fontWeight: "500",
  },
  resultCard: {
    margin: 16,
    marginTop: 0,
    padding: 16,
    borderRadius: 10,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  stat: {
    fontSize: 14,
  },
  routeBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderBottomWidth: 1,
  },
  routeLabel: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  stopNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  stopNumberText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  stopInfo: {
    flex: 1,
  },
  stopLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  stopCoords: {
    fontSize: 13,
    marginTop: 2,
  },
  previewButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  previewButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 0,
  },
  previewButtonSecondary: {
    backgroundColor: "transparent",
  },
  previewButtonText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "700",
  },
  previewButtonTextSecondary: {
    fontSize: 15,
    fontWeight: "600",
  },
  nominatimResults: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  nominatimRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  bottomPadding: {
    height: 150,
  },
});
