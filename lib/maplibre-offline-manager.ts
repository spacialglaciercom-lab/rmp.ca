/**
 * Shared MapLibre OfflineManager utility.
 * Consolidates the lazy-loaded OfflineManager getter used across offline map modules.
 */

import { Platform } from "react-native";

type OfflineManagerType =
  typeof import("@maplibre/maplibre-react-native").OfflineManager;

let _offlineManager: OfflineManagerType | null = null;
let _attempted = false;

/**
 * Get the MapLibre OfflineManager (native only).
 * Returns null on web or if MapLibre is not available.
 * Caches the result after first successful load.
 */
export function getOfflineManager(): OfflineManagerType | null {
  if (_offlineManager != null) return _offlineManager;
  if (_attempted) return null;

  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    _attempted = true;
    return null;
  }

  try {
    const ML = require("@maplibre/maplibre-react-native");
    _offlineManager = ML?.OfflineManager ?? ML?.default?.OfflineManager ?? null;
  } catch {
    _offlineManager = null;
  }

  _attempted = true;
  return _offlineManager;
}

/**
 * Check if OfflineManager is available on this platform.
 */
export function isOfflineManagerAvailable(): boolean {
  return getOfflineManager() != null;
}
