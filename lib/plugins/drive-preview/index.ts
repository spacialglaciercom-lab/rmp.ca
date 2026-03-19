/**
 * Drive Preview plugin: Street View preview along the route.
 * When enabled, the "Drive Preview" chip and route preview sheet are shown; when disabled, they are hidden.
 */
import type { Plugin } from "../types";

export const drivePreviewPlugin: Plugin = {
  id: "drive-preview",
  name: "Drive Preview",
  description: "Street View preview along your route",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
