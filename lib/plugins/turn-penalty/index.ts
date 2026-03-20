/**
 * Turn penalty plugin: on/off for UPS-style left/U-turn penalties on the
 * backend route optimizer. Not applied to offline optimizer (v2).
 */
import type { Plugin } from "../types";

export const turnPenaltyPlugin: Plugin = {
  id: "turn-penalty",
  name: "Turn penalty (UPS-style)",
  description:
    "Backend route optimizer only: penalize left turns and U-turns for fewer difficult turns. Not used by offline optimizer (v2).",
  version: "1.0.0",

  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
