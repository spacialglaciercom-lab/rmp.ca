/**
 * Routes Store - Offline-first route management with WatermelonDB
 * 
 * Persists routes locally for offline access and syncs when connectivity returns.
 */
import { create } from "zustand";
import { database } from "@/lib/database";
import Route, { RouteStatus, RouteSource } from "@/lib/database/models/Route";
import CollectionPoint, { CollectionType } from "@/lib/database/models/CollectionPoint";
import { Q } from "@nozbe/watermelondb";

export interface SavedRoute {
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
  /** Collection points for this route */
  points?: SavedCollectionPoint[];
}

export interface SavedCollectionPoint {
  id: string;
  externalId: string;
  routeId: string;
  sequence: number;
  latitude: number;
  longitude: number;
  address: string;
  collectionType: CollectionType;
  status: "pending" | "completed" | "skipped" | "issue";
  specialInstructions: string;
  notes: string;
  photoUri: string;
  completedAt: number;
  skippedReason: string;
  syncedAt: number;
  isPendingSync: boolean;
  createdAt: number;
  updatedAt: number;
}

interface RoutesState {
  routes: SavedRoute[];
  currentRoute: SavedRoute | null;
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
}

interface RoutesActions {
  loadFromDatabase: () => Promise<void>;
  saveRoute: (route: {
    date: string;
    driverId: string;
    vehicleId?: string;
    totalPoints: number;
    estimatedDurationMinutes: number;
    totalDistanceMeters: number;
    routeSource: RouteSource;
    points: Array<{
      latitude: number;
      longitude: number;
      sequence: number;
      address?: string;
      collectionType?: CollectionType;
      externalId?: string;
    }>;
  }) => Promise<SavedRoute>;
  updateRouteStatus: (routeId: string, status: RouteStatus) => Promise<void>;
  markPointCompleted: (pointId: string, photoUri?: string, notes?: string) => Promise<void>;
  markPointSkipped: (pointId: string, reason: string) => Promise<void>;
  deleteRoute: (routeId: string) => Promise<void>;
  setCurrentRoute: (route: SavedRoute | null) => void;
  getRouteWithPoints: (routeId: string) => Promise<SavedRoute | null>;
  getPendingSyncRoutes: () => Promise<SavedRoute[]>;
  syncToDatabase: () => Promise<void>;
  clearError: () => void;
}

type RoutesStore = RoutesState & RoutesActions;

function toSavedRoute(route: Route, points?: CollectionPoint[]): SavedRoute {
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
    points: points?.map(toSavedCollectionPoint),
  };
}

function toSavedCollectionPoint(point: CollectionPoint): SavedCollectionPoint {
  return {
    id: point.id,
    externalId: point.externalId,
    routeId: point.routeId,
    sequence: point.sequence,
    latitude: point.latitude,
    longitude: point.longitude,
    address: point.address,
    collectionType: point.collectionType,
    status: point.status,
    specialInstructions: point.specialInstructions,
    notes: point.notes,
    photoUri: point.photoUri,
    completedAt: point.completedAt,
    skippedReason: point.skippedReason,
    syncedAt: point.syncedAt,
    isPendingSync: point.isPendingSync,
    createdAt: point.createdAt,
    updatedAt: point.updatedAt,
  };
}

