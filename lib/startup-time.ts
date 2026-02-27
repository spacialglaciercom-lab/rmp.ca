/**
 * Startup time monitoring: records time from module load to "app ready"
 * and reports it for optimization and regression tracking.
 * - Dev: logs to console.
 * - Native prod: sets Crashlytics attribute, and stops Firebase Perf "app_startup" trace.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { startStartupTrace, stopStartupTrace } from "./performance-monitoring";

// Start Firebase Perf startup trace as early as possible (no-op on web/Expo Go)
startStartupTrace();

const startTime = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

let completed = false;

/** Call when the app is considered ready (e.g. root layout mounted, first paint). */
export function recordStartupComplete(): void {
  if (completed) return;
  completed = true;
  const durationMs = (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) - startTime;

  if (__DEV__) {
    console.log(`[startup] Time to ready: ${durationMs.toFixed(0)} ms`);
  }

  if (Platform.OS !== "web" && Constants.appOwnership !== "expo") {
    try {
      const crashlytics = require("@react-native-firebase/crashlytics").default;
      crashlytics().setAttribute("last_startup_ms", String(Math.round(durationMs)));
    } catch {
      // Crashlytics not available; ignore
    }
    void stopStartupTrace();
  }
}

/** Time (ms) since module load; useful for custom metrics. */
export function getStartupDurationMs(): number {
  return (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) - startTime;
}
