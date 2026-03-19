/**
 * Clear ALL app cache and persisted data (Settings → Clear Cache).
 * Removes every AsyncStorage key used by the app so nothing is left behind.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { clearRecoveryData } from "@/lib/crash-recovery";
import { storage } from "@/lib/storage";
import { clearWeatherCacheAsync } from "@/lib/weatherCache";
import { clearOSMLibrary } from "@/lib/osm-file-library";

/** AsyncStorage key prefixes and exact names used by this app (persist, routes, cache, etc.). */
const APP_KEY_PREFIXES = [
  "@trashroute:",
  "trashroute_",
  "trashroute-",
  "weather_",
  "osm_import",
];
const APP_KEY_EXACT = new Set([
  "trashroute-favorites",
  "trashroute-map-markers",
  "trashroute-map-display",
  "trashroute-quick-destinations",
  "trashroute-enhanced-quick-destinations",
  "help-store",
  "map-layer-store",
]);

function isAppKey(key: string): boolean {
  if (APP_KEY_EXACT.has(key)) return true;
  return APP_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Clear all app data: route, history, favorites, OSM, recovery, weather,
 * track storage, route params, map plugins, and every other persisted key.
 * On native, also wipes the file system cache directory.
 */
export async function clearAllAppCache(): Promise<void> {
  // 1. Route and history
  await storage.clearRouteAndHistory();

  // 2. Recovery data
  await clearRecoveryData();

  // 3. Weather cache (in-memory + AsyncStorage)
  await clearWeatherCacheAsync();

  // 4. OSM file library (manifest + content keys + native file storage)
  try {
    await clearOSMLibrary();
  } catch {
    // ignore
  }

  // 5. Remove every app-related key from AsyncStorage (favorites, markers, display, etc.)
  const allKeys = await AsyncStorage.getAllKeys();
  const toRemove = allKeys.filter(isAppKey);
  if (toRemove.length > 0) {
    await AsyncStorage.multiRemove(toRemove);
  }

  // 6. Native only: clear file system cache (exports, temp files)
  if (Platform.OS !== "web") {
    try {
      const FileSystem = await import("expo-file-system/legacy");
      const dir = FileSystem.cacheDirectory;
      if (dir) {
        const files = await FileSystem.readDirectoryAsync(dir);
        for (const name of files) {
          await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
        }
      }
    } catch {
      // ignore
    }
  }
}
