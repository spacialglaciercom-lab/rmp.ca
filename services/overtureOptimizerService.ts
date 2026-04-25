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
 *
 * On web (including dev server), requests go to the same-origin API (getApiBaseUrl())
 * so the Node server can proxy to the optimizer and avoid CORS. On native, we call
 * the optimizer URL directly.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";
import { createTimeoutSignal } from "@/lib/abortTimeout";
import { getApiBaseUrl } from "@/shared/oauth";

// ---------------------------------------------------------------------------
// Base URL — optimizer backend (Cloud Run; same backend can have multiple URLs)
// On web we use the dev/API server so /api/optimize is proxied (avoids CORS).
// ---------------------------------------------------------------------------

const OPTIMIZER_BASE_URL =
  process.env.EXPO_PUBLIC_OPTIMIZER_URL ??
  Constants.expoConfig?.extra?.optimizerUrl ??
  "http://localhost:8000";

// getOptimizerBaseUrl() is defined at bottom; on web it returns getApiBaseUrl() for proxy.

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

export interface RouteMetrics {
  physical_distance_m: number;
  adjusted_cost_m: number;
  elevation_gain_m: number;
  turns: { left: number; right: number; u_turn: number; straight: number };
  /** [min_lon, min_lat, max_lon, max_lat] of input road GeoJSON (extractor extent). */
  extractor_input_bbox_lon_lat?: number[] | null;
  /** True when sampled route points stay inside that bbox (axis-aligned, small pad). */
  route_inside_extractor_coord_bbox?: boolean;
  extractor_coord_bbox_violation_count?: number;
}

export interface OptimizeTiming {
  clean_ms: number;
  graph_build_ms: number;
  cpp_solve_ms: number;
  route_build_ms: number;
  analytics_ms: number;
  total_ms: number;
}

