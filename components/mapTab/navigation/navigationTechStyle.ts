/**
 * Minimalist tech navigation style — glass panels, blue/cyan accents, mono for numbers.
 * Inspired by dark glassmorphism nav UI.
 */

export const TECH_NAV = {
  /** Primary accent (blue) for active states and primary actions */
  blue: "#3b82f6",
  blueLight: "#60a5fa",
  /** Secondary accent (cyan) for highlights */
  cyan: "#06b6d4",
  /** Glass panel: dark translucent with subtle border */
  glassStrongBg: "rgba(20, 20, 28, 0.92)",
  glassBorder: "rgba(255, 255, 255, 0.08)",
  glassBorderBlue: "rgba(59, 130, 246, 0.25)",
  /** Softer glass for inputs */
  glassInputBg: "rgba(30, 30, 40, 0.6)",
  inputBorder: "rgba(255, 255, 255, 0.06)",
  /** Radii matching the inspiration (rounded-2xl / rounded-xl) */
  radiusPanel: 20,
  radiusCard: 16,
  radiusInput: 12,
  /** Glow for primary button (shadow on RN) */
  shadowBlue: "rgba(59, 130, 246, 0.4)",
} as const;
