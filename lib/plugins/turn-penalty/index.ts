/**
 * Turn penalty plugin: on/off toggle for UPS-style left-turn and U-turn
 * penalties in route optimization. When enabled, the backend uses
 * TurnPenaltyPlugin so shortest-path matching prefers fewer left/U-turns.
 */
import type { Plugin } from "../types";

export const turnPenaltyPlugin: Plugin = {
  id: "turn-penalty",
  name: "Turn penalty (UPS-style)",
  description:
    "Penalize left turns and U-turns in route optimization for fewer difficult turns",
  version: "1.0.0",

  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
