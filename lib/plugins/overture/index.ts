/**
 * Overture plugin: gates the Overture Maps transportation overlay (PMTiles).
 * When disabled, clears the overlay from the map display store.
 */
import type { Plugin } from "../types";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";

/** Stores the showOverture state before destroy so it can be restored on re-initialize */
let savedShowOverture: boolean | null = null;

export const overturePlugin: Plugin = {
  id: "overture",
  name: "Overture",
  description: "Overture map overlay and road network extraction",
  version: "1.0.0",
  initialize() {
    if (savedShowOverture !== null) {
      useMapDisplayStore.getState().setShowOverture(savedShowOverture);
      savedShowOverture = null;
    }
  },
  destroy() {
    savedShowOverture = useMapDisplayStore.getState().showOverture;
    useMapDisplayStore.getState().setShowOverture(false);
  },
  getFeatures() {
    return {};
  },
};
