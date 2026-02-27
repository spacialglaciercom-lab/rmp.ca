/**
 * Overture Extract WebSocket client + helpers.
 * Connects to the Railway backend (same as webovertureextract web app)
 * to extract & process road networks from Overture Maps data.
 */

import { area as turfArea } from "@turf/area";
import { length as turfLength } from "@turf/length";

// ---------------------------------------------------------------------------
// Backend URLs
// ---------------------------------------------------------------------------
const isDev = __DEV__ && typeof window !== "undefined" && window.location?.hostname === "localhost";
const WS_BASE = process.env.EXPO_PUBLIC_OVERTURE_WS_BASE ||
  (isDev ? "ws://localhost:8000" : "wss://striking-reflection-backend.up.railway.app");
const HTTP_BASE = process.env.EXPO_PUBLIC_OVERTURE_HTTP_BASE ||
  (isDev ? "http://localhost:8000" : "https://striking-reflection-backend.up.railway.app");

export const WS_EXTRACT_URL = `${WS_BASE}/ws/extract`;
export const httpGeoJSONUrl = (hash: string) => `${HTTP_BASE}/geojson/${hash}`;
export const httpDownloadUrl = (hash: string) => `${HTTP_BASE}/download/${hash}`;
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

export interface MeasurementMetrics {
  areaKm2: number;
  perimeterKm: number;
  segments: SegmentMeasurement[];
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

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
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
    console.log("[WebSocket] isDev:", __DEV__, "hostname:", typeof window !== "undefined" ? window.location?.hostname : "no window");

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
      console.log("[WebSocket] Sending:", JSON.stringify({polygon: polygon.geometry}, null, 2));
      ws!.send(payload);
      onProgress({ stage: "downloading", message: "Downloading Overture data...", percent: 0 });
    };

    ws.onmessage = (event) => {
      if (cancelled) return;
      console.log("[WebSocket] Received:", event.data);
      try {
        const msg = JSON.parse(event.data);
        console.log("[WebSocket] Parsed message:", msg);

        if (msg.stage === "complete") {
          // Extract hash from geojson_url (format: "/geojson/{hash}")
          const hash = msg.geojson_url ? msg.geojson_url.split('/').pop() : '';
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
        onError("WebSocket connection error");
      }
    };

    ws.onclose = (event) => {
      console.log("[WebSocket] Closed:", event.code, event.reason);
      if (!cancelled && event.code !== 1000) {
        onError(`Connection closed unexpectedly (code ${event.code})`);
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
