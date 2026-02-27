/**
 * Report JavaScript errors to Firebase Crashlytics as non-fatal events.
 * No-op on web and in Expo Go (no native Crashlytics). Use for caught errors
 * and error boundaries so we get visibility without full app crashes.
 * Optional context (string key-value) is set as attributes so the report shows the real reason (e.g. Firestore permission-denied).
 */
import { Platform } from "react-native";
import Constants from "expo-constants";

export function recordErrorToCrashlytics(
  error: Error,
  name?: string,
  context?: Record<string, string>
): void {
  if (Platform.OS === "web" || Constants.appOwnership === "expo") return;
  try {
    const crashlytics = require("@react-native-firebase/crashlytics").default;
    const c = crashlytics();
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (value != null && value !== "") c.setAttribute(key, String(value).slice(0, 100));
      }
    }
    const err = error instanceof Error ? error : new Error(String(error));
    c.recordError(err, name ?? "js_error");
  } catch (e) {
    // Crashlytics not available, RNFBAppModule not found, or recordError failed; never rethrow
    if (__DEV__ && e instanceof Error && !e.message.includes("RNFBAppModule")) {
      console.warn("[crashlytics-report] Could not report error:", e.message);
    }
  }
}
