/**
 * Routes Hook - WatermelonDB reactive routes management
 * 
 * Provides offline-first route management with reactive updates.
 */
import { useCallback, useMemo, useState, useEffect } from "react";
import { database } from "../index";
import Route, { RouteStatus, RouteSource } from "../models/Route";
import { useObserveTable } from "./useDatabase";
import { Q } from "@nozbe/watermelondb";

export interface RouteItem {
  id: string;
  externalId: string;
  date: string;
  driverId: string;
  vehicleId: string;
  status: RouteStatus;
  totalPoints: number;
  completedPoints: number;
  estimatedDurationMinutes: number;
  actualDurationMinutes: number;
  totalDistanceMeters: number;
  routeSource: RouteSource;
  syncedAt: number;
  isPendingSync: boolean;
  createdAt: number;
  updatedAt: number;
  progress: number;
  isComplete: boolean;
  isInProgress: boolean;
}

/**
 * Convert WatermelonDB Route model to plain object
 */
function toRouteItem(route: Route): RouteItem {
  return {
    id: route.id,
    externalId: route.externalId,
    date: route.date,
    driverId: route.driverId,
    vehicleId: route.vehicleId,
    status: route.status,
    totalPoints: route.totalPoints,
    completedPoints: route.completedPoints,
    estimatedDurationMinutes: route.estimatedDurationMinutes,
    actualDurationMinutes: route.actualDurationMinutes,
    totalDistanceMeters: route.totalDistanceMeters,
    routeSource: route.routeSource,
    syncedAt: route.syncedAt,
    isPendingSync: route.isPendingSync,
    createdAt: route.createdAt,
    updatedAt: route.updatedAt,
    progress: route.progress,
    isComplete: route.isComplete,
    isInProgress: route.isInProgress,
  };
}

/**
 * Hook to observe all routes with reactive updates
 */
export function useRoutes(): {
  routes: RouteItem[];
  loading: boolean;
  error: string | null;
} {
  const { records, loading, error } = useObserveTable<Route>("routes");

  const routes = useMemo(() => {
    return records.map(toRouteItem);
  }, [records]);

  return { routes, loading, error };
}

/**
 * Hook to observe routes by status with reactive updates
 */
export function useRoutesByStatus(status: RouteStatus): {
  routes: RouteItem[];
  loading: boolean;
  error: string | null;
} {
  const [records, setRecords] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const observe = async () => {
      try {
        setLoading(true);
        const observable = database
          .get<Route>("routes")
          .query(Q.where("status", status))
          .observe();

        subscription = observable.subscribe({
          next: (data) => {
            setRecords(data);
            setLoading(false);
          },
          error: (err) => {
            console.error(`Error observing routes with status ${status}:`, err);
            setError(err.message);
            setLoading(false);
          },
        });
      } catch (err: any) {
        console.error(`Failed to observe routes with status ${status}:`, err);
        setError(err.message);
        setLoading(false);
      }
    };

    observe();

    return () => {
      subscription?.unsubscribe();
    };
  }, [status]);

  const routes = useMemo(() => {
    return records.map(toRouteItem);
  }, [records]);

  return { routes, loading, error };
}

/**
 * Hook to observe a single route by ID
 */
export function useRoute(routeId: string | null): {
  route: RouteItem | null;
  loading: boolean;
  error: string | null;
} {
  const [record, setRecord] = useState<Route | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeId) {
      setRecord(null);
      setLoading(false);
      return;
    }

    let subscription: { unsubscribe: () => void } | null = null;

    const observe = async () => {
      try {
        setLoading(true);
        const observable = database
          .get<Route>("routes")
          .findAndObserve(routeId);

        subscription = observable.subscribe({
          next: (data) => {
            setRecord(data);
            setLoading(false);
          },
          error: (err) => {
            console.error(`Error observing route ${routeId}:`, err);
            setError(err.message);
            setLoading(false);
          },
        });
      } catch (err: any) {
        console.error(`Failed to observe route ${routeId}:`, err);
        setError(err.message);
        setLoading(false);
      }
    };

    observe();

    return () => {
      subscription?.unsubscribe();
    };
  }, [routeId]);

  const route = useMemo(() => {
    return record ? toRouteItem(record) : null;
  }, [record]);

  return { route, loading, error };
}

