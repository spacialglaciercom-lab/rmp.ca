import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface MediaNote {
  id: string;
  type: "audio" | "video";
  uri: string;
  duration?: number;
  createdAt: string;
}

export interface CustomMarker {
  id: string;
  name: string;
  lat: number;
  lon: number;
  createdAt: string;
  /** Cached reverse-geocoded location string (e.g. "Denver, United States"). */
  location?: string;
  /** Audio/video notes attached to this marker */
  mediaNotes?: MediaNote[];
}

interface MarkersStore {
  customMarkers: CustomMarker[];

  addMarker: (
    marker: Omit<CustomMarker, "id" | "createdAt" | "location">,
  ) => void;
  renameMarker: (id: string, newName: string) => void;
  setMarkerLocation: (id: string, location: string) => void;
  removeMarker: (id: string) => void;
  clearAllCustomMarkers: () => void;
  addMediaNote: (
    markerId: string,
    note: Omit<MediaNote, "id" | "createdAt">,
  ) => void;
  removeMediaNote: (markerId: string, noteId: string) => void;
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

      addMediaNote: (markerId, note) =>
        set((state) => ({
          customMarkers: state.customMarkers.map((m) =>
            m.id === markerId
              ? {
                  ...m,
                  mediaNotes: [
                    ...(m.mediaNotes ?? []),
                    {
                      ...note,
                      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : m,
          ),
        })),

      removeMediaNote: (markerId, noteId) =>
        set((state) => ({
          customMarkers: state.customMarkers.map((m) =>
            m.id === markerId
              ? {
                  ...m,
                  mediaNotes: (m.mediaNotes ?? []).filter(
                    (n) => n.id !== noteId,
                  ),
                }
              : m,
          ),
        })),
    }),
    {
      name: "trashroute-map-markers",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
