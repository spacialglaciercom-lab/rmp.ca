/**
 * Route OS — Minimalist theme tokens.
 * Light default; dark via Settings → Dark app style. No neon, no gradients.
 * Aligned with iOS Human Interface Guidelines: primary and semantic colors match iOS system colors.
 */
/** @type {const} */
const themeColors = {
  background: { light: "#FAFAF9", dark: "#0C0C0C" },
  surface: { light: "#FFFFFF", dark: "#161616" },
  surfaceElevated: { light: "#F5F5F4", dark: "#1C1C1C" },
  foreground: { light: "#1C1917", dark: "#E8E5E0" },
  muted: { light: "#78716C", dark: "#8A8580" },
  border: { light: "#E7E5E4", dark: "#2A2A2A" },
  // iOS System Blue (HIG) for primary/tint actions
  primary: { light: "#007AFF", dark: "#0A84FF" },
  // iOS System Green / Orange / Red (HIG)
  success: { light: "#34C759", dark: "#30D158" },
  warning: { light: "#FF9500", dark: "#FF9F0A" },
  error: { light: "#FF3B30", dark: "#FF453A" },
  accentCyan: { light: "#18181B", dark: "#E8E5E0" },
  accentMagenta: { light: "#18181B", dark: "#E8E5E0" },
  statusRun: { light: "#34C759", dark: "#30D158" },
  gridLine: { light: "#F0EEEC", dark: "#222222" },
};

module.exports = { themeColors };
