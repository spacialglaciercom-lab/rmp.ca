/**
 * Waste points store — mapped bins and dumpsters for zone partitioning (Zustand + persist).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WastePoint } from "@/types";

function generateId(): string {
  return `waste_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

interface WastePointsState {
  points: WastePoint[];
  add: (point: Omit<WastePoint, "id" | "createdAt">) => void;
  update: (
    id: string,
    patch: Partial<Omit<WastePoint, "id" | "createdAt">>,
  ) => void;
  remove: (id: string) => void;
  setAll: (points: WastePoint[]) => void;
  clearAll: () => void;
}

export const useWastePointsStore = create<WastePointsState>()(
  persist(
    (set) => ({
      points: [],

      add: (point) => {
        const now = new Date().toISOString();
        const full: WastePoint = {
          ...point,
          id: generateId(),
          createdAt: now,
        };
        set((state) => ({ points: [full, ...state.points] }));
      },

      update: (id, patch) => {
        set((state) => ({
          points: state.points.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
        }));
      },

      remove: (id) => {
        set((state) => ({ points: state.points.filter((p) => p.id !== id) }));
      },

      setAll: (points) => set({ points }),

      clearAll: () => set({ points: [] }),
    }),
    {
      name: "rmp-waste-points",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ points: s.points }),
    },
  ),
);
