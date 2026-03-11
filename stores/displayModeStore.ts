/**
 * Display mode store — toggles between "minimal" and "full" route views.
 *
 * - minimal: Stop list + stats (distance, stops remaining, ETA). No map. Battery-friendly.
 * - full: react-native-maps with route polyline, truck position, next-stop highlight.
 *
 * Persisted to AsyncStorage so the driver's preference survives restarts.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AppDisplayMode = "minimal" | "full";

interface DisplayModeState {
  mode: AppDisplayMode;
  setMode: (mode: AppDisplayMode) => void;
}

export const useDisplayModeStore = create<DisplayModeState>()(
  persist(
    (set) => ({
      mode: "full",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "trashroute-display-mode",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
