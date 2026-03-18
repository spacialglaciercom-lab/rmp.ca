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
import { getApiBaseUrl } from "@/shared/oauth";

const GOOGLE_MAPS_API_KEY_STORAGE_KEY = "@trashroute:google_maps_api_key";
const NAV_PROVIDER_STORAGE_KEY = "@trashroute:navigation_provider";

/** Cached server config so we don't hit /api/config every time. */
let serverConfigCache: { googleMapsApiKey?: string } | null = null;

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

/** Fetch Google Maps key from server (Railway env GOOGLE_MAPS_API_KEY). Uses public API URL. */
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
    const data = (await res.json()) as { googleMapsApiKey?: string };
    serverConfigCache = data;
    return (data.googleMapsApiKey ?? "").trim();
  } catch {
    return "";
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
