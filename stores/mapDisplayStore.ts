import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type MapSource = "dark" | "standard" | "satellite" | "osm";

export interface MapDisplayState {
  showScaleBar: boolean;
  showCompass: boolean;
  showZoomControls: boolean;
  showTraffic: boolean;
  showCollectionZones: boolean;
  showStreetNames: boolean;
  showPOIs: boolean;
  showMapillary: boolean;
  showSpeed: boolean;
  transparentWidgets: boolean;
  /** When true, show route/point markers (numbered stops, collection pins, start/end). */
  showRouteMarkers: boolean;
  /** When true, show Overture Maps transportation overlay (PMTiles). */
  showOverture: boolean;
  /** When true (and showOverture), draw map tiles on top of R2 so tiles are an overlay to R2/OSM PBF. */
  mapTilesAsOverlay: boolean;
  /** When true, show route polylines on the map. */
  showRouteLine: boolean;
}

interface MapDisplayStore extends MapDisplayState {
  setShowScaleBar: (v: boolean) => void;
  setShowCompass: (v: boolean) => void;
  setShowZoomControls: (v: boolean) => void;
  setShowTraffic: (v: boolean) => void;
  setShowCollectionZones: (v: boolean) => void;
  setShowStreetNames: (v: boolean) => void;
  setShowPOIs: (v: boolean) => void;
  setShowMapillary: (v: boolean) => void;
  setShowSpeed: (v: boolean) => void;
  setTransparentWidgets: (v: boolean) => void;
  setShowRouteMarkers: (v: boolean) => void;
  setShowOverture: (v: boolean) => void;
  setMapTilesAsOverlay: (v: boolean) => void;
  setShowRouteLine: (v: boolean) => void;
  toggleOverture: () => void;
  toggleMapTilesAsOverlay: () => void;
  toggleRouteLine: () => void;
  toggleScaleBar: () => void;
  toggleCompass: () => void;
  toggleZoomControls: () => void;
  toggleTraffic: () => void;
  toggleOverlay: (key: keyof MapDisplayState) => void;
}

const initialState: MapDisplayState = {
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

export const useMapDisplayStore = create<MapDisplayStore>()(
  persist(
    (set) => ({
      ...initialState,
      setShowScaleBar: (v) => set({ showScaleBar: v }),
      setShowCompass: (v) => set({ showCompass: v }),
      setShowZoomControls: (v) => set({ showZoomControls: v }),
      setShowTraffic: (v) => set({ showTraffic: v }),
      setShowCollectionZones: (v) => set({ showCollectionZones: v }),
      setShowStreetNames: (v) => set({ showStreetNames: v }),
      setShowPOIs: (v) => set({ showPOIs: v }),
      setShowMapillary: (v) => set({ showMapillary: v }),
      setShowSpeed: (v) => set({ showSpeed: v }),
      setTransparentWidgets: (v) => set({ transparentWidgets: v }),
      setShowRouteMarkers: (v) => set({ showRouteMarkers: v }),
      setShowOverture: (v) => set({ showOverture: v }),
      setMapTilesAsOverlay: (v) => set({ mapTilesAsOverlay: v }),
      setShowRouteLine: (v) => set({ showRouteLine: v }),
      toggleOverture: () => set((s) => ({ showOverture: !s.showOverture })),
      toggleMapTilesAsOverlay: () => set((s) => ({ mapTilesAsOverlay: !s.mapTilesAsOverlay })),
      toggleRouteLine: () => set((s) => ({ showRouteLine: !s.showRouteLine })),
      toggleScaleBar: () => set((s) => ({ showScaleBar: !s.showScaleBar })),
      toggleCompass: () => set((s) => ({ showCompass: !s.showCompass })),
      toggleZoomControls: () => set((s) => ({ showZoomControls: !s.showZoomControls })),
      toggleTraffic: () => set((s) => ({ showTraffic: !s.showTraffic })),
      toggleOverlay: (key) =>
        set((state) => ({ [key]: !state[key] } as Partial<MapDisplayState>)),
    }),
    {
      name: "trashroute-map-display",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        showScaleBar: s.showScaleBar,
        showCompass: s.showCompass,
        showZoomControls: s.showZoomControls,
        showTraffic: s.showTraffic,
        showCollectionZones: s.showCollectionZones,
        showStreetNames: s.showStreetNames,
        showPOIs: s.showPOIs,
        showMapillary: s.showMapillary,
        showSpeed: s.showSpeed,
        transparentWidgets: s.transparentWidgets,
        showRouteMarkers: s.showRouteMarkers,
        showOverture: s.showOverture,
        mapTilesAsOverlay: s.mapTilesAsOverlay,
        showRouteLine: s.showRouteLine,
      }),
    }
  )
);
