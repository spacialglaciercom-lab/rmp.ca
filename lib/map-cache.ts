import { Platform } from "react-native";

let MapLibreGL: any;

if (Platform.OS === "ios" || Platform.OS === "android") {
  try {
    MapLibreGL = require("@maplibre/maplibre-react-native").default;
  } catch (e) {
    console.warn("MapLibre GL not available:", e);
  }
}

const MB = 1024 * 1024;

/**
 * Cap the MapLibre ambient tile cache.
 * Call once at app startup (e.g. in _layout.tsx).
 *
 * Defers the call by a short delay so the native PMTilesFileSource thread
 * has time to finish any in-progress work from the previous session.
 * Without this, setMaximumAmbientCacheSize can race with the tile-loading
 * thread and crash (mach_msg2_trap in mbgl::resourceURL).
 */
export async function initMapCache(sizeMB = 50): Promise<void> {
  if (!MapLibreGL?.offlineManager) return;
  // Small delay to let native threads settle after SDK init
  await new Promise((r) => setTimeout(r, 500));
  try {
    await MapLibreGL.offlineManager.setMaximumAmbientCacheSize(sizeMB * MB);
  } catch (e) {
    console.warn("Failed to set map cache size:", e);
  }
}

/** Evict stale entries from the ambient cache. */
export async function clearMapCache(): Promise<void> {
  if (!MapLibreGL?.offlineManager) return;
  try {
    await MapLibreGL.offlineManager.clearAmbientCache();
  } catch (e) {
    console.warn("Failed to clear map cache:", e);
  }
}

/** Delete and recreate the entire tile database. */
export async function resetMapCache(): Promise<void> {
  if (!MapLibreGL?.offlineManager) return;
  try {
    await MapLibreGL.offlineManager.resetDatabase();
  } catch (e) {
    console.warn("Failed to reset map database:", e);
  }
}

/** Mark all cached tiles as stale so they refresh on next load. */
export async function invalidateMapCache(): Promise<void> {
  if (!MapLibreGL?.offlineManager) return;
  try {
    await MapLibreGL.offlineManager.invalidateAmbientCache();
  } catch (e) {
    console.warn("Failed to invalidate map cache:", e);
  }
}
