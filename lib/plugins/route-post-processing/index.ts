import type { Plugin } from "../types";

/**
 * Route post-processing plugin.
 *
 * Controls optional repair/cleanup steps applied after an initial route is
 * generated or matched (e.g. segment stitching and teleport-gap repair).
 * Disable to isolate raw optimizer/matcher output for debugging.
 */
export const routePostProcessingPlugin: Plugin = {
  id: "route-post-processing",
  name: "Route Post-Processing",
  description:
    "Optional post-route repair pipeline (stitching and gap fixing) for road-conforming geometry",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {
      routePostProcessing: {
        enabled: true,
      },
    };
  },
};

