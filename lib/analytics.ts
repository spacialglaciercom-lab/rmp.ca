/**
 * User analytics for feature usage (Firebase Analytics).
 * - trackScreen: log screen views (tab/screen name).
 * - trackEvent: log custom events (e.g. map_layer_changed, route_optimized).
 * No-op on web and in Expo Go; safe to call from anywhere.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

const isNativeProd =
  Platform.OS !== "web" && Constants.appOwnership !== "expo";

function getAnalytics():
  | import("@react-native-firebase/analytics").FirebaseAnalyticsTypes.Module
  | null {
  if (!isNativeProd) return null;
  try {
    return require("@react-native-firebase/analytics").default;
  } catch {
    return null;
  }
}

/**
 * Log a screen view for analytics. Call when the user opens or switches to a screen/tab.
 */
export function trackScreen(screenName: string, screenClass?: string): void {
  const analytics = getAnalytics();
  if (!analytics) return;
  try {
    analytics().logScreenView({
      screen_name: screenName,
      screen_class: screenClass ?? screenName,
    });
  } catch {
    // ignore
  }
}

/**
 * Log a custom event for feature usage. Params are optional; use for segmentation (e.g. layer_type, transport_mode).
 */
export function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>
): void {
  const analytics = getAnalytics();
  if (!analytics) return;
  try {
    const safeParams: Record<string, string | number | boolean> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) safeParams[k] = v;
      }
    }
    analytics().logEvent(name, Object.keys(safeParams).length ? safeParams : undefined);
  } catch {
    // ignore
  }
}
