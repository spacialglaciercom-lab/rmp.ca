import { NativeModules, Platform } from "react-native";

const { MapsMeViewManager } = NativeModules;

/** When the native MAPS.ME module is not linked (EXPO_MAPME_EMBED not set), use fallback so the app does not crash. */
const hasNativeModule = Boolean(MapsMeViewManager);

interface FrameworkInitResult {
  success: boolean;
  message: string;
}

interface Position {
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface SearchResult {
  name: string;
  latitude: number;
  longitude: number;
  type: string;
}

class MapsMeModule {
  static async initializeFramework(): Promise<FrameworkInitResult> {
    if (Platform.OS !== "ios") {
      console.warn("MAPS.ME React Native module currently only supports iOS");
      return { success: false, message: "Only iOS is supported" };
    }
    if (!hasNativeModule) {
      console.warn(
        "MAPS.ME native module not linked. Use openInOfflineMap() from @/lib/offline-map-url or set EXPO_MAPME_EMBED=1 with OMIM framework.",
      );
      return { success: false, message: "Native module not available" };
    }
    try {
      const result = await MapsMeViewManager.initializeFramework();
      return result;
    } catch (error) {
      console.error("Failed to initialize MAPS.ME framework:", error);
      throw error;
    }
  }

  static async setMapPosition(
    latitude: number,
    longitude: number,
  ): Promise<void> {
    if (Platform.OS !== "ios" || !hasNativeModule) return;
    try {
      await MapsMeViewManager.setMapPosition(latitude, longitude);
    } catch (error) {
      console.error("Failed to set map position:", error);
      throw error;
    }
  }

  static async setMapZoom(zoom: number): Promise<void> {
    if (Platform.OS !== "ios" || !hasNativeModule) return;
    try {
      await MapsMeViewManager.setMapZoom(zoom);
    } catch (error) {
      console.error("Failed to set map zoom:", error);
      throw error;
    }
  }

  static async getCurrentPosition(): Promise<Position | null> {
    if (Platform.OS !== "ios" || !hasNativeModule) return null;
    try {
      return await MapsMeViewManager.getCurrentPosition();
    } catch (error) {
      console.error("Failed to get current position:", error);
      throw error;
    }
  }

  static async search(query: string): Promise<SearchResult[]> {
    if (Platform.OS !== "ios" || !hasNativeModule) return [];
    try {
      return await MapsMeViewManager.search(query);
    } catch (error) {
      console.error("Failed to perform search:", error);
      throw error;
    }
  }
}

export default MapsMeModule;
