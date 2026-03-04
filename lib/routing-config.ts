/**
 * Routing API configuration: Google Maps (default) or OSRM fallback.
 */

import { Platform } from "react-native";

import { getGoogleMapsApiKey, getNavigationProvider } from "./google-maps-config";
import { getApiBaseUrl } from "@/shared/oauth";

const OSRM_DEFAULT_URL = "https://router.project-osrm.org";
const GOOGLE_DIRECTIONS_BASE_URL = "https://maps.googleapis.com/maps/api/directions";

export interface RoutingConfig {
  baseUrl: string;
  provider: "osrm" | "google";
  googleApiKey?: string;
}

/**
 * Get routing config (sync) — OSRM only. Use getRoutingConfigAsync() to include Google Maps.
 */
export function getRoutingConfig(): RoutingConfig {
  const osrmUrl = process.env.EXPO_PUBLIC_OSRM_URL ?? OSRM_DEFAULT_URL;
  return {
    baseUrl: osrmUrl || OSRM_DEFAULT_URL,
    provider: "osrm",
  };
}

/**
 * Get routing config (async) — checks user's provider preference.
 * Returns Google Maps config when selected (default), otherwise OSRM.
 *
 * On web, when our API server is used (Railway etc.), Google routing goes through the
 * server proxy which requires GOOGLE_MAPS_API_KEY on the server. If the server has no key,
 * we fall back to OSRM to avoid 503 on /api/maps/directions.
 */
export async function getRoutingConfigAsync(): Promise<RoutingConfig> {
  const provider = await getNavigationProvider();

  if (provider === "google") {
    const apiKey = await getGoogleMapsApiKey();

    // Web: proxy uses server's GOOGLE_MAPS_API_KEY. If server has no key (apiKey empty after /api/config), use OSRM to avoid 503.
    if (Platform.OS === "web" && getApiBaseUrl()) {
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

  return getRoutingConfig();
}
