/**
 * Extract configuration - URLs for WebSocket and HTTP endpoints.
 * Separated to avoid circular dependency between overtureExtractService and extractDiagnostics.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/shared/oauth";

// ---------------------------------------------------------------------------
// Extract backend URL. On web with no env set, use same-origin (no Railway).
// Set EXPO_PUBLIC_OVERTURE_EXTRACT_URL or EXPO_PUBLIC_OVERTURE_WS_BASE for local/custom backend.
// On web we prefer the API base so the browser hits the Node server, which proxies to the extract service.
// ---------------------------------------------------------------------------
const DEFAULT_EXTRACT_BASE = "http://localhost:9000";

function getDefaultExtractBase(): string {
  const env =
    process.env.EXPO_PUBLIC_OVERTURE_EXTRACT_URL ??
    Constants.expoConfig?.extra?.extractUrl ??
    process.env.EXPO_PUBLIC_OPTIMIZER_URL ??
    Constants.expoConfig?.extra?.optimizerUrl;
  if (env) return env;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return getApiBaseUrl();
  }
  return DEFAULT_EXTRACT_BASE;
}

const defaultHttpBase = getDefaultExtractBase();
const defaultWsBase = defaultHttpBase
  .replace(/^https:\/\//i, "wss://")
  .replace(/^http:\/\//i, "ws://");

function apiBaseToWsUrl(api: string): string {
  return api.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
}

/** Web: same-origin API (Node proxies /ws/extract, /geojson/:hash). Native: use main API when EXPO_PUBLIC_API_BASE_URL is set (Expo Go / prod). */
function getExtractHttpBase(): string {
  if (process.env.EXPO_PUBLIC_OVERTURE_HTTP_BASE) return process.env.EXPO_PUBLIC_OVERTURE_HTTP_BASE;
  if (Platform.OS === "web" && typeof window !== "undefined") return getApiBaseUrl();
  if (process.env.EXPO_PUBLIC_API_BASE_URL?.trim()) return getApiBaseUrl();
  return defaultHttpBase;
}

function getExtractWsBase(): string {
  if (process.env.EXPO_PUBLIC_OVERTURE_WS_BASE) return process.env.EXPO_PUBLIC_OVERTURE_WS_BASE;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return apiBaseToWsUrl(getApiBaseUrl());
  }
  if (process.env.EXPO_PUBLIC_API_BASE_URL?.trim()) {
    return apiBaseToWsUrl(getApiBaseUrl());
  }
  return defaultWsBase;
}

const HTTP_BASE = getExtractHttpBase();
const WS_BASE = getExtractWsBase();

export const WS_EXTRACT_URL = `${WS_BASE}/ws/extract`;

/** For diagnostics: current extract endpoints (ws + http base). */
export function getExtractConfig(): { wsUrl: string; httpBase: string } {
  return { wsUrl: WS_EXTRACT_URL, httpBase: HTTP_BASE };
}

export const httpGeoJSONUrl = (hash: string) => `${HTTP_BASE}/geojson/${hash}`;
export const httpDownloadUrl = (hash: string) => `${HTTP_BASE}/download/${hash}`;
export const httpGraphUrl = (hash: string) => `${HTTP_BASE}/download/${hash}`;