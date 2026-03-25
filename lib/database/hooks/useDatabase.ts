/**
 * Database Initialization Hook
 * 
 * Initializes WatermelonDB and runs migrations on app startup.
 */
import { useEffect, useState, useCallback } from "react";
import { database } from "../index";
import { syncEngine } from "../sync/syncEngine";
import { locationSync } from "../sync/locationSync";
import {
  isMigrationNeeded,
  runMigration,
  getMigrationStatus,
} from "../migrations/asyncStorageMigration";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

export type DatabaseStatus =
  | "initializing"
  | "migrating"
  | "ready"
  | "error";

export interface UseDatabaseResult {
  status: DatabaseStatus;
  isOnline: boolean;
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncTime: number | null;
  error: string | null;
  forceSync: () => Promise<void>;
}

/**
 * Hook to initialize and manage WatermelonDB
 */
export function useDatabase(): UseDatabaseResult {
  const [status, setStatus] = useState<DatabaseStatus>("initializing");
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize database and run migrations
  useEffect(() => {
    let cancelled = false;
    let unsubscribeSync: (() => void) | null = null;
    let unsubscribeNet: (() => void) | null = null;

    const initializeDatabase = async () => {
      try {
        setStatus("initializing");

        // Check if migration is needed
        const needsMigration = await isMigrationNeeded();

        if (cancelled) return;

        if (needsMigration) {
          setStatus("migrating");
          console.log("Running AsyncStorage migration...");

          const result = await runMigration();

          if (cancelled) return;

          if (!result.success) {
            console.error("Migration failed:", result.errors);
            setError(`Migration failed: ${result.errors.join(", ")}`);
          } else {
            console.log("Migration completed:", result.migrated);
          }
        }

        // Subscribe to sync status
        unsubscribeSync = syncEngine.subscribe((syncStatus) => {
          setIsSyncing(syncStatus.isSyncing);
          setPendingChanges(syncStatus.pendingCount);
          setLastSyncTime(syncStatus.lastSyncTime);
          if (syncStatus.error) {
            setError(syncStatus.error);
          }
        });

        // Subscribe to network status
        unsubscribeNet = NetInfo.addEventListener((state: NetInfoState) => {
          setIsOnline(state.isConnected ?? false);
        });

        // Note: periodic sync is started by useBackgroundSync() hook in DatabaseProvider
        // Do not call syncEngine.startPeriodicSync() here to avoid duplicate timers

        if (!cancelled) {
          setStatus("ready");
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("Database initialization failed:", err);
          setError(err.message);
          setStatus("error");
        }
      }
    };

    initializeDatabase();

    // Cleanup runs synchronously — properly registered as useEffect cleanup
    return () => {
      cancelled = true;
      unsubscribeSync?.();
      unsubscribeNet?.();
      // Note: syncEngine.stopPeriodicSync() is called by useBackgroundSync cleanup
      // Do not call it here to avoid stopping sync for other components
    };
  }, []);

  // Force sync
  const forceSync = useCallback(async () => {
    if (!isOnline) {
      setError("Cannot sync while offline");
      return;
    }

    try {
      setError(null);
      await syncEngine.forceSync();
    } catch (err: any) {
      setError(err.message);
    }
  }, [isOnline]);

  return {
    status,
    isOnline,
    isSyncing,
    pendingChanges,
    lastSyncTime,
    error,
    forceSync,
  };
}

/**
 * Hook for location-based sync
 */
export function useLocationSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastLocation, setLastLocation] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncNearby = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    setError(null);

    try {
      const result = await locationSync.syncNearbyBins();

      if (!result.success) {
        setError(result.error || "Unknown error");
      }

      const loc = locationSync.lastLocation;
      if (loc) {
        setLastLocation(loc);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  const getCurrentLocation = useCallback(async () => {
    return await locationSync.getCurrentLocation();
  }, []);

  return {
    isSyncing,
    lastLocation,
    lastSyncTime: locationSync.lastSync,
    error,
    syncNearby,
    getCurrentLocation,
  };
}

/**
 * Hook to observe a WatermelonDB table with reactive updates
 */
export function useObserveTable<T>(
  tableName: string,
  queryConditions: any[] = []
) {
  const [records, setRecords] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const observe = async () => {
      try {
        setLoading(true);

        // Build query
        const query = database.get(tableName);
        const observable = query.query().observe();

        subscription = observable.subscribe({
          next: (data) => {
            setRecords(data as T[]);
            setLoading(false);
          },
          error: (err) => {
            setError(err.message);
            setLoading(false);
          },
        });
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    observe();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [tableName, JSON.stringify(queryConditions)]);

  return { records, loading, error };
}