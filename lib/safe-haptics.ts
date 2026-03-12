/**
 * Safe haptics for React Native: no-op on web, try/catch on native.
 * Use this instead of expo-haptics directly to avoid crashes when:
 * - Running on web (expo-haptics may throw in some environments)
 * - Device doesn't support haptics or simulator has no haptics
 */
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

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

export function impactAsync(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void {
  runOnNative(() => {
    Haptics.impactAsync(style);
  });
}

export function notificationAsync(
  type: Haptics.NotificationFeedbackType,
): void {
  runOnNative(() => {
    Haptics.notificationAsync(type);
  });
}

export const ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = Haptics.NotificationFeedbackType;
