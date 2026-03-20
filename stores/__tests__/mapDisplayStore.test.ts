import { describe, it, expect, beforeEach, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (k: string) => Promise.resolve(storage.get(k) ?? null),
    setItem: (k: string, v: string) => {
      storage.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      storage.delete(k);
      return Promise.resolve();
    },
    clear: () => {
      storage.clear();
      return Promise.resolve();
    },
    getAllKeys: () => Promise.resolve([...storage.keys()]),
    multiGet: (keys: string[]) =>
      Promise.resolve(keys.map((k) => [k, storage.get(k) ?? null] as const)),
    multiSet: (pairs: [string, string][]) => {
      for (const [k, v] of pairs) storage.set(k, v);
      return Promise.resolve();
    },
  },
}));

import { useMapDisplayStore } from "../mapDisplayStore";

describe("mapDisplayStore", () => {
  beforeEach(() => {
    storage.clear();
    useMapDisplayStore.setState({
      showScaleBar: true,
      showCompass: true,
      showZoomControls: true,
      showTraffic: false,
      showCollectionZones: true,
      showStreetNames: true,
      showPOIs: true,
      showMapillary: true,
      showSpeed: true,
      transparentWidgets: false,
      showRouteMarkers: true,
      showOverture: false,
      mapTilesAsOverlay: false,
      showRouteLine: true,
    });
  });

  it("defaults showOverture to false and showRouteLine to true", () => {
    const s = useMapDisplayStore.getState();
    expect(s.showOverture).toBe(false);
    expect(s.showRouteLine).toBe(true);
  });

  it("toggleOverture flips showOverture", () => {
    expect(useMapDisplayStore.getState().showOverture).toBe(false);
    useMapDisplayStore.getState().toggleOverture();
    expect(useMapDisplayStore.getState().showOverture).toBe(true);
    useMapDisplayStore.getState().toggleOverture();
    expect(useMapDisplayStore.getState().showOverture).toBe(false);
  });

  it("toggleMapTilesAsOverlay flips mapTilesAsOverlay", () => {
    useMapDisplayStore.getState().toggleMapTilesAsOverlay();
    expect(useMapDisplayStore.getState().mapTilesAsOverlay).toBe(true);
  });

  it("setShowTraffic updates showTraffic", () => {
    useMapDisplayStore.getState().setShowTraffic(true);
    expect(useMapDisplayStore.getState().showTraffic).toBe(true);
  });

  it("toggleOverlay flips arbitrary overlay key", () => {
    const before = useMapDisplayStore.getState().showPOIs;
    useMapDisplayStore.getState().toggleOverlay("showPOIs");
    expect(useMapDisplayStore.getState().showPOIs).toBe(!before);
  });
});
