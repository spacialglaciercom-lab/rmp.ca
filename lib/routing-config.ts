/**
 * Routing API configuration: Google Maps (default) or OSRM fallback.
 */

import {
  getCachedServerOsrmUrl,
  getGoogleMapsApiKey,
  getNavigationProvider,
  ensureServerConfigFetched,
  shouldUseMapsServerProxy,
} from "./google-maps-config";
import { getApiBaseUrl } from "@/shared/oauth";

const OSRM_DEFAULT_URL = "https://router.project-osrm.org";
const GOOGLE_DIRECTIONS_BASE_URL =
  "https://maps.googleapis.com/maps/api/directions";

export interface RoutingConfig {
  baseUrl: string;
  provider: "osrm" | "google";
  googleApiKey?: string;
}

/**
 * Get routing config (sync) — OSRM only. Use getRoutingConfigAsync() to include Google Maps.
 * Prefers: server-cached osrmUrl (from GET /api/config) → EXPO_PUBLIC_OSRM_URL → public OSRM.
 */
export function getRoutingConfig(): RoutingConfig {
  const serverOsrm = getCachedServerOsrmUrl();
  const envOsrm = process.env.EXPO_PUBLIC_OSRM_URL;
  const baseUrl =
    (serverOsrm || envOsrm || "").trim() || OSRM_DEFAULT_URL;
  return {
    baseUrl,
    provider: "osrm",
  };
}

/**
 * Get routing config (async) — checks user's provider preference.
 * Returns Google Maps config when selected (default), otherwise OSRM.
 *
 * When using the server proxy (web always; native with a remote EXPO_PUBLIC_API_BASE_URL),
 * Google routing uses GOOGLE_MAPS_API_KEY on the server. If no key after /api/config, OSRM fallback.
 */
export async function getRoutingConfigAsync(): Promise<RoutingConfig> {
  const provider = await getNavigationProvider();

  if (provider === "google") {
    const apiKey = await getGoogleMapsApiKey();

    if (shouldUseMapsServerProxy() && getApiBaseUrl()) {
      if (!apiKey) return getRoutingConfig();
      return {
        baseUrl: GOOGLE_DIRECTIONS_BASE_URL,
        provider: "google",
        googleApiKey: apiKey,
      };
    }

    if (apiKey) {
      return {
        baseUrl: GOOGLE_DIRECTIONS_BASE_URL,
        provider: "google",
        googleApiKey: apiKey,
      };
    }
  }

  // OSRM: ensure server config is fetched so getRoutingConfig() can use backend OSRM URL when set (e.g. GKE).
  if (getApiBaseUrl()) await ensureServerConfigFetched();
  return getRoutingConfig();
}
