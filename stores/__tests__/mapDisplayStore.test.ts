import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useMapDisplayStore } from '../mapDisplayStore';

const defaults = {
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
};

beforeEach(() => {
  useMapDisplayStore.setState({ ...defaults });
});

describe('initial defaults', () => {
  it('showTraffic is false', () => {
    expect(useMapDisplayStore.getState().showTraffic).toBe(false);
  });
  it('showOverture is false', () => {
    expect(useMapDisplayStore.getState().showOverture).toBe(false);
  });
  it('mapTilesAsOverlay is false', () => {
    expect(useMapDisplayStore.getState().mapTilesAsOverlay).toBe(false);
  });
  it('showRouteLine is true', () => {
    expect(useMapDisplayStore.getState().showRouteLine).toBe(true);
  });
  it('showScaleBar is true', () => {
    expect(useMapDisplayStore.getState().showScaleBar).toBe(true);
  });
});

describe('direct setters', () => {
  it('setShowTraffic updates showTraffic', () => {
    useMapDisplayStore.getState().setShowTraffic(true);
    expect(useMapDisplayStore.getState().showTraffic).toBe(true);
  });
  it('setShowOverture updates showOverture', () => {
    useMapDisplayStore.getState().setShowOverture(true);
    expect(useMapDisplayStore.getState().showOverture).toBe(true);
  });
  it('setMapTilesAsOverlay updates mapTilesAsOverlay', () => {
    useMapDisplayStore.getState().setMapTilesAsOverlay(true);
    expect(useMapDisplayStore.getState().mapTilesAsOverlay).toBe(true);
  });
  it('setShowRouteLine updates showRouteLine', () => {
    useMapDisplayStore.getState().setShowRouteLine(false);
    expect(useMapDisplayStore.getState().showRouteLine).toBe(false);
  });
  it('setShowMapillary updates showMapillary', () => {
    useMapDisplayStore.getState().setShowMapillary(false);
    expect(useMapDisplayStore.getState().showMapillary).toBe(false);
  });
});

describe('toggle methods', () => {
  it('toggleOverture flips showOverture from false to true', () => {
    useMapDisplayStore.getState().toggleOverture();
    expect(useMapDisplayStore.getState().showOverture).toBe(true);
  });
  it('toggleOverture flips showOverture back to false', () => {
    useMapDisplayStore.getState().toggleOverture();
    useMapDisplayStore.getState().toggleOverture();
    expect(useMapDisplayStore.getState().showOverture).toBe(false);
  });
  it('toggleMapTilesAsOverlay flips mapTilesAsOverlay', () => {
    useMapDisplayStore.getState().toggleMapTilesAsOverlay();
    expect(useMapDisplayStore.getState().mapTilesAsOverlay).toBe(true);
  });
  it('toggleRouteLine flips showRouteLine from true to false', () => {
    useMapDisplayStore.getState().toggleRouteLine();
    expect(useMapDisplayStore.getState().showRouteLine).toBe(false);
  });
  it('toggleScaleBar flips showScaleBar from true to false', () => {
    useMapDisplayStore.getState().toggleScaleBar();
    expect(useMapDisplayStore.getState().showScaleBar).toBe(false);
  });
  it('toggleCompass flips showCompass from true to false', () => {
    useMapDisplayStore.getState().toggleCompass();
    expect(useMapDisplayStore.getState().showCompass).toBe(false);
  });
  it('toggleTraffic flips showTraffic from false to true', () => {
    useMapDisplayStore.getState().toggleTraffic();
    expect(useMapDisplayStore.getState().showTraffic).toBe(true);
  });
  it('toggleZoomControls flips showZoomControls from true to false', () => {
    useMapDisplayStore.getState().toggleZoomControls();
    expect(useMapDisplayStore.getState().showZoomControls).toBe(false);
  });
});

describe('toggleOverlay', () => {
  it('flips an arbitrary boolean key', () => {
    useMapDisplayStore.getState().toggleOverlay('showMapillary');
    expect(useMapDisplayStore.getState().showMapillary).toBe(false);
  });
  it('can be called twice to restore original value', () => {
    useMapDisplayStore.getState().toggleOverlay('showPOIs');
    useMapDisplayStore.getState().toggleOverlay('showPOIs');
    expect(useMapDisplayStore.getState().showPOIs).toBe(true);
  });
});
