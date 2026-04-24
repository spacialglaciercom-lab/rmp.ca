/**
 * Fuel-aware routing plugin: use DEM elevation for fuel-cost optimization.
 * When enabled, the app can send dem_path to the optimizer backend so routes
 * minimize fuel (uphill/downhill cost) instead of raw distance.
 */
import type { Plugin } from "../types";

export const fuelAwareRoutingPlugin: Plugin = {
  id: "fuel-aware-routing",
  name: "Fuel-aware routing",
  description:
    "Backend route optimizer only: use DEM elevation for fuel-cost optimization when the server has a DEM configured. Not used by offline optimizer (v2).",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
