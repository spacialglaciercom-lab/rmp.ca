import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface MapLayer {
  id: string;
  name: string;
  url: string;
  attribution: string;
  type: "base" | "overlay";
  category:
    | "standard"
    | "satellite"
    | "terrain"
    | "dark"
    | "traffic"
    | "collection";
}

export interface MapLayerState {
  // Current base layer
  activeBaseLayer: string;

  // Active overlay layers
  activeOverlays: string[];

  // Available layers (default + plugin-contributed)
  availableLayers: MapLayer[];

  // Plugin-contributed layer IDs (not persisted; recomputed on init)
  pluginLayerIds: string[];

  // Layer visibility settings
  layerOpacity: Record<string, number>;

  // Actions
  setActiveBaseLayer: (layerId: string) => void;
  toggleOverlay: (layerId: string) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  resetLayerSettings: () => void;
  addLayer: (layer: MapLayer) => void;
  removeLayer: (layerId: string) => void;
}

// Default map layers
const DEFAULT_LAYERS: MapLayer[] = [
  {
    id: "google-maps",
    name: "Google Maps",
    url: "",
    attribution: "© Google",
    type: "base",
    category: "standard",
  },
  {
    id: "standard",
    name: "Standard",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    type: "base",
    category: "standard",
  },
  {
    id: "dark",
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    type: "base",
    category: "dark",
  },
  {
    id: "satellite",
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri &copy; DigitalGlobe",
    type: "base",
    category: "satellite",
  },
  {
    id: "terrain",
    name: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap &copy; OpenStreetMap contributors",
    type: "base",
    category: "terrain",
  },
  {
    id: "transport-dark",
    name: "Transport Dark",
    url: "https://api.thunderforest.com/transport-dark/{z}/{x}/{y}.png?apikey=bc04ca4d2bdd47b0b465cedfacaabc24",
    attribution: "&copy; OpenStreetMap contributors &copy; Thunderforest",
    type: "base",
    category: "dark",
  },
  {
    id: "traffic",
    name: "Traffic",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", // Would be replaced with traffic tile service
    attribution: "&copy; OpenStreetMap contributors",
    type: "overlay",
    category: "traffic",
  },
  {
    id: "collection-points",
    name: "Collection Points",
    url: "", // Custom layer for collection points
    attribution: "",
    type: "overlay",
    category: "collection",
  },
];

/** Base layer IDs that typically take longer to load (raster tiles from external servers). */
export const SLOW_LOADING_BASE_LAYERS: string[] = ["terrain", "satellite"];

export const useMapLayerStore = create<MapLayerState>()(
  persist(
    (set, get) => ({
      activeBaseLayer: "google-maps",
      activeOverlays: ["collection-points"],
      availableLayers: DEFAULT_LAYERS,
      pluginLayerIds: [],
      layerOpacity: {},

      setActiveBaseLayer: (layerId) => {
        set({ activeBaseLayer: layerId });
      },

      toggleOverlay: (layerId) => {
        set((state) => {
          const isActive = state.activeOverlays.includes(layerId);
          const newOverlays = isActive
            ? state.activeOverlays.filter((id) => id !== layerId)
            : [...state.activeOverlays, layerId];
          return { activeOverlays: newOverlays };
        });
      },

      setLayerOpacity: (layerId, opacity) => {
        set((state) => ({
          layerOpacity: {
            ...state.layerOpacity,
            [layerId]: opacity,
          },
        }));
      },

      addLayer: (layer) => {
        set((state) => {
          if (state.pluginLayerIds.includes(layer.id)) return state;
          return {
            pluginLayerIds: [...state.pluginLayerIds, layer.id],
            availableLayers: [...state.availableLayers, layer],
          };
        });
      },

      removeLayer: (layerId) => {
        set((state) => {
          if (!state.pluginLayerIds.includes(layerId)) return state;
          return {
            pluginLayerIds: state.pluginLayerIds.filter((id) => id !== layerId),
            availableLayers: state.availableLayers.filter(
              (l) => l.id !== layerId,
            ),
            activeOverlays: state.activeOverlays.filter((id) => id !== layerId),
          };
        });
      },

      resetLayerSettings: () => {
        set({
          activeBaseLayer: "google-maps",
          activeOverlays: ["collection-points"],
          layerOpacity: {},
        });
      },
    }),
    {
      name: "map-layer-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        activeBaseLayer: state.activeBaseLayer,
        activeOverlays: state.activeOverlays,
        layerOpacity: state.layerOpacity,
      }),
    },
  ),
);
