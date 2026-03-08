/**
 * Overture plugin: gates the Overture Maps transportation overlay (PMTiles).
 * When disabled, clears the overlay from the map display store.
 */
import type { Plugin } from "../types";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";

export const overturePlugin: Plugin = {
  id: "overture",
  name: "Overture",
  description: "Overture map overlay and road network extraction",
  version: "1.0.0",
  initialize() {},
  destroy() {
    useMapDisplayStore.getState().setShowOverture(false);
  },
  getFeatures() {
    return {};
  },
};
