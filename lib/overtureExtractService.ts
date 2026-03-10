/**
 * Overture Extract WebSocket client + helpers.
 * Connects to the web extractor backend to extract & process road networks from Overture Maps data.
 * By default the app connects directly to the extract service (EXPO_PUBLIC_OVERTURE_EXTRACT_URL).
 * To route WebSocket via the main backend proxy instead (e.g. if the extract service blocks browser origins),
 * set EXPO_PUBLIC_OVERTURE_WS_BASE to your main API URL (e.g. https://rmp-ca-286569721223.europe-west1.run.app).
 */

import Constants from "expo-constants";
import { area as turfArea } from "@turf/area";
import { length as turfLength } from "@turf/length";

// ---------------------------------------------------------------------------
// Extract backend URL. HTTP_BASE used for /geojson/, /download/ (after extract).
// WS_BASE: direct to extract service by default; set EXPO_PUBLIC_OVERTURE_WS_BASE to use main backend proxy.
// ---------------------------------------------------------------------------
const DEFAULT_EXTRACT_BASE =
  "https://webovertureextract2-286569721223.northamerica-northeast1.run.app";
const defaultHttpBase =
  process.env.EXPO_PUBLIC_OVERTURE_EXTRACT_URL ??
  Constants.expoConfig?.extra?.extractUrl ??
  process.env.EXPO_PUBLIC_OPTIMIZER_URL ??
  Constants.expoConfig?.extra?.optimizerUrl ??
  DEFAULT_EXTRACT_BASE;
