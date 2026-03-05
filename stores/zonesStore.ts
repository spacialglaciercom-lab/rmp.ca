/**
 * Zones store — saved zone partition results (Zustand + persist).
 * Used by the Zones panel in the map sidebar (between Layers and My Places).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ZoneOutput } from "@/services/overtureOptimizerService";

export interface SavedZoneResult {
  id: string;
  name: string;
  /** Polygon boundary as [lat, lon][] (for future "show on map"). */
  polygon: Array<[number, number]>;
  /** Partition result from POST /api/zones/partition (or partition-by-polygon). */
  zones: ZoneOutput[];
  truck_count: number;
  balance_metric: "time" | "distance";
  createdAt: string;
}

interface ZonesState {
  savedZones: SavedZoneResult[];
  /** When set, the zone with this id is shown on the map (preview). */
  displayedZoneId: string | null;
  addSavedZone: (item: Omit<SavedZoneResult, "id" | "createdAt">) => void;
  removeSavedZone: (id: string) => void;
  updateSavedZoneName: (id: string, name: string) => void;
  clearAllSavedZones: () => void;
  setDisplayedZoneId: (id: string | null) => void;
}

function generateId(): string {
  return `zone_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export const useZonesStore = create<ZonesState>()(
  persist(
    (set) => ({
      savedZones: [],
      displayedZoneId: null,

      addSavedZone: (item) => {
        const now = new Date().toISOString();
        const saved: SavedZoneResult = {
          ...item,
          id: generateId(),
          createdAt: now,
        };
        set((state) => ({
          savedZones: [saved, ...state.savedZones],
        }));
      },

      removeSavedZone: (id) => {
        set((state) => ({
          savedZones: state.savedZones.filter((z) => z.id !== id),
        }));
      },

      updateSavedZoneName: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          savedZones: state.savedZones.map((z) =>
            z.id === id ? { ...z, name: trimmed } : z
          ),
        }));
      },

      clearAllSavedZones: () => set({ savedZones: [] }),
      setDisplayedZoneId: (id) => set({ displayedZoneId: id }),
    }),
    {
      name: "rmp-zones-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ savedZones: s.savedZones }),
    }
  )
);
