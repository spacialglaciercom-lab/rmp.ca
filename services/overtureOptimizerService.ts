/**
 * Overture Optimizer Service
 *
 * Client for the FastAPI backend's Overture-based route optimization endpoint.
 * Handles split road segments with linear reference fields (start_lr, end_lr)
 * and source_id grouping.
 *
 * Also provides a general-purpose client for the Python/FastAPI backend:
 *   POST /api/optimize        — Chinese Postman route optimization
 *   POST /api/geojson/filter   — Filter GeoJSON by polygon + road classes
 *   POST /api/geojson/validate — Validate GeoJSON structure
 *   POST /api/geojson/roads    — Extract road features from raw Overture GeoJSON
 *   POST /api/zones/partition  — Spectral clustering zones partition (no GNN)
 */

import Constants from "expo-constants";

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

const OPTIMIZER_BASE_URL =
  process.env.EXPO_PUBLIC_OPTIMIZER_URL ??
  Constants.expoConfig?.extra?.optimizerUrl ??
  "https://rmp-ca-286569721223.europe-west1.run.app";

// ---------------------------------------------------------------------------
// Overture Split-Segment Types
// ---------------------------------------------------------------------------

export interface SplitStats {
  original_count: number;
  split_count: number;
  avg_splits_per_segment: number;
}

export interface OvertureSegment {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  polyline: Array<{ lat: number; lon: number }>;
  distance: number;
  start_lr: number;
  end_lr: number;
  source_id: string;
  was_split: boolean;
  street_name?: string;
}

export interface OptimizeRouteRequest {
  bounds: {
    min_lat: number;
    min_lon: number;
    max_lat: number;
    max_lon: number;
  };
  depot?: { lat: number; lon: number };
  options?: Record<string, unknown>;
}

