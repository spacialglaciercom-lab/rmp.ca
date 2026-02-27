/**
 * MapLibre (and PMTiles) tile cache cap and clear.
 * The native MapLibre SDK's ambient cache can grow very large (e.g. 14GB from a 90MB PMTiles file).
 * We set a max size and clear it on app cache clear.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

/** Max ambient cache size in bytes (500MB). Prevents PMTiles/vector tiles from blowing up storage. */
export const MAPLIBRE_MAX_AMBIENT_CACHE_BYTES = 500 * 1024 * 1024;

function getOfflineManager(): typeof import("@maplibre/maplibre-react-native").OfflineManager | null {
  if (Platform.OS === "web") return null;
  if (Constants.appOwnership === "expo") return null;
  try {
    const ML = require("@maplibre/maplibre-react-native");
    const OfflineManager = ML?.OfflineManager ?? ML?.default?.OfflineManager;
    return OfflineManager ?? null;
  } catch (_e) {
    return null;
  }
}

/**
 * Set the maximum MapLibre ambient cache size (e.g. 500MB).
 * Call once at app startup on native so PMTiles/vector tiles don't fill the device.
 */
export async function initMapLibreCacheCap(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager) return;
  try {
    await OfflineManager.setMaximumAmbientCacheSize(MAPLIBRE_MAX_AMBIENT_CACHE_BYTES);
  } catch (_e) {
    // Native module not available (e.g. Expo Go) or API failed
  }
}

/**
 * Clear the MapLibre ambient cache (tiles, including PMTiles).
 * Call from Settings → Clear Cache so the MapLibre database is trimmed.
 */
export async function clearMapLibreAmbientCache(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager) return;
  try {
    await OfflineManager.clearAmbientCache();
  } catch (e) {
    console.warn("[MapLibre] clearAmbientCache failed:", e);
  }
}
