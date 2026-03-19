/**
 * Google Maps API key + navigation provider preference storage.
 * Stored in AsyncStorage so it persists on web and native.
 *
 * Sources (in order): AsyncStorage (user-entered) → app.config extra.googleMapsApiKey (iOS build-time) →
 * EXPO_PUBLIC_GOOGLE_MAPS_API_KEY → GET /api/config from server (Railway GOOGLE_MAPS_API_KEY).
 * App uses public API URL (EXPO_PUBLIC_API_BASE_URL), not .railway.internal.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/shared/oauth";

const GOOGLE_MAPS_API_KEY_STORAGE_KEY = "@trashroute:google_maps_api_key";
const NAV_PROVIDER_STORAGE_KEY = "@trashroute:navigation_provider";

/** Cached server config so we don't hit /api/config every time. */
let serverConfigCache: {
  googleMapsApiKey?: string;
  osrmUrl?: string;
} | null = null;

/** Build-time key from app.config extra (set by EAS when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is set). Used on iOS where env can be missing. */
function getExtraConfigKey(): string {
  const extra = Constants.expoConfig?.extra as
    | { googleMapsApiKey?: string }
    | undefined;
  return (extra?.googleMapsApiKey ?? "").trim();
}

/** Fallback from env (no hardcoded keys). */
function getEnvFallback(): string {
  return (
    (typeof process !== "undefined" &&
      process.env?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) ||
    ""
  );
}

/** Fetch Google Maps key from server (Railway/GKE env GOOGLE_MAPS_API_KEY). Uses public API URL. Also caches osrmUrl when present. */
async function fetchServerGoogleMapsKey(): Promise<string> {
  if (serverConfigCache && serverConfigCache.googleMapsApiKey)
    return serverConfigCache.googleMapsApiKey;
  const base = getApiBaseUrl();
  if (!base) return "";
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/config`, {
      method: "GET",
    });
    if (!res.ok) return "";
    const data = (await res.json()) as {
      googleMapsApiKey?: string;
      osrmUrl?: string;
    };
    serverConfigCache = data;
    return (data.googleMapsApiKey ?? "").trim();
  } catch {
    return "";
  }
}

/** Cached OSRM URL from GET /api/config (when server sets OSRM_URL). Used so the app uses backend OSRM instead of public router.project-osrm.org. */
export function getCachedServerOsrmUrl(): string | undefined {
  const url = serverConfigCache?.osrmUrl?.trim();
  return url || undefined;
}

/** Ensure server config is fetched (e.g. so getCachedServerOsrmUrl() is populated). Call when API base is set. */
export async function ensureServerConfigFetched(): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) return;
  if (serverConfigCache != null) return;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/config`, {
      method: "GET",
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      googleMapsApiKey?: string;
      osrmUrl?: string;
    };
    serverConfigCache = data;
  } catch {
    // ignore
  }
}

/**
 * Use /api/maps/* on our server (same as web) for Directions + Roads.
 * Web: always. Native: when EXPO_PUBLIC_API_BASE_URL points at a non-localhost API the device can reach.
 */
export function shouldUseMapsServerProxy(): boolean {
  if (Platform.OS === "web") return true;
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!explicit) return false;
  try {
    const u = new URL(explicit);
    return u.hostname !== "localhost" && u.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

export type NavigationProvider = "google" | "osrm";

export async function getGoogleMapsApiKey(): Promise<string> {
  try {
    const key = await AsyncStorage.getItem(GOOGLE_MAPS_API_KEY_STORAGE_KEY);
    if (key?.trim()) return key.trim();
    const extraKey = getExtraConfigKey();
    if (extraKey) return extraKey;
    const envKey = getEnvFallback();
    if (envKey) return envKey;
    return fetchServerGoogleMapsKey();
  } catch {
    return (
      getExtraConfigKey() ||
      getEnvFallback() ||
      (await fetchServerGoogleMapsKey())
    );
  }
}

export async function setGoogleMapsApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  const envFallback = getEnvFallback();
  if (trimmed && trimmed !== envFallback) {
    await AsyncStorage.setItem(GOOGLE_MAPS_API_KEY_STORAGE_KEY, trimmed);
  } else {
    await AsyncStorage.removeItem(GOOGLE_MAPS_API_KEY_STORAGE_KEY);
  }
}

export async function clearGoogleMapsApiKey(): Promise<void> {
  await AsyncStorage.removeItem(GOOGLE_MAPS_API_KEY_STORAGE_KEY);
}

export async function getNavigationProvider(): Promise<NavigationProvider> {
  try {
    const val = await AsyncStorage.getItem(NAV_PROVIDER_STORAGE_KEY);
    if (val === "osrm") return "osrm";
    return "google"; // default
  } catch {
    return "google";
  }
}

export async function setNavigationProvider(
  provider: NavigationProvider,
): Promise<void> {
  await AsyncStorage.setItem(NAV_PROVIDER_STORAGE_KEY, provider);
}