export interface OptimizeRouteResponse {
  segments: OvertureSegment[];
  total_distance_km: number;
  estimated_duration_min: number;
  split_stats: SplitStats;
  algorithm: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// General-Purpose Types
// ---------------------------------------------------------------------------

export interface RoutePoint {
  latitude: number;
  longitude: number;
  node_id?: string | null;
}

export interface RouteStats {
  total_traversals: number;
  total_distance_km: number;
  right_turns: number;
  left_turns: number;
  u_turns: number;
  straight: number;
  dead_ends: number;
  odd_degree_vertices: number;
  edges_in_graph: number;
  nodes_in_graph: number;
  deadhead_distance_km: number;
  efficiency: number;
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface OptimizeResponse {
  route: RoutePoint[];
  route_geojson: GeoJSONFeatureCollection;
  total_distance_km: number;
  message: string;
  stats: RouteStats;
}

export interface ValidateResponse {
  valid: boolean;
  feature_count: number;
  geometry_types: Record<string, number>;
  road_classes: Record<string, number>;
  has_linestrings: boolean;
  bbox: number[] | null;
  warnings: string[];
}

export interface FilterResponse {
  geojson: GeoJSONFeatureCollection;
  feature_count: number;
  road_class_counts: Record<string, number>;
}

export interface RoadExtractResponse {
  roads: GeoJSONFeatureCollection;
  road_count: number;
  road_class_counts: Record<string, number>;
  total_length_km: number;
}

// ---------------------------------------------------------------------------
// Zones partition (spectral clustering)
// ---------------------------------------------------------------------------

export interface ZonesPartitionEdge {
  u: number;
  v: number;
  length?: number;
  intersection_density?: number;
  cul_de_sac_penalty?: number;
  width_penalty?: number;
}

export interface ZonesPartitionRequest {
  edges: ZonesPartitionEdge[];
  node_count: number;
  truck_count: number;
  balance_metric: "time" | "distance";
}

export interface ZoneOutput {
  zone_id: number;
  node_ids: number[];
  estimated_time: number;
  estimated_distance?: number;
}

export interface ZonesPartitionResponse {
  zones: ZoneOutput[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OvertureOptimizerError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: unknown,
  ) {
    super(message);
    this.name = "OvertureOptimizerError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format FastAPI 422/validation error detail (array of { loc, msg, type }) into a readable string. */
function formatApiErrorDetail(status: number, detail: unknown): string {
  const prefix = `Optimizer API error (${status})`;
  if (typeof detail === "string") return `${prefix}: ${detail}`;
  if (Array.isArray(detail)) {
    const lines = detail.map((d: { loc?: unknown[]; msg?: string }) => {
      const msg = typeof d?.msg === "string" ? d.msg : JSON.stringify(d);
      const loc = Array.isArray(d?.loc) ? d.loc.join(".") : "";
      return loc ? `${msg} (${loc})` : msg;
    });
    return `${prefix}: ${lines.join("; ")}`;
  }
  if (detail !== null && typeof detail === "object" && "msg" in detail) {
    const msg = (detail as { msg?: string }).msg;
    if (typeof msg === "string") return `${prefix}: ${msg}`;
  }
  return `${prefix}: ${JSON.stringify(detail)}`;
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const url = `${OPTIMIZER_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let detail: unknown = errorBody;
    try {
      const parsed = JSON.parse(errorBody);
      detail = parsed.detail ?? parsed.message ?? errorBody;
    } catch {}
    const message = formatApiErrorDetail(res.status, detail);
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Overture Optimizer
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000;

export async function optimizeOvertureRoute(
  request: OptimizeRouteRequest,
  baseUrl?: string,
  options?: { timeoutMs?: number },
): Promise<OptimizeRouteResponse> {
  const url = baseUrl ?? OPTIMIZER_BASE_URL;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${url.replace(/\/$/, "")}/overture/optimize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new OvertureOptimizerError(
        `Overture optimization failed (HTTP ${response.status})`,
        response.status,
        errorBody,
      );
    }

    const result: OptimizeRouteResponse = await response.json();

    if (__DEV__ && result.split_stats) {
      console.log("[OvertureOptimizer] Split stats:", {
        original: result.split_stats.original_count,
        afterSplit: result.split_stats.split_count,
        avgSplits: result.split_stats.avg_splits_per_segment.toFixed(2),
      });
    }

    return result;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof OvertureOptimizerError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new OvertureOptimizerError(
        `Request timed out after ${timeoutMs / 1000} seconds`,
        408,
        {},
      );
    }
    throw new OvertureOptimizerError(
      `Network error: ${(err as Error).message}`,
      0,
      {},
    );
  }
}

// ---------------------------------------------------------------------------
// General-Purpose Endpoints
// ---------------------------------------------------------------------------

export async function optimizeRoute(params: {
  geojson: GeoJSONFeatureCollection;
  start_lat?: number;
  start_lon?: number;
  oneway_mode?: string;
  road_classes?: string[];
  turn_penalties?: { left_turn?: number; u_turn?: number; right_turn?: number };
}): Promise<OptimizeResponse> {
  return request<OptimizeResponse>("/api/optimize", params);
}

export async function validateGeoJSON(
  geojson: GeoJSONFeatureCollection,
): Promise<ValidateResponse> {
  return request<ValidateResponse>("/api/geojson/validate", geojson);
}

export async function filterGeoJSON(params: {
  geojson: GeoJSONFeatureCollection;
  polygon?: Array<{ lat: number; lon: number }>;
  road_classes?: string[];
}): Promise<FilterResponse> {
  return request<FilterResponse>("/api/geojson/filter", params);
}

export async function extractRoads(
  geojson: GeoJSONFeatureCollection,
): Promise<RoadExtractResponse> {
  return request<RoadExtractResponse>("/api/geojson/roads", geojson);
}

/**
 * Partition a graph into truck zones using spectral clustering (no GNN).
 * Uses the same optimizer backend (Google Run). Balance is by total edge length × complexity factor.
 */
export async function partitionZones(
  params: ZonesPartitionRequest,
): Promise<ZonesPartitionResponse> {
  return request<ZonesPartitionResponse>("/api/zones/partition", params);
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${OPTIMIZER_BASE_URL}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}

export function getOptimizerBaseUrl(): string {
  return OPTIMIZER_BASE_URL;
}
