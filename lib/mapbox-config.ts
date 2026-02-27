/**
 * Mapbox configuration (optional native SDK).
 * If @rnmapbox/maps is installed, token is set at app startup for Mapbox map views.
 * If not installed (e.g. using react-native-maps only), initMapbox is a no-op.
 *
 * Where to add your tokens:
 * - Public token (map display in the app): add to .env as EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN.
 *   Get it from https://console.mapbox.com/account/access-tokens/ (Default Public Token, starts with pk.ey).
 * - Secret token (server-side Mapbox APIs only): add to server env as MAPBOX_SECRET_ACCESS_TOKEN.
 *   Do not put the secret token in the app or in EXPO_PUBLIC_*.
 */

import { Platform } from "react-native";

const MAPBOX_PUBLIC_TOKEN_KEY = "EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN";

/** Public token for map display. Set in .env as EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN. */
export function getMapboxPublicToken(): string {
  if (typeof process !== "undefined" && process.env?.[MAPBOX_PUBLIC_TOKEN_KEY]) {
    return process.env[MAPBOX_PUBLIC_TOKEN_KEY];
  }
  return "";
}

/** Whether Mapbox is configured (public token set) and we're on native. */
export function isMapboxAvailable(): boolean {
  return Platform.OS !== "web" && Boolean(getMapboxPublicToken());
}

/**
 * Initialize Mapbox SDK with the public access token. Call once at app startup (e.g. from root layout).
 * No-op on web. Safe to call when token is empty (Mapbox views will not load until token is set).
 */
export function initMapbox(): void {
  if (Platform.OS === "web") return;
  const token = getMapboxPublicToken();
  if (!token) return;
  try {
    // Dynamic require so web bundle never loads @rnmapbox/maps
    const Mapbox = require("@rnmapbox/maps").default;
    if (Mapbox?.setAccessToken) {
      Mapbox.setAccessToken(token);
    }
  } catch {
    // @rnmapbox/maps not installed (optional; app uses react-native-maps for native maps)
  }
}
