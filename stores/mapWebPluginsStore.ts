/**
 * Web map plugin preferences: Marker clustering and Geoman drawing/editing.
 * Persisted via Zustand persist middleware. Web only (these plugins are Leaflet-specific).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface MapWebPluginsState {
  markerClusteringEnabled: boolean;
  geomanDrawingEnabled: boolean;
  nodeInspectorEnabled: boolean;
  avoidedNodesPanelEnabled: boolean;
}

interface MapWebPluginsStore extends MapWebPluginsState {
  setMarkerClusteringEnabled: (v: boolean) => void;
  setGeomanDrawingEnabled: (v: boolean) => void;
  setNodeInspectorEnabled: (v: boolean) => void;
  setAvoidedNodesPanelEnabled: (v: boolean) => void;
  /** @deprecated No longer needed -- store auto-hydrates via Zustand persist middleware */
  hydrate: () => Promise<void>;
}

export const useMapWebPluginsStore = create<MapWebPluginsStore>()(
  persist(
    (set) => ({
      markerClusteringEnabled: true,
      geomanDrawingEnabled: true,
      nodeInspectorEnabled: false,
      avoidedNodesPanelEnabled: true,

      setMarkerClusteringEnabled: (v) => set({ markerClusteringEnabled: v }),
      setGeomanDrawingEnabled: (v) => set({ geomanDrawingEnabled: v }),
      setNodeInspectorEnabled: (v) => set({ nodeInspectorEnabled: v }),
      setAvoidedNodesPanelEnabled: (v) => set({ avoidedNodesPanelEnabled: v }),

      // Backward-compat stub: no-op since persist middleware handles hydration
      hydrate: async () => {},
    }),
    {
      name: "@trashroute:map_web_plugins",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        markerClusteringEnabled: s.markerClusteringEnabled,
        geomanDrawingEnabled: s.geomanDrawingEnabled,
        nodeInspectorEnabled: s.nodeInspectorEnabled,
        avoidedNodesPanelEnabled: s.avoidedNodesPanelEnabled,
      }),
    },
  ),
);
