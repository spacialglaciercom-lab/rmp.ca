/**
 * Visual design tokens — Master Plan §13. Use for map tab, sidebar, and shared UI.
 * Aligned with iOS Human Interface Guidelines: system colors, 8pt grid, 44pt touch targets.
 */

/** iOS HIG: minimum touch target 44×44 pt for all interactive elements. */
export const IOS_MIN_TOUCH_TARGET_PT = 44;

/** iOS system semantic colors (HIG) for cross-platform consistency; use for primary actions and semantics. */
export const iosSystemColors = {
  blue: "#007AFF",
  green: "#34C759",
  orange: "#FF9500",
  red: "#FF3B30",
  cyan: "#5AC8FA",
  gray: "#8E8E93",
  gray2: "#AEAEB2",
  gray3: "#C7C7CC",
  gray4: "#D1D1D6",
  gray5: "#E5E5EA",
  gray6: "#F2F2F7",
} as const;

export const colors = {
  bgPrimary: "#0A0A0A",
  bgSecondary: "#1A1A1A",
  bgTertiary: "#2A2A2A",
  bgInput: "#1A1A1A",
  borderDefault: "#333333",
  borderSubtle: "#222222",
  borderFocused: iosSystemColors.blue,
  accentPrimary: iosSystemColors.blue,
  accentPrimaryDark: "#0051D4",
  textPrimary: "#FFFFFF",
  textSecondary: "#AAAAAA",
  textTertiary: "#666666",
  textAccent: iosSystemColors.blue,
  buttonPrimaryBg: "#F5F0E8",
  buttonPrimaryText: "#1A1A1A",
  buttonSecondaryBg: "#333333",
  buttonSecondaryText: "#FFFFFF",
  buttonDangerBg: iosSystemColors.red,
  routeOrange: iosSystemColors.orange,
  markerBlue: iosSystemColors.blue,
  markerGreen: iosSystemColors.green,
  sidebarBg: "#1A1A1A",
  sidebarBackdrop: "rgba(0, 0, 0, 0.5)",
  success: iosSystemColors.green,
  warning: iosSystemColors.orange,
  error: iosSystemColors.red,
} as const;

/** 8pt grid (iOS HIG). Use for margins, padding, and layout. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Minimum height for buttons and list rows (iOS HIG 44pt touch target). */
export const minTouchTargetHeight = IOS_MIN_TOUCH_TARGET_PT;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

/**
 * Typography aligned to iOS text styles (HIG). Prefer these for Dynamic Type–friendly UI.
 * Sizes match SF Pro: Large Title 34, Title 28/22/20, Headline/Body 17, Callout 16, etc.
 */
export const iosTextStyles = {
  largeTitle: { fontSize: 34, fontWeight: "400" as const },
  title1: { fontSize: 28, fontWeight: "400" as const },
  title2: { fontSize: 22, fontWeight: "400" as const },
  title3: { fontSize: 20, fontWeight: "400" as const },
  headline: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 17, fontWeight: "400" as const },
  callout: { fontSize: 16, fontWeight: "400" as const },
  subheadline: { fontSize: 15, fontWeight: "400" as const },
  footnote: { fontSize: 13, fontWeight: "400" as const },
  caption1: { fontSize: 12, fontWeight: "400" as const },
  caption2: { fontSize: 11, fontWeight: "400" as const },
} as const;

export const typography = {
  sectionHeader: {
    fontSize: iosTextStyles.caption1.fontSize,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
    color: colors.accentPrimary,
  },
  cardTitle: {
    fontSize: iosTextStyles.callout.fontSize,
    fontWeight: "600" as const,
    color: colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: iosTextStyles.subheadline.fontSize,
    fontWeight: "400" as const,
    color: colors.textSecondary,
  },
  menuItem: {
    fontSize: iosTextStyles.body.fontSize,
    fontWeight: "400" as const,
    color: colors.textPrimary,
  },
  buttonLabel: {
    fontSize: iosTextStyles.body.fontSize,
    fontWeight: "600" as const,
  },
} as const;

export const shadows = {
  floating: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  sidebar: {
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;
