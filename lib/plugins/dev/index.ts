/**
 * Dev-only plugin for debugging (OsmAnd-style). Exposes logging and optional
 * plugin state dump. Only registered when __DEV__ (see load.ts).
 */
import type { Plugin } from "../types";
import { getAllPlugins } from "../registry";

export const devPlugin: Plugin = {
  id: "dev",
  name: "Dev / Debug",
  description: "Logging and plugin state for development",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {
      /** Log with a prefix; second arg can be an object for console.dir. */
      log: (message: string, data?: unknown) => {
        if (__DEV__) {
          if (data !== undefined) {
            console.log("[Plugin:dev]", message, data);
          } else {
            console.log("[Plugin:dev]", message);
          }
        }
      },
      /** Return current registry snapshot (plugin ids and feature keys). */
      getRegistrySnapshot: () => {
        const plugins = getAllPlugins();
        return plugins.map((p) => ({
          id: p.id,
          name: p.name,
          featureKeys: Object.keys(p.getFeatures() || {}),
        }));
      },
    };
  },
};
