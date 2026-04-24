/**
 * Database Provider Component
 * 
 * Wraps the app with database initialization and sync status context.
 * Also manages background sync scheduling for offline-first functionality.
 */
import React, { createContext, useContext, ReactNode, useEffect } from "react";
import { useDatabase, UseDatabaseResult } from "./hooks/useDatabase";
import { useBackgroundSync } from "@/hooks/useBackgroundSync";

interface DatabaseContextValue extends UseDatabaseResult {
  isReady: boolean;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

interface DatabaseProviderProps {
  children: ReactNode;
  onMigrationComplete?: (migrated: Record<string, number>) => void;
  onError?: (error: string) => void;
}

export function DatabaseProvider({
  children,
  onMigrationComplete,
  onError,
}: DatabaseProviderProps) {
  const dbState = useDatabase();
  // useBackgroundSync manages periodic sync start/stop internally
  // (subscribes to NetInfo, starts syncEngine.startPeriodicSync on mount,
  //  stops on unmount). No need for explicit start/stop here.
  useBackgroundSync();

  // Handle errors
  useEffect(() => {
    if (dbState.error && onError) {
      onError(dbState.error);
    }
  }, [dbState.error, onError]);

  const value: DatabaseContextValue = {
    ...dbState,
    isReady: dbState.status === "ready",
  };

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  );
}

/**
 * Hook to access database context
 */
export function useDatabaseContext(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error("useDatabaseContext must be used within a DatabaseProvider");
  }
  return context;
}

/**
 * Higher-order component to wrap components with database context
 */
export function withDatabase<P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> {
  return function WithDatabaseWrapper(props: P) {
    return (
      <DatabaseProvider>
        <Component {...props} />
      </DatabaseProvider>
    );
  };
}