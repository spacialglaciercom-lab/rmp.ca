/**
 * Collection Route plugin: in-app navigator with segment tracking for collection routes.
 * When enabled, the "Collection Route" chip and full-screen collection navigator are shown; when disabled, they are hidden.
 */
import type { Plugin } from "../types";

export const collectionRoutePlugin: Plugin = {
  id: "collection-route",
  name: "Collection Route",
  description: "In-app navigation with segment tracking for collection routes",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
