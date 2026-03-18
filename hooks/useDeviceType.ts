import { useWindowDimensions, Platform } from "react-native";

export type DeviceType = "iphone" | "ipad";

/**
 * Returns 'ipad' when running on iPad (short side >= 600pt), otherwise 'iphone'.
 * Use for adaptive layout (sidebar width, panel presentation, etc.).
 */
export function useDeviceType(): DeviceType {
  const { width, height } = useWindowDimensions();
  const shortSide = Math.min(width, height);
  // iPad Mini short side ≈ 744pt; largest iPhone short side ≈ 430pt
  if (Platform.OS === "ios" && shortSide >= 600) return "ipad";
  return "iphone";
}

/**
 * Returns true when the device/window is in landscape orientation.
 */
export function useIsLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  return width > height;
}

/**
 * Returns true when the window is compact (e.g. Split View 1/3, Slide Over).
 * Use to fall back to iPhone-style layout when iPad is in multitasking mode.
 */
export function useIsCompact(): boolean {
  const { width } = useWindowDimensions();
  return width < 600;
}