const defaultWsBase = defaultHttpBase
  .replace(/^https:\/\//i, "wss://")
  .replace(/^http:\/\//i, "ws://");

const HTTP_BASE = process.env.EXPO_PUBLIC_OVERTURE_HTTP_BASE ?? defaultHttpBase;
const WS_BASE = process.env.EXPO_PUBLIC_OVERTURE_WS_BASE ?? defaultWsBase;

export const WS_EXTRACT_URL = `${WS_BASE}/ws/extract`;
export const httpGeoJSONUrl = (hash: string) => `${HTTP_BASE}/geojson/${hash}`;
export const httpDownloadUrl = (hash: string) =>
  `${HTTP_BASE}/download/${hash}`;
export const httpGraphUrl = (hash: string) => `${HTTP_BASE}/download/${hash}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ExtractionStage =
  | "connecting"
  | "downloading"
  | "clipping"
  | "building_graph"
  | "complete"
  | "error";

export interface ExtractionProgress {
  stage: ExtractionStage;
  message: string;
  percent?: number;
  /** Available after stage = complete */
  hash?: string;
  stats?: ExtractionStats;
}

export interface ExtractionStats {
  points: number;
  roads: number;
  nodes: number;
  edges: number;
  segmentsLengthKm?: number;
}

export interface RoadSegment {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: Record<string, unknown>;
}

export interface SegmentMeasurement {
  from: number;
  to: number;
  distanceKm: number;
}

export interface ElevationStats {
  min: number;
  median: number;
  max: number;
}

export interface MeasurementMetrics {
  areaKm2: number;
  perimeterKm: number;
  segments: SegmentMeasurement[];
  elevation?: ElevationStats;
}

// ---------------------------------------------------------------------------
// Area / perimeter helpers using @turf
// ---------------------------------------------------------------------------
export function computePolygonMetrics(
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
): MeasurementMetrics {
  const areaM2 = turfArea(polygon);
  const areaKm2 = areaM2 / 1e6;

  // Perimeter: create a LineString from the ring and measure its length
  const ring = polygon.geometry.coordinates[0];
  const perimeterLine: GeoJSON.Feature<GeoJSON.LineString> = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: ring },
    properties: {},
  };
  const perimeterKm = turfLength(perimeterLine, { units: "kilometers" });

  // Calculate individual segment distances (pt1-pt2, pt2-pt3, etc.)
  const segments: SegmentMeasurement[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const segmentLine: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [ring[i], ring[i + 1]] },
      properties: {},
    };
    const distanceKm = turfLength(segmentLine, { units: "kilometers" });
    segments.push({ from: i + 1, to: i + 2, distanceKm });
  }

  return { areaKm2, perimeterKm, segments };
}

/** Build a GeoJSON Polygon Feature from an array of [lng, lat] coordinates. */
export function coordsToPolygonFeature(
  coords: [number, number][],
): GeoJSON.Feature<GeoJSON.Polygon> {
  // Ensure closed ring
  const ring = [...coords];
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push(ring[0]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {},
  };
}

function getStageMessage(stage: string): string {
  switch (stage) {
    case "downloading":
      return "Downloading Overture data...";
    case "clipping":
      return "Clipping to polygon...";
    case "building_graph":
      return "Building road network graph...";
    case "complete":
      return "Extraction complete!";
    default:
      return `${stage}...`;
  }
}

// ---------------------------------------------------------------------------
// WebSocket extraction client
// ---------------------------------------------------------------------------
export function connectAndExtract(
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
  onProgress: (progress: ExtractionProgress) => void,
  onComplete: (hash: string, stats: ExtractionStats) => void,
  onError: (error: string) => void,
): { cancel: () => void } {
  let ws: WebSocket | null = null;
  let cancelled = false;

  const connect = () => {
    console.log("[WebSocket] WS_EXTRACT_URL:", WS_EXTRACT_URL);
    console.log("[WebSocket] WebSocket available:", typeof WebSocket);
    console.log(
      "[WebSocket] isDev:",
      __DEV__,
      "hostname:",
      typeof window !== "undefined" ? window.location?.hostname : "no window",
    );

    onProgress({ stage: "connecting", message: "Connecting to server..." });

    try {
      ws = new WebSocket(WS_EXTRACT_URL);
      console.log("[WebSocket] Created WebSocket:", ws);
    } catch (error) {
      console.error("[WebSocket] Failed to create WebSocket:", error);
      onError(`Failed to create WebSocket: ${error}`);
      return;
    }

    ws.onopen = () => {
      console.log("[WebSocket] Connected to", WS_EXTRACT_URL);
      if (cancelled) {
        ws?.close();
        return;
      }
      // Send the polygon for extraction (webovertureextract expects {polygon: geometry})
      const payload = JSON.stringify({
        polygon: polygon.geometry,
      });
      console.log(
        "[WebSocket] Sending:",
        JSON.stringify({ polygon: polygon.geometry }, null, 2),
      );
      ws!.send(payload);
      onProgress({
        stage: "downloading",
        message: "Downloading Overture data...",
        percent: 0,
      });
    };

    ws.onmessage = (event) => {
      if (cancelled) return;
      console.log("[WebSocket] Received:", event.data);
      try {
        const msg = JSON.parse(event.data);
        console.log("[WebSocket] Parsed message:", msg);

        if (msg.stage === "complete") {
          // Extract hash from geojson_url (format: "/geojson/{hash}")
          const hash = msg.geojson_url ? msg.geojson_url.split("/").pop() : "";
          // webovertureextract sends:
          //   segments = raw road count from Overture (before graph building)
          //   nodes = graph nodes (intersections)
          //   edges = graph edges (road segments split at intersections)
          const stats: ExtractionStats = {
            points: msg.nodes ?? 0,
            roads: msg.segments ?? 0, // Raw road segments from Overture
            nodes: msg.nodes ?? 0,
            edges: msg.edges ?? 0,
          };
          onProgress({
            stage: "complete",
            message: "Extraction complete!",
            percent: 100,
            hash: hash,
            stats,
          });
          onComplete(hash, stats);
        } else if (msg.stage === "error") {
          onError(msg.error ?? "Unknown extraction error");
        } else {
          // Progress messages (downloading, clipping, building_graph)
          onProgress({
            stage: msg.stage ?? "downloading",
            message: getStageMessage(msg.stage),
            percent: msg.progress ?? 0,
          });
        }
      } catch (e) {
        console.log("[WebSocket] Failed to parse message:", e, event.data);
        // non-JSON message, ignore
      }
    };

    ws.onerror = (error) => {
      console.log("[WebSocket] Error:", error);
      if (!cancelled) {
        onError(
          "WebSocket connection error. If you see 502 in the console, the extract backend or its WebSocket proxy may be down or misconfigured.",
        );
      }
    };

    ws.onclose = (event) => {
      console.log("[WebSocket] Closed:", event.code, event.reason);
      if (!cancelled && event.code !== 1000) {
        const hint =
          event.code === 1006
            ? " Often caused by 502 Bad Gateway: ensure the backend has the /ws/extract proxy enabled and the upstream extract service is running."
            : "";
        onError(`Connection closed unexpectedly (code ${event.code}).${hint}`);
      }
    };
  };

  connect();

  return {
    cancel: () => {
      cancelled = true;
      if (ws && ws.readyState <= WebSocket.OPEN) {
        ws.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Async extractOverture: Promise-based API for plugin / programmatic use
// ---------------------------------------------------------------------------

/** Max request/response body size hint (backend clean uses 50MB); warn on very large extracts. */
export const EXTRACT_RESPONSE_SIZE_WARN_BYTES = 50 * 1024 * 1024;

/** Cache key TTL for extract cache (AsyncStorage). */
const EXTRACT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Max cached GeoJSON string length (AsyncStorage ~2MB limit per key). */
const EXTRACT_CACHE_MAX_BYTES = 1.5 * 1024 * 1024;

function simpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h << 5) + h + str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

const EXTRACT_CACHE_PREFIX = "overture_extract_";

async function getCachedExtract(key: string): Promise<{
  geojson: GeoJSON.FeatureCollection;
  stats?: ExtractionStats;
} | null> {
  try {
    const { default: AsyncStorage } =
      await import("@react-native-async-storage/async-storage");
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      geojson: GeoJSON.FeatureCollection;
      stats?: ExtractionStats;
      cachedAt: number;
    };
    if (Date.now() - data.cachedAt > EXTRACT_CACHE_TTL_MS) return null;
    return { geojson: data.geojson, stats: data.stats };
  } catch {
    return null;
  }
}

async function setCachedExtract(
  key: string,
  geojson: GeoJSON.FeatureCollection,
  stats?: ExtractionStats,
): Promise<void> {
  const payload = JSON.stringify({ geojson, stats, cachedAt: Date.now() });
  if (payload.length > EXTRACT_CACHE_MAX_BYTES) return;
  try {
    const { default: AsyncStorage } =
      await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem(key, payload);
  } catch {
    // ignore
  }
}

function collectWarnings(geojson: GeoJSON.FeatureCollection): string[] {
  const warnings: string[] = [];
  if (!geojson.features?.length) {
    warnings.push("No features in extraction result.");
    return warnings;
  }
  let invalid = 0;
  for (const f of geojson.features) {
    if (!f?.geometry?.type || !f.geometry.coordinates) invalid++;
  }
  if (invalid > 0) {
    const pct = Math.round((invalid / geojson.features.length) * 100);
    warnings.push(
      `${invalid} invalid feature(s) (${pct}%) — check CRS (expected EPSG:4326) and geometry validity.`,
    );
  }
  return warnings;
}

export interface ExtractOvertureResult {
  geojson: GeoJSON.FeatureCollection;
  stats?: ExtractionStats;
  warnings: string[];
}

/** Default extraction timeout (5 minutes). */
const DEFAULT_EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

export interface ExtractOvertureOptions {
  theme?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Extract road network GeoJSON for a polygon via WebSocket backend.
 * - CRS: Coordinates are EPSG:4326 (WGS84). Other CRS must be converted before/after.
 * - Invalid features: collectWarnings() reports invalid or missing geometry; downstream clean has 50MB body limit.
 * - Large datasets: consider background processing (e.g. expo-task-manager) to avoid blocking the UI.
 * Uses AsyncStorage cache when result size is under ~1.5MB (24h TTL).
 *
 * @param polygon - The polygon to extract data for
 * @param options - Optional configuration: theme, AbortSignal for cancellation, timeoutMs
 */
export async function extractOverture(
  polygon: GeoJSON.Feature<GeoJSON.Polygon>,
  options?: ExtractOvertureOptions | string,
): Promise<ExtractOvertureResult> {
  const opts: ExtractOvertureOptions =
    typeof options === "string" ? { theme: options } : (options ?? {});
  const theme = opts.theme ?? "roads";
  const signal = opts.signal;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS;

  const cacheKey =
    EXTRACT_CACHE_PREFIX +
    simpleHash(JSON.stringify(polygon.geometry.coordinates) + theme);

  const cached = await getCachedExtract(cacheKey);
  if (cached) {
    return {
      geojson: cached.geojson,
      stats: cached.stats,
      warnings: [],
    };
  }

  return new Promise<ExtractOvertureResult>((resolve, reject) => {
    let settled = false;

    const handle = connectAndExtract(
      polygon,
      () => {},
      async (hash, stats) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          const url = httpGeoJSONUrl(hash);
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(`Failed to load GeoJSON: ${res.status}`);
          const rawGeojson = (await res.json()) as GeoJSON.FeatureCollection;
          const sizeBytes = res.headers.get("content-length")
            ? parseInt(res.headers.get("content-length")!, 10)
            : 0;
          if (sizeBytes > EXTRACT_RESPONSE_SIZE_WARN_BYTES) {
            console.warn(
              "[extractOverture] Large response; downstream 50MB limit may apply.",
            );
          }
          const warnings = collectWarnings(rawGeojson);
          await setCachedExtract(cacheKey, rawGeojson, stats);
          resolve({
            geojson: rawGeojson,
            stats,
            warnings,
          });
        } catch (err) {
          reject(err);
        }
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error(error));
      },
    );

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      handle.cancel();
      reject(new Error(`Extraction timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        settled = true;
        clearTimeout(timeoutId);
        handle.cancel();
        reject(new Error("Extraction aborted"));
      } else {
        signal.addEventListener(
          "abort",
          () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            handle.cancel();
            reject(new Error("Extraction aborted"));
          },
          { once: true },
        );
      }
    }
  });
}
