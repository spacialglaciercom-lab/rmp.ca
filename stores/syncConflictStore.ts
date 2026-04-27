/**
 * Sync Conflict Store
 * Tracks sync conflicts that need user resolution.
 * Used by the ConflictResolutionSheet UI component.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ConflictResolution = "server_wins" | "client_wins" | "merge";

export interface SyncConflict {
  /** Unique conflict ID */
  id: string;
  /** Table where the conflict occurred */
  tableName: string;
  /** Record ID */
  recordId: string;
  /** Record display name (e.g., route name, address) */
  displayName: string;
  /** Fields that have conflicts */
  conflictFields: string[];
  /** Local version of the record */
  localRecord: Record<string, unknown>;
  /** Server version of the record */
  serverRecord: Record<string, unknown>;
  /** Timestamp when conflict was detected */
  detectedAt: number;
  /** Whether the user has resolved this conflict */
  resolved: boolean;
  /** How the user resolved it */
  resolution?: ConflictResolution;
}

interface SyncConflictState {
  /** List of unresolved conflicts */
  conflicts: SyncConflict[];
  /** Whether the conflict sheet is visible */
  isSheetVisible: boolean;
  /** Add a new conflict */
  addConflict: (conflict: SyncConflict) => void;
  /** Resolve a conflict */
  resolveConflict: (id: string, resolution: ConflictResolution) => void;
  /** Dismiss a conflict (ignore) */
  dismissConflict: (id: string) => void;
  /** Resolve all remaining conflicts with a strategy */
  resolveAllConflicts: (resolution: ConflictResolution) => void;
  /** Clear all resolved conflicts */
  clearResolved: () => void;
  /** Show/hide the conflict sheet */
  setSheetVisible: (visible: boolean) => void;
  /** Get unresolved conflict count */
  unresolvedCount: () => number;
}

export const syncConflictStore = create<SyncConflictState>()(
  persist(
    (set, get) => ({
      conflicts: [],
      isSheetVisible: false,

      addConflict: (conflict) => {
        const existing = get().conflicts.find(
          (c) => c.id === conflict.id,
        );
        if (existing) return; // Don't add duplicates
        set((state) => ({
          conflicts: [...state.conflicts, conflict],
          isSheetVisible: true, // Auto-show the sheet
        }));
      },

      resolveConflict: (id, resolution) => {
        set((state) => ({
          conflicts: state.conflicts.map((c) =>
            c.id === id
              ? { ...c, resolved: true, resolution, isSheetVisible: false }
              : c,
          ),
        }));
      },

      dismissConflict: (id) => {
        set((state) => ({
          conflicts: state.conflicts.filter((c) => c.id !== id),
        }));
      },

      resolveAllConflicts: (resolution) => {
        set((state) => ({
          conflicts: state.conflicts.map((c) =>
            !c.resolved
              ? { ...c, resolved: true, resolution }
              : c,
          ),
          isSheetVisible: false,
        }));
      },

      clearResolved: () => {
        set((state) => ({
          conflicts: state.conflicts.filter((c) => !c.resolved),
        }));
      },

      setSheetVisible: (visible) => {
        set({ isSheetVisible: visible });
      },

      unresolvedCount: () => {
        return get().conflicts.filter((c) => !c.resolved).length;
      },
    }),
    {
      name: "sync-conflict-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        conflicts: state.conflicts,
      }),
    },
  ),
);

// Selector hooks
export const useConflicts = () =>
  syncConflictStore((state) => state.conflicts);
export const useUnresolvedConflicts = () =>
  syncConflictStore((state) =>
    state.conflicts.filter((c) => !c.resolved),
  );
export const useUnresolvedCount = () =>
  syncConflictStore(
    (state) => state.conflicts.filter((c) => !c.resolved).length,
  );
export const useIsConflictSheetVisible = () =>
  syncConflictStore((state) => state.isSheetVisible);
