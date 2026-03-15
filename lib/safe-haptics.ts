/**
 * Safe haptics for React Native: no-op on web, try/catch on native.
 * Use this instead of expo-haptics directly to avoid crashes when:
 * - Running on web (expo-haptics may throw when imported on web)
 * - Device doesn't support haptics or simulator has no haptics
 *
 * We avoid importing expo-haptics at top level on web so lazy-loaded
 * screens (e.g. Planner) don't crash when the chunk loads.
 */
import { Platform } from "react-native";

function runOnNative(fn: () => void | Promise<void>) {
  if (Platform.OS === "web") return;
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch(() => {});
    }
  } catch (_) {
    // Ignore haptics errors (unsupported device, simulator, etc.)
  }
}

// Re-export style enums: on web use numeric literals so callers don't need expo-haptics
let ImpactFeedbackStyle: typeof import("expo-haptics").ImpactFeedbackStyle;
let NotificationFeedbackType: typeof import("expo-haptics").NotificationFeedbackType;
if (Platform.OS === "web") {
  ImpactFeedbackStyle = { Light: 1, Medium: 2, Heavy: 3 } as typeof import("expo-haptics").ImpactFeedbackStyle;
  NotificationFeedbackType = { Success: 1, Warning: 2, Error: 3 } as typeof import("expo-haptics").NotificationFeedbackType;
} else {
  const Haptics = require("expo-haptics") as typeof import("expo-haptics");
  ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle;
  NotificationFeedbackType = Haptics.NotificationFeedbackType;
}

export { ImpactFeedbackStyle, NotificationFeedbackType };

export function impactAsync(
  style: import("expo-haptics").ImpactFeedbackStyle = 1,
): void {
  runOnNative(() => {
    const Haptics = require("expo-haptics") as typeof import("expo-haptics");
    Haptics.impactAsync(style);
  });
}

export function notificationAsync(
  type: import("expo-haptics").NotificationFeedbackType,
): void {
  runOnNative(() => {
    const Haptics = require("expo-haptics") as typeof import("expo-haptics");
    Haptics.notificationAsync(type);
  });
}
