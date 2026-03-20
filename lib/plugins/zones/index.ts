/**
 * Zones plugin: map-centric view of truck zone partitions.
 * When enabled, the Zones tab is shown; when disabled, the tab is hidden.
 */
import type { Plugin } from "../types";

export const zonesPlugin: Plugin = {
  id: "zones",
  name: "Zones",
  description: "Map view of zone partitions and zone list",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
