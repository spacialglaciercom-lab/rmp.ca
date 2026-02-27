import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface CustomMarker {
  id: string;
  name: string;
  lat: number;
  lon: number;
  createdAt: string;
  /** Cached reverse-geocoded location string (e.g. "Denver, United States"). */
  location?: string;
}

interface MarkersStore {
  customMarkers: CustomMarker[];

  addMarker: (marker: Omit<CustomMarker, "id" | "createdAt" | "location">) => void;
  renameMarker: (id: string, newName: string) => void;
  setMarkerLocation: (id: string, location: string) => void;
  removeMarker: (id: string) => void;
  clearAllCustomMarkers: () => void;
}

function generateId(): string {
  return `marker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useMarkersStore = create<MarkersStore>()(
  persist(
    (set) => ({
      customMarkers: [],

      addMarker: (marker) =>
        set((state) => ({
          customMarkers: [
            ...state.customMarkers,
            {
              ...marker,
              id: generateId(),
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      renameMarker: (id, newName) =>
        set((state) => ({
          customMarkers: state.customMarkers.map((m) =>
            m.id === id ? { ...m, name: newName } : m,
          ),
        })),

      setMarkerLocation: (id, location) =>
        set((state) => ({
          customMarkers: state.customMarkers.map((m) =>
            m.id === id ? { ...m, location } : m,
          ),
        })),

      removeMarker: (id) =>
        set((state) => ({
          customMarkers: state.customMarkers.filter((m) => m.id !== id),
        })),

      clearAllCustomMarkers: () => set({ customMarkers: [] }),
    }),
    {
      name: "trashroute-map-markers",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
