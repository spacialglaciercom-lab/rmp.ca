/**
 * Sync Status Store
 * 
 * Tracks sync state for offline-first data synchronization.
 * Used by UI components and background sync tasks.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SyncStatusState {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Number of pending local changes waiting to sync */
  pendingCount: number;
  /** Timestamp of last successful sync */
  lastSyncAt: Date | null;
  /** Last sync error message */
  lastError: string | null;
  /** Whether background sync is enabled */
  backgroundSyncEnabled: boolean;
  /** Sync interval in minutes */
  syncIntervalMinutes: number;
  /** Whether to sync only on WiFi */
  wifiOnly: boolean;
}

interface SyncStatusStore extends SyncStatusState {
  setIsSyncing: (isSyncing: boolean) => void;
  setPendingCount: (count: number) => void;
  setLastSyncAt: (date: Date | null) => void;
  setLastError: (error: string | null) => void;
  setBackgroundSyncEnabled: (enabled: boolean) => void;
  setSyncIntervalMinutes: (minutes: number) => void;
  setWifiOnly: (wifiOnly: boolean) => void;
  /** Reset sync status after error */
  clearError: () => void;
  /** Update multiple fields at once */
  updateStatus: (status: Partial<SyncStatusState>) => void;
}

const initialState: SyncStatusState = {
  isSyncing: false,
  pendingCount: 0,
  lastSyncAt: null,
  lastError: null,
  backgroundSyncEnabled: true,
  syncIntervalMinutes: 15,
  wifiOnly: false,
};

export const syncStatusStore = create<SyncStatusStore>()(
  persist(
    (set) => ({
      ...initialState,
      setIsSyncing: (isSyncing) => set({ isSyncing }),
      setPendingCount: (pendingCount) => set({ pendingCount }),
      setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
      setLastError: (lastError) => set({ lastError }),
      setBackgroundSyncEnabled: (backgroundSyncEnabled) => set({ backgroundSyncEnabled }),
      setSyncIntervalMinutes: (syncIntervalMinutes) => set({ syncIntervalMinutes }),
      setWifiOnly: (wifiOnly) => set({ wifiOnly }),
      clearError: () => set({ lastError: null }),
      updateStatus: (status) => set(status),
    }),
    {
      name: "sync-status-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Only persist these fields
        lastSyncAt: state.lastSyncAt,
        backgroundSyncEnabled: state.backgroundSyncEnabled,
        syncIntervalMinutes: state.syncIntervalMinutes,
        wifiOnly: state.wifiOnly,
      }),
    },
  ),
);

// Selector hooks for common use cases
export const useIsSyncing = () => syncStatusStore((state) => state.isSyncing);
export const usePendingCount = () => syncStatusStore((state) => state.pendingCount);
export const useLastSyncAt = () => syncStatusStore((state) => state.lastSyncAt);
export const useBackgroundSyncEnabled = () => syncStatusStore((state) => state.backgroundSyncEnabled);