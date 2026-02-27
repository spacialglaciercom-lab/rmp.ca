/**
 * Performance monitoring via Firebase Performance (native only).
 * - App startup trace: started at module load, stopped when recordStartupComplete() is called.
 * - Custom traces: use startTrace/stopTrace for critical operations (e.g. route_calculation, map_load).
 * No-op on web and in Expo Go.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

const isNativeProd =
  Platform.OS !== "web" && Constants.appOwnership !== "expo";

let startupTrace: { stop: () => Promise<void> } | null = null;

function getPerf(): typeof import("@react-native-firebase/perf").default | null {
  if (!isNativeProd) return null;
  try {
    return require("@react-native-firebase/perf").default;
  } catch {
    return null;
  }
}

/**
 * Start the app_startup trace. Call once at app load (e.g. from startup-time or _layout).
 * Stop with stopStartupTrace() when the app is ready.
 */
export function startStartupTrace(): void {
  if (!isNativeProd) return;
  const perf = getPerf();
  if (!perf) return;
  try {
    const trace = perf().newTrace("app_startup");
    trace.start();
    startupTrace = trace;
  } catch {
    startupTrace = null;
  }
}

/**
 * Stop the app_startup trace and report duration. Safe to call multiple times.
 */
export async function stopStartupTrace(): Promise<void> {
  if (!startupTrace) return;
  try {
    await startupTrace.stop();
  } catch {
    // ignore
  } finally {
    startupTrace = null;
  }
}

/**
 * Run an async operation as a named performance trace. Reports to Firebase Perf on native prod.
 */
export async function withTrace<T>(
  traceName: string,
  fn: () => Promise<T>
): Promise<T> {
  const perf = getPerf();
  if (!perf) return fn();
  const trace = perf().newTrace(traceName);
  try {
    trace.start();
    const result = await fn();
    return result;
  } finally {
    await trace.stop();
  }
}

/**
 * Start a custom trace. Call stop() on the returned object when done.
 * Example: const t = startTrace('route_calculation'); ... await t.stop();
 */
export function startTrace(
  traceName: string
): { stop: () => Promise<void> } | null {
  const perf = getPerf();
  if (!perf) return null;
  try {
    const trace = perf().newTrace(traceName);
    trace.start();
    return {
      stop: async () => {
        await trace.stop();
      },
    };
  } catch {
    return null;
  }
}