/**
 * Hook for route CRUD operations
 */
export function useRoutesActions() {
  const createRoute = useCallback(
    async (params: {
      externalId?: string;
      date: string;
      driverId: string;
      vehicleId: string;
      totalPoints: number;
      estimatedDurationMinutes: number;
      totalDistanceMeters: number;
      routeSource: RouteSource;
    }): Promise<RouteItem> => {
      const externalId =
        params.externalId || `route_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const route = await database.write(async () => {
        return await database.get<Route>("routes").create((record) => {
          record.externalId = externalId;
          record.date = params.date;
          record.driverId = params.driverId;
          record.vehicleId = params.vehicleId;
          record.status = "not_started";
          record.totalPoints = params.totalPoints;
          record.completedPoints = 0;
          record.estimatedDurationMinutes = params.estimatedDurationMinutes;
          record.actualDurationMinutes = 0;
          record.totalDistanceMeters = params.totalDistanceMeters;
          record.routeSource = params.routeSource;
          record.syncedAt = 0;
          record.isPendingSync = true;
        });
      });

      return toRouteItem(route);
    },
    []
  );

  const updateRoute = useCallback(
    async (
      routeId: string,
      updates: Partial<{
        status: RouteStatus;
        completedPoints: number;
        actualDurationMinutes: number;
        totalDistanceMeters: number;
      }>
    ): Promise<RouteItem> => {
      const route = await database.write(async () => {
        const record = await database.get<Route>("routes").find(routeId);
        return await record.update((r) => {
          if (updates.status !== undefined) r.status = updates.status;
          if (updates.completedPoints !== undefined)
            r.completedPoints = updates.completedPoints;
          if (updates.actualDurationMinutes !== undefined)
            r.actualDurationMinutes = updates.actualDurationMinutes;
          if (updates.totalDistanceMeters !== undefined)
            r.totalDistanceMeters = updates.totalDistanceMeters;
          r.isPendingSync = true;
        });
      });

      return toRouteItem(route);
    },
    []
  );

  const startRoute = useCallback(async (routeId: string): Promise<RouteItem> => {
    const route = await database.write(async () => {
      const record = await database.get<Route>("routes").find(routeId);
      await record.startRoute();
      return record;
    });

    return toRouteItem(route);
  }, []);

  const completeRoute = useCallback(
    async (routeId: string, actualDurationMinutes?: number): Promise<RouteItem> => {
      const route = await database.write(async () => {
        const record = await database.get<Route>("routes").find(routeId);
        await record.completeRoute(actualDurationMinutes);
        return record;
      });

      return toRouteItem(route);
    },
    []
  );

  const deleteRoute = useCallback(async (routeId: string): Promise<void> => {
    await database.write(async () => {
      const record = await database.get<Route>("routes").find(routeId);
      await record.destroyPermanently();
    });
  }, []);

  const getRoute = useCallback(async (routeId: string): Promise<RouteItem | null> => {
    try {
      const route = await database.get<Route>("routes").find(routeId);
      return toRouteItem(route);
    } catch (err) {
      console.error(`Failed to get route ${routeId}:`, err);
      return null;
    }
  }, []);

  const getPendingSyncRoutes = useCallback(async (): Promise<RouteItem[]> => {
    const routes = await database
      .get<Route>("routes")
      .query(Q.where("is_pending_sync", true))
      .fetch();
    return routes.map(toRouteItem);
  }, []);

  return {
    createRoute,
    updateRoute,
    startRoute,
    completeRoute,
    deleteRoute,
    getRoute,
    getPendingSyncRoutes,
  };
}

export type { RouteStatus, RouteSource };