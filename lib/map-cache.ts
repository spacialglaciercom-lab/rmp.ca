import { Platform } from "react-native";

function getOfflineManager(): import("@maplibre/maplibre-react-native").OfflineManager | null {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  try {
    const ML = require("@maplibre/maplibre-react-native");
    return ML.OfflineManager ?? ML.default?.OfflineManager ?? null;
  } catch {
    return null;
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
  const OfflineManager = getOfflineManager();
  if (!OfflineManager) return;
  await new Promise((r) => setTimeout(r, 500));
  try {
    await OfflineManager.setMaximumAmbientCacheSize(sizeMB * MB);
  } catch (e) {
    console.warn("Failed to set map cache size:", e);
  }
}

/** Evict stale entries from the ambient cache. Does not delete offline packs. */
export async function clearMapCache(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager) return;
  try {
    await OfflineManager.clearAmbientCache();
  } catch (e) {
    console.warn("Failed to clear map cache:", e);
  }
}

/** Delete and recreate the entire tile database. Wipes offline packs too — use clearMapCache() to keep packs. */
export async function resetMapCache(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager) return;
  try {
    await OfflineManager.resetDatabase();
  } catch (e) {
    console.warn("Failed to reset map database:", e);
  }
}

/** Mark all cached tiles as stale so they refresh on next load. */
export async function invalidateMapCache(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager) return;
  try {
    await OfflineManager.invalidateAmbientCache();
  } catch (e) {
    console.warn("Failed to invalidate map cache:", e);
  }
}
