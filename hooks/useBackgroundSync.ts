/**
 * Background sync scheduling for offline-first data synchronization.
 * Uses the existing SyncEngine for periodic sync management.
 * On web this module exports no-op functions.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { syncEngine } from "@/lib/database/sync/syncEngine";
import { syncStatusStore } from "@/stores/syncStatusStore";
import { subscribeToNetworkState, NetworkState } from "@/lib/network-utils";

/**
 * Hook to manage background sync lifecycle
 * Automatically starts/stops based on app state and network connectivity
 */
export function useBackgroundSync() {
  const isInitialized = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;

    if (isInitialized.current) return;
    isInitialized.current = true;

    // Subscribe to sync status updates
    const unsubscribeSync = syncEngine.subscribe((status) => {
      syncStatusStore.setState({
        isSyncing: status.isSyncing,
        pendingCount: status.pendingCount,
        lastSyncAt: status.lastSyncTime ? new Date(status.lastSyncTime) : null,
        lastError: status.error,
      });
    });

    // Subscribe to network state changes
    const unsubscribeNetwork = subscribeToNetworkState((state: NetworkState) => {
      if (state.isConnected && state.isInternetReachable) {
        // Trigger sync when coming back online
        syncEngine.attemptSync();
      }
    });

    // Start periodic sync
    syncEngine.startPeriodicSync();

    return () => {
      unsubscribeSync();
      unsubscribeNetwork();
      syncEngine.stopPeriodicSync();
    };
  }, []);

  const triggerSync = async () => {
    if (Platform.OS === "web") return;

    try {
      await syncEngine.sync();
    } catch (err) {
      console.warn("[BgSync] Manual sync failed:", err);
    }
  };

  return {
    triggerSync,
    isSupported: Platform.OS !== "web",
  };
}

/**
 * Start background sync scheduling
 * Registers the sync engine to run periodically
 */
export async function startBackgroundSync(): Promise<void> {
  if (Platform.OS === "web") return;

  syncEngine.startPeriodicSync();
}

/**
 * Stop background sync scheduling
 * Stops the sync engine from running periodically
 */
export async function stopBackgroundSync(): Promise<void> {
  if (Platform.OS === "web") return;

  syncEngine.stopPeriodicSync();
}

/**
 * Get background sync status
 */
export async function getBackgroundSyncStatus(): Promise<{
  isRegistered: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
}> {
  if (Platform.OS === "web") {
    return { isRegistered: false, lastRun: null, nextRun: null };
  }

  const syncStatus = syncStatusStore.getState();
  const lastRun = syncStatus.lastSyncAt;

  // Estimate next run (sync interval is 1 minute by default)
  const SYNC_INTERVAL_MS = 60 * 1000;
  const nextRun = lastRun
    ? new Date(lastRun.getTime() + SYNC_INTERVAL_MS)
    : null;

  return {
    isRegistered: true,
    lastRun,
    nextRun,
  };
}