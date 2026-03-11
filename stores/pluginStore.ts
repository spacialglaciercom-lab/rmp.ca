/**
 * Persisted enable/disable state per plugin. Config file (plugins/[id]/config.json)
 * supplies defaults; user toggles override and are persisted here (Zustand + AsyncStorage).
 * Optional: sync to Firestore for cross-device (e.g. user doc settings.plugins).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface PluginStoreState {
  /** Plugin id -> enabled. Only persisted overrides; missing key means use config default. */
  enabledPlugins: Record<string, boolean>;
  setPluginEnabled: (id: string, enabled: boolean) => void;
  isPluginEnabled: (id: string, configDefault: boolean) => boolean;
}

export const usePluginStore = create<PluginStoreState>()(
  persist(
    (set, get) => ({
      enabledPlugins: {},

      setPluginEnabled: (id, enabled) => {
        set((state) => ({
          enabledPlugins: { ...state.enabledPlugins, [id]: enabled },
        }));
      },

      isPluginEnabled: (id, configDefault) => {
        const overrides = get().enabledPlugins;
        if (id in overrides) return overrides[id];
        return configDefault;
      },
    }),
    {
      name: "@trashroute:plugins",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ enabledPlugins: s.enabledPlugins }),
    },
  ),
);
