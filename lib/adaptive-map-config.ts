/**
 * Adaptive map config — simplified strategy for map rendering and UX.
 * Adapts to network quality, device capability, and user interaction.
 * See docs/Map-Rendering-Strategy.md for the flow and usage.
 */

export type NetworkTier = "high" | "low" | "offline";
export type DeviceTier = "high" | "mid" | "low";
export type InteractionContext = "idle" | "pan" | "search" | "analysis";

export interface AdaptiveMapConfig {
  /** Drives tile quality: full vs simplified vs cached-only. */
  networkTier: NetworkTier;
  /** Drives animation and render frequency (60fps / 30fps / static). */
  deviceTier: DeviceTier;
  /** Drives priority: predictive cache vs search viewport vs background work. */
  interactionContext: InteractionContext;
}

const defaultConfig: AdaptiveMapConfig = {
  networkTier: "high",
  deviceTier: "mid",
  interactionContext: "idle",
};

let currentConfig = { ...defaultConfig };

/**
 * Returns the current adaptive map config. Map components can read this
 * to decide tile source, animation, and loading priority.
 */
export function getAdaptiveMapConfig(): Readonly<AdaptiveMapConfig> {
  return currentConfig;
}

/**
 * Update network tier (e.g. from NetInfo or fetch timing).
 * Call when connectivity or measured speed changes.
 */
export function setNetworkTier(tier: NetworkTier): void {
  currentConfig = { ...currentConfig, networkTier: tier };
}

/**
 * Update device tier (e.g. from PixelRatio or a simple capability check).
 */
export function setDeviceTier(tier: DeviceTier): void {
  currentConfig = { ...currentConfig, deviceTier: tier };
}

/**
 * Set current interaction context so loading can be prioritized.
 * E.g. set to "search" when search panel is open, "analysis" when route/weather is computing.
 */
export function setInteractionContext(ctx: InteractionContext): void {
  currentConfig = { ...currentConfig, interactionContext: ctx };
}

/** Whether to use only cached tiles (no network tile requests). */
export function useCachedTilesOnly(): boolean {
  return currentConfig.networkTier === "offline";
}

/** Whether map animations (e.g. fitToCoordinates animated) should be disabled. */
export function disableMapAnimations(): boolean {
  return currentConfig.deviceTier === "low";
}
