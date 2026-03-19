/**
 * Routing API configuration: OSRM (default) or Google Maps when selected / available.
 */

import { Platform } from "react-native";

import {
  getCachedServerGoogleMapsKey,
  getCachedServerOsrmUrl,
  getGoogleMapsApiKey,
  getNavigationProvider,
  ensureServerConfigFetched,
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
 * Returns OSRM when selected (default) or Google when the user chose Google.
 *
 * On web, Google routing uses `/api/maps/directions`, which only works when the **server**
 * exposes a key via GET /api/config. A client EXPO_PUBLIC_GOOGLE_MAPS_API_KEY alone does not
 * configure the proxy — without a server key we use OSRM (OSRM_URL / EXPO_PUBLIC_OSRM_URL).
 */
export async function getRoutingConfigAsync(): Promise<RoutingConfig> {
  const provider = await getNavigationProvider();

  if (provider === "google") {
    // Web: never treat EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as sufficient for Directions (proxy has no key → 503).
    if (Platform.OS === "web" && getApiBaseUrl()) {
      await ensureServerConfigFetched();
      const serverKey = getCachedServerGoogleMapsKey();
      if (!serverKey) return getRoutingConfig();
      return {
        baseUrl: GOOGLE_DIRECTIONS_BASE_URL,
        provider: "google",
        googleApiKey: serverKey,
      };
    }

    const apiKey = await getGoogleMapsApiKey();
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