export interface OptimizeResponse {
  route: RoutePoint[];
  route_geojson: GeoJSONFeatureCollection;
  total_distance_km: number;
  message: string;
  stats: RouteStats;
  metrics?: RouteMetrics;
  timing_ms?: OptimizeTiming;
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
  /** Exterior ring [lon, lat][] for this zone (convex hull). Enables sector division on the map. */
  zone_polygon?: number[][];
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

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Zone partition (spectral clustering) can be slow on large graphs; allow 2 minutes. */
const ZONE_PARTITION_TIMEOUT_MS = 120_000;

async function request<T>(
  path: string,
  body: unknown,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const base = getOptimizerBaseUrl();
  const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      ...(Platform.OS === "web" && {
        credentials: "include" as RequestCredentials,
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errorBody = await res.text();
      let detail: unknown = errorBody;
      let hint: string | undefined;
      try {
        const parsed = JSON.parse(errorBody) as {
          detail?: unknown;
          message?: string;
          error?: string;
          details?: string;
          hint?: string;
          target?: string;
        };
        detail = parsed.detail ?? parsed.message ?? parsed.error ?? errorBody;
        hint = parsed.hint;
        // 502 from our optimizer proxy: show backend unreachable reason + target
        if (res.status === 502 && (parsed.error || parsed.details)) {
          const parts = [parsed.error, parsed.details, parsed.target].filter(Boolean);
          detail = parts.join(" — ");
        }
      } catch {}
      let message = formatApiErrorDetail(res.status, detail);
      if (res.status === 503 && hint) {
        message += ` ${hint}`;
      }
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as { name?: string }).name === "AbortError") {
      throw new Error(
        `Backend optimizer timed out after ${timeoutMs / 1000}s – falling back to offline`,
      );
    }
    throw err;
  }
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
  const url = baseUrl ?? getOptimizerBaseUrl();
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
        ...(Platform.OS === "web" && {
          credentials: "include" as RequestCredentials,
        }),
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

/** Optional cleaning options (backend CleanOptions). Used when clean_before_optimize is true. */
export interface CleanOptions {
  makevalid?: boolean;
  drop_invalid?: boolean;
  remove_selfloops?: boolean;
  min_length_m?: number;
  node_snap_m?: number;
  dedupe_edges?: boolean;
  remove_isolates?: boolean;
  max_components?: number;
  required_attrs?: string[] | null;
  merge_parallel_edges?: boolean;
}

/** App-side routing config shape (onewayMode, serviceBothSides, turnPenalties). */
export interface OvertureOptimizerRoutingConfig {
  onewayMode?: string;
  serviceBothSides?: boolean;
  turnPenalties?: { leftTurn?: number; uTurn?: number; rightTurn?: number };
}

/** Params accepted by optimizeRoute (API shape). Used by buildOvertureOptimizeRequest. */
export type OptimizeRouteParams = {
  geojson: GeoJSONFeatureCollection;
  start_lat?: number;
  start_lon?: number;
  oneway_mode?: string;
  service_both_sides?: boolean;
  road_classes?: string[];
  turn_penalties?: { left_turn?: number; u_turn?: number; right_turn?: number };
  clean_before_optimize?: boolean;
  clean_options?: CleanOptions;
  /** When true, backend applies UPS-style turn penalty plugin (left/U-turn multipliers). */
  use_turn_penalty_plugin?: boolean;
};

/**
 * Build the same request params used by the Map's Overture Route Optimizer.
 * Use from both the Map (OSM Extractor) and the Planner (v2 off) so both paths are identical.
 * By default does not include clean_before_optimize so the request matches the Map Extractor.
 * Planner can pass cleanBeforeOptimize: true for OSM-derived GeoJSON so the backend runs
 * vector_clean before building the graph (dedupe edges, etc.), which often reduces looping.
 */
export function buildOvertureOptimizeRequest(params: {
  geojson: GeoJSONFeatureCollection;
  start_lat?: number;
  start_lon?: number;
  config?: OvertureOptimizerRoutingConfig | null;
  /** When true, backend runs clean pipeline before optimizing. Omit for Map (Overture GeoJSON); set true for Planner (OSM-derived GeoJSON) to reduce looping. */
  cleanBeforeOptimize?: boolean;
  /** When true, backend applies UPS-style turn penalty plugin. Usually set from Settings → Plugins "Turn penalty (UPS-style)" toggle. */
  useTurnPenaltyPlugin?: boolean;
  overrides?: {
    oneway_mode?: string;
    service_both_sides?: boolean;
    turn_penalties?: {
      left_turn?: number;
      u_turn?: number;
      right_turn?: number;
    };
    road_classes?: string[];
  };
}): OptimizeRouteParams {
  const c = params.config;
  const turnPenalties = c?.turnPenalties;
  /** Planner/Map use A=ignore, B=respect; backend expects ignore|respect. */
  const rawOneway = params.overrides?.oneway_mode ?? c?.onewayMode ?? "A";
  const r = String(rawOneway).toLowerCase();
  const oneway_mode: "ignore" | "respect" =
    r === "b" || r === "respect" ? "respect" : "ignore";

  const result: OptimizeRouteParams = {
    geojson: params.geojson,
    start_lat: params.start_lat,
    start_lon: params.start_lon,
    oneway_mode,
    service_both_sides: false, // backend always one pass; offline v2 always both sides
    turn_penalties:
      params.overrides?.turn_penalties ??
      (turnPenalties
        ? {
            left_turn: turnPenalties.leftTurn ?? 50,
            u_turn: turnPenalties.uTurn ?? 100,
            right_turn: turnPenalties.rightTurn ?? 0,
          }
        : undefined),
    road_classes: params.overrides?.road_classes,
    use_turn_penalty_plugin: params.useTurnPenaltyPlugin,
  };
  if (params.cleanBeforeOptimize === true) {
    result.clean_before_optimize = true;
  }
  return result;
}

export async function optimizeRoute(
  params: OptimizeRouteParams,
): Promise<OptimizeResponse> {
  return request<OptimizeResponse>("/api/optimize/sync", params);
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
  return request<ZonesPartitionResponse>(
    "/api/zones/partition",
    params,
    ZONE_PARTITION_TIMEOUT_MS,
  );
}

/** Request body for partition-by-polygon (backend may implement this to extract + partition in one step). */
export interface ZonesPartitionByPolygonRequest {
  /** Polygon ring as [lat, lon][] (closed ring; first point may repeat at end). */
  polygon: Array<[number, number]>;
  truck_count: number;
  balance_metric: "time" | "distance";
}

/**
 * Partition a polygon area into zones (optimizer builds graph from polygon and runs spectral clustering).
 * Sends the result to the Zones store when used from the Extract page.
 * Backend must implement POST /api/zones/partition-by-polygon.
 */
export async function partitionZonesByPolygon(
  params: ZonesPartitionByPolygonRequest,
): Promise<ZonesPartitionResponse> {
  return request<ZonesPartitionResponse>(
    "/api/zones/partition-by-polygon",
    params,
    ZONE_PARTITION_TIMEOUT_MS,
  );
}

/** Request body for partition-from-geojson (use after Extract & Process: send road GeoJSON). */
export interface ZonesPartitionFromGeoJSONRequest {
  geojson: GeoJSONFeatureCollection;
  truck_count: number;
  balance_metric: "time" | "distance";
}

/**
 * Partition road GeoJSON into zones. Use after Extract & Process: fetch GeoJSON from the result URL, then call this.
 * Backend implements POST /api/zones/partition-from-geojson.
 */
export async function partitionZonesFromGeoJSON(
  params: ZonesPartitionFromGeoJSONRequest,
): Promise<ZonesPartitionResponse> {
  return request<ZonesPartitionResponse>(
    "/api/zones/partition-from-geojson",
    params,
    ZONE_PARTITION_TIMEOUT_MS,
  );
}

/** One point (e.g. delivery address or stop) for partition-from-points. */
export interface PointInput {
  lat: number;
  lon: number;
  /** Optional workload; used when balance_metric is "weight". Default 1. */
  weight?: number;
}

/** Request body for partition-from-points: build KNN graph from points and partition. */
export interface ZonesPartitionFromPointsRequest {
  points: PointInput[];
  truck_count: number;
  /** "count" = equal points per zone, "weight" = by point weight, "distance" = by spatial spread */
  balance_metric?: "count" | "weight" | "distance";
  /** KNN neighbors; 0 = pure KMeans (no graph). Default 5. */
  knn_neighbors?: number;
  /** Include convex hull polygon per zone. Default true. */
  include_polygons?: boolean;
}

/**
 * Partition points (lat/lon/weight) into zones. Builds a KNN graph and runs spectral clustering,
 * or pure KMeans when knn_neighbors=0. Backend: POST /api/zones/partition-from-points.
 */
export async function partitionZonesFromPoints(
  params: ZonesPartitionFromPointsRequest,
): Promise<ZonesPartitionResponse> {
  return request<ZonesPartitionResponse>(
    "/api/zones/partition-from-points",
    params,
    ZONE_PARTITION_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Async job submission + status polling (Celery path)
// ---------------------------------------------------------------------------

export interface SubmitJobResponse {
  task_id: string;
  status: "PENDING";
}

export interface TaskStatusResponse {
  task_id: string;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILURE" | string;
  result?: OptimizeResponse;
  error?: string;
}

/** Submit to the async Celery endpoint. Returns task_id immediately (HTTP 202). */
export async function submitOptimizeJob(
  params: OptimizeRouteParams,
): Promise<SubmitJobResponse> {
  const base = getOptimizerBaseUrl();
  const url = `${base.replace(/\/$/, "")}/api/optimize`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    ...(Platform.OS === "web" && {
      credentials: "include" as RequestCredentials,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to submit job (${res.status}): ${body}`);
  }
  return res.json() as Promise<SubmitJobResponse>;
}

/**
 * Fetch one status snapshot for a running job.
 * FAILURE returns 400/500 from the backend — we parse JSON regardless so the
 * caller gets the structured `error` field rather than a raw HTTP exception.
 */
export async function pollOptimizeStatus(
  taskId: string,
  signal: AbortSignal,
): Promise<TaskStatusResponse> {
  const base = getOptimizerBaseUrl();
  const url = `${base.replace(/\/$/, "")}/api/optimize/status/${taskId}`;
  const res = await fetch(url, { signal });
  return res.json() as Promise<TaskStatusResponse>;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const base = getOptimizerBaseUrl();
    // Node proxy exposes optimizer health at /optimizer/health
    const healthPath = Platform.OS === "web" ? "/optimizer/health" : "/health";
    const res = await fetch(`${base.replace(/\/$/, "")}${healthPath}`, {
      signal: createTimeoutSignal(5_000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}

/** On web uses API server base (proxy); on native uses optimizer URL directly. */
export function getOptimizerBaseUrl(): string {
  if (Platform.OS === "web") {
    return getApiBaseUrl();
  }
  return OPTIMIZER_BASE_URL;
}
