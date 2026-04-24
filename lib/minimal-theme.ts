/**
 * NEO DELIVERY // ROUTE OS — Minimalist design system.
 * Light (default) and dark palettes; no neon, no gradients, content-first.
 * Aligned with iOS Human Interface Guidelines: accent/primary and semantic colors use iOS system colors.
 */

/** iOS system colors (HIG) used for accent and semantics */
const iosBlue = "#007AFF";
const iosGreen = "#34C759";
const iosOrange = "#FF9500";

export type MinimalTheme = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderLight: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
};

export const lightTheme: MinimalTheme = {
  bg: "#FAFAF9",
  surface: "#FFFFFF",
  surfaceAlt: "#F5F5F4",
  border: "#E7E5E4",
  borderLight: "#F0EEEC",
  text: "#1C1917",
  textSecondary: "#78716C",
  textTertiary: "#A8A29E",
  accent: iosBlue,
  accentSoft: "#E8F4FF",
  success: iosGreen,
  successSoft: "#F0FDF4",
  warning: iosOrange,
  warningSoft: "#FFFBEB",
};

export const darkTheme: MinimalTheme = {
  bg: "#0C0C0C",
  surface: "#161616",
  surfaceAlt: "#1C1C1C",
  border: "#2A2A2A",
  borderLight: "#222222",
  text: "#E8E5E0",
  textSecondary: "#8A8580",
  textTertiary: "#5C5650",
  accent: "#0A84FF",
  accentSoft: "#1E2A3A",
  success: "#30D158",
  successSoft: "#052E16",
  warning: "#FF9F0A",
  warningSoft: "#1C1508",
};

export const APP_THEME_STORAGE_KEY = "appTheme";