export const useRoutesStore = create<RoutesStore>((set, get) => ({
  routes: [],
  currentRoute: null,
  isLoading: false,
  isLoaded: false,
  error: null,

  loadFromDatabase: async () => {
    try {
      set({ isLoading: true, error: null });
      
      const routes = await database.get<Route>("routes").query().fetch();
      const savedRoutes: SavedRoute[] = await Promise.all(
        routes.map(async (route) => {
          const points = await database
            .get<CollectionPoint>("collection_points")
            .query(Q.where("route_id", route.id), Q.sortBy("sequence", Q.asc))
            .fetch();
          return toSavedRoute(route, points);
        })
      );

      set({ routes: savedRoutes, isLoading: false, isLoaded: true });
    } catch (error: any) {
      console.error("Failed to load routes from database:", error);
      set({ error: error.message, isLoading: false });
    }
  },

  saveRoute: async (params) => {
    try {
      const externalId = `route_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const result = await database.write(async () => {
        // Create the route
        const route = await database.get<Route>("routes").create((record) => {
          record.externalId = externalId;
          record.date = params.date;
          record.driverId = params.driverId;
          record.vehicleId = params.vehicleId || "";
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

        // Create collection points
        const points = await Promise.all(
          params.points.map(async (point, index) => {
            const pointExternalId = point.externalId || `cp_${externalId}_${index}`;
            return await database.get<CollectionPoint>("collection_points").create((record) => {
              record.externalId = pointExternalId;
              record.routeId = route.id;
              record.wastePointId = "";
              record.sequence = point.sequence;
              record.latitude = point.latitude;
              record.longitude = point.longitude;
              record.address = point.address || "";
              record.collectionType = point.collectionType || "residential";
              record.status = "pending";
              record.specialInstructions = "";
              record.notes = "";
              record.photoUri = "";
              record.syncedAt = 0;
              record.isPendingSync = true;
            });
          })
        );

        return { route, points };
      });

      const savedRoute = toSavedRoute(result.route, result.points);

      set((state) => ({
        routes: [savedRoute, ...state.routes],
        currentRoute: savedRoute,
      }));

      return savedRoute;
    } catch (error: any) {
      console.error("Failed to save route:", error);
      set({ error: error.message });
      throw error;
    }
  },

  updateRouteStatus: async (routeId, status) => {
    try {
      await database.write(async () => {
        const route = await database.get<Route>("routes").find(routeId);
        await route.update((r) => {
          r.status = status;
          r.isPendingSync = true;
        });
      });

      set((state) => ({
        routes: state.routes.map((r) =>
          r.id === routeId ? { ...r, status, isPendingSync: true } : r
        ),
        currentRoute:
          state.currentRoute?.id === routeId
            ? { ...state.currentRoute, status, isPendingSync: true }
            : state.currentRoute,
      }));
    } catch (error: any) {
      console.error("Failed to update route status:", error);
      set({ error: error.message });
    }
  },

  markPointCompleted: async (pointId, photoUri, notes) => {
    try {
      await database.write(async () => {
        const point = await database.get<CollectionPoint>("collection_points").find(pointId);
        await point.markCompleted(photoUri, notes);
      });

      // Update local state
      set((state) => ({
        routes: state.routes.map((route) => {
          if (route.points) {
            const updatedPoints = route.points.map((p) =>
              p.id === pointId
                ? {
                    ...p,
                    status: "completed" as const,
                    photoUri: photoUri || p.photoUri,
                    notes: notes || p.notes,
                    completedAt: Date.now(),
                    isPendingSync: true,
                  }
                : p
            );
            const completedCount = updatedPoints.filter(
              (p) => p.status === "completed" || p.status === "skipped"
            ).length;
            return {
              ...route,
              points: updatedPoints,
              completedPoints: completedCount,
              isPendingSync: true,
            };
          }
          return route;
        }),
      }));
    } catch (error: any) {
      console.error("Failed to mark point completed:", error);
      set({ error: error.message });
    }
  },

  markPointSkipped: async (pointId, reason) => {
    try {
      await database.write(async () => {
        const point = await database.get<CollectionPoint>("collection_points").find(pointId);
        await point.markSkipped(reason);
      });

      // Update local state
      set((state) => ({
        routes: state.routes.map((route) => {
          if (route.points) {
            const updatedPoints = route.points.map((p) =>
              p.id === pointId
                ? {
                    ...p,
                    status: "skipped" as const,
                    skippedReason: reason,
                    isPendingSync: true,
                  }
                : p
            );
            const completedCount = updatedPoints.filter(
              (p) => p.status === "completed" || p.status === "skipped"
            ).length;
            return {
              ...route,
              points: updatedPoints,
              completedPoints: completedCount,
              isPendingSync: true,
            };
          }
          return route;
        }),
      }));
    } catch (error: any) {
      console.error("Failed to mark point skipped:", error);
      set({ error: error.message });
    }
  },

  deleteRoute: async (routeId) => {
    try {
      await database.write(async () => {
        // Delete collection points first
        const points = await database
          .get<CollectionPoint>("collection_points")
          .query(Q.where("route_id", routeId))
          .fetch();
        for (const point of points) {
          await point.destroyPermanently();
        }

        // Delete the route
        const route = await database.get<Route>("routes").find(routeId);
        await route.destroyPermanently();
      });

      set((state) => ({
        routes: state.routes.filter((r) => r.id !== routeId),
        currentRoute:
          state.currentRoute?.id === routeId ? null : state.currentRoute,
      }));
    } catch (error: any) {
      console.error("Failed to delete route:", error);
      set({ error: error.message });
    }
  },

  setCurrentRoute: (route) => {
    set({ currentRoute: route });
  },

  getRouteWithPoints: async (routeId) => {
    try {
      const route = await database.get<Route>("routes").find(routeId);
      const points = await database
        .get<CollectionPoint>("collection_points")
        .query(Q.where("route_id", routeId), Q.sortBy("sequence", Q.asc))
        .fetch();
      return toSavedRoute(route, points);
    } catch (error: any) {
      console.error("Failed to get route with points:", error);
      return null;
    }
  },

  getPendingSyncRoutes: async () => {
    try {
      const routes = await database
        .get<Route>("routes")
        .query(Q.where("is_pending_sync", true))
        .fetch();
      return routes.map((r) => toSavedRoute(r));
    } catch (error: any) {
      console.error("Failed to get pending sync routes:", error);
      return [];
    }
  },

  syncToDatabase: async () => {
    // This is handled by the sync engine - just trigger a sync
    const { syncEngine } = await import("@/lib/database/sync/syncEngine");
    await syncEngine.forceSync();
  },

  clearError: () => {
    set({ error: null });
  },
}));

export type { RouteStatus, RouteSource };