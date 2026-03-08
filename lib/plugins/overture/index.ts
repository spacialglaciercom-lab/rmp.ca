/**
 * Overture extraction plugin (stub for Step 1). Step 4 will add extract UI and overlay.
 */
import type { Plugin } from "../types";

export const overturePlugin: Plugin = {
  id: "overture",
  name: "Overture",
  description: "Overture map overlay and road network extraction",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
