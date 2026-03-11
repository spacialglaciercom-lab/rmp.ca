/**
 * Navigation plugin: search/From-To panel and start turn-by-turn navigation.
 * When enabled, the Navigation sidebar item, search button, Navigation panel, and Start Navigation chip are shown; when disabled, they are hidden.
 */
import type { Plugin } from "../types";

export const navigationPlugin: Plugin = {
  id: "navigation",
  name: "Navigation",
  description:
    "Search destinations, From/To panel, and start turn-by-turn navigation",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
