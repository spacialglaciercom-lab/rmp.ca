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
 * server proxy which adds GOOGLE_MAPS_API_KEY — no client key needed.
 */
export async function getRoutingConfigAsync(): Promise<RoutingConfig> {
  const provider = await getNavigationProvider();

  if (provider === "google") {
    const apiKey = await getGoogleMapsApiKey();

    // Web: if we have our API server (e.g. Railway), proxy uses server's GOOGLE_MAPS_API_KEY
    if (Platform.OS === "web" && getApiBaseUrl()) {
      return {
        baseUrl: GOOGLE_DIRECTIONS_BASE_URL,
        provider: "google",
        googleApiKey: apiKey || "",
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
