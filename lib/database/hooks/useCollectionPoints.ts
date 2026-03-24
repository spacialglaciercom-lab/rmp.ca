/**
 * CollectionPoints Hook - WatermelonDB reactive collection points management
 * 
 * Provides offline-first collection point management with reactive updates.
 */
import { useCallback, useMemo, useState, useEffect } from "react";
import { database } from "../index";
import CollectionPoint, { CollectionType, CollectionStatus } from "../models/CollectionPoint";
import { useObserveTable } from "./useDatabase";
import { Q } from "@nozbe/watermelondb";

export interface CollectionPointItem {
  id: string;
  externalId: string;
  routeId: string;
  wastePointId: string;
  sequence: number;
  latitude: number;
  longitude: number;
  address: string;
  collectionType: CollectionType;
  status: CollectionStatus;
  specialInstructions: string;
  notes: string;
  photoUri: string;
  completedAt: number;
  skippedReason: string;
  syncedAt: number;
  isPendingSync: boolean;
  createdAt: number;
  updatedAt: number;
  isCompleted: boolean;
  isPending: boolean;
  hasIssue: boolean;
}

/**
 * Convert WatermelonDB CollectionPoint model to plain object
 */
function toCollectionPointItem(point: CollectionPoint): CollectionPointItem {
  return {
    id: point.id,
    externalId: point.externalId,
    routeId: point.routeId,
    wastePointId: point.wastePointId,
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
    isCompleted: point.isCompleted,
    isPending: point.isPending,
    hasIssue: point.hasIssue,
  };
}

/**
 * Hook to observe all collection points with reactive updates
 */
export function useCollectionPoints(): {
  points: CollectionPointItem[];
  loading: boolean;
  error: string | null;
} {
  const { records, loading, error } = useObserveTable<CollectionPoint>("collection_points");

  const points = useMemo(() => {
    return records.map(toCollectionPointItem);
  }, [records]);

  return { points, loading, error };
}

/**
 * Hook to observe collection points for a specific route
 */
export function useCollectionPointsByRoute(routeId: string | null): {
  points: CollectionPointItem[];
  loading: boolean;
  error: string | null;
} {
  const [records, setRecords] = useState<CollectionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeId) {
      setRecords([]);
      setLoading(false);
      return;
    }

    let subscription: { unsubscribe: () => void } | null = null;

    const observe = async () => {
      try {
        setLoading(true);
        const observable = database
          .get<CollectionPoint>("collection_points")
          .query(Q.where("route_id", routeId), Q.sortBy("sequence", Q.asc))
          .observe();

        subscription = observable.subscribe({
          next: (data) => {
            setRecords(data);
            setLoading(false);
          },
          error: (err) => {
            console.error(`Error observing collection points for route ${routeId}:`, err);
            setError(err.message);
            setLoading(false);
          },
        });
      } catch (err: any) {
        console.error(`Failed to observe collection points for route ${routeId}:`, err);
        setError(err.message);
        setLoading(false);
      }
    };

    observe();

    return () => {
      subscription?.unsubscribe();
    };
  }, [routeId]);

  const points = useMemo(() => {
    return records.map(toCollectionPointItem);
  }, [records]);

  return { points, loading, error };
}

/**
 * Hook to observe collection points by status
 */
export function useCollectionPointsByStatus(status: CollectionStatus): {
  points: CollectionPointItem[];
  loading: boolean;
  error: string | null;
} {
  const [records, setRecords] = useState<CollectionPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const observe = async () => {
      try {
        setLoading(true);
        const observable = database
          .get<CollectionPoint>("collection_points")
          .query(Q.where("status", status))
          .observe();

        subscription = observable.subscribe({
          next: (data) => {
            setRecords(data);
            setLoading(false);
          },
          error: (err) => {
            console.error(`Error observing collection points with status ${status}:`, err);
            setError(err.message);
            setLoading(false);
          },
        });
      } catch (err: any) {
        console.error(`Failed to observe collection points with status ${status}:`, err);
        setError(err.message);
        setLoading(false);
      }
    };

    observe();

    return () => {
      subscription?.unsubscribe();
    };
  }, [status]);

  const points = useMemo(() => {
    return records.map(toCollectionPointItem);
  }, [records]);

  return { points, loading, error };
}

/**
 * Hook for collection point CRUD operations
 */
export function useCollectionPointsActions() {
  const createCollectionPoint = useCallback(
    async (params: {
      externalId?: string;
      routeId: string;
      wastePointId?: string;
      sequence: number;
      latitude: number;
      longitude: number;
      address?: string;
      collectionType: CollectionType;
      specialInstructions?: string;
    }): Promise<CollectionPointItem> => {
      const externalId =
        params.externalId || `cp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const point = await database.write(async () => {
        return await database.get<CollectionPoint>("collection_points").create((record) => {
          record.externalId = externalId;
          record.routeId = params.routeId;
          record.wastePointId = params.wastePointId || "";
          record.sequence = params.sequence;
          record.latitude = params.latitude;
          record.longitude = params.longitude;
          record.address = params.address || "";
          record.collectionType = params.collectionType;
          record.status = "pending";
          record.specialInstructions = params.specialInstructions || "";
          record.notes = "";
          record.photoUri = "";
          record.syncedAt = 0;
          record.isPendingSync = true;
        });
      });

      return toCollectionPointItem(point);
    },
    []
  );

  const updateCollectionPoint = useCallback(
    async (
      pointId: string,
      updates: Partial<{
        status: CollectionStatus;
        notes: string;
        photoUri: string;
        skippedReason: string;
      }>
    ): Promise<CollectionPointItem> => {
      const point = await database.write(async () => {
        const record = await database.get<CollectionPoint>("collection_points").find(pointId);
        return await record.update((p) => {
          if (updates.status !== undefined) p.status = updates.status;
          if (updates.notes !== undefined) p.notes = updates.notes;
          if (updates.photoUri !== undefined) p.photoUri = updates.photoUri;
          if (updates.skippedReason !== undefined) p.skippedReason = updates.skippedReason;
          p.isPendingSync = true;
        });
      });

      return toCollectionPointItem(point);
    },
    []
  );

  const markCompleted = useCallback(
    async (pointId: string, photoUri?: string, notes?: string): Promise<CollectionPointItem> => {
      const point = await database.write(async () => {
        const record = await database.get<CollectionPoint>("collection_points").find(pointId);
        await record.markCompleted(photoUri, notes);
        return record;
      });

      return toCollectionPointItem(point);
    },
    []
  );

  const markSkipped = useCallback(
    async (pointId: string, reason: string): Promise<CollectionPointItem> => {
      const point = await database.write(async () => {
        const record = await database.get<CollectionPoint>("collection_points").find(pointId);
        await record.markSkipped(reason);
        return record;
      });

      return toCollectionPointItem(point);
    },
    []
  );

  const reportIssue = useCallback(
    async (pointId: string, notes: string, photoUri?: string): Promise<CollectionPointItem> => {
      const point = await database.write(async () => {
        const record = await database.get<CollectionPoint>("collection_points").find(pointId);
        await record.reportIssue(notes, photoUri);
        return record;
      });

      return toCollectionPointItem(point);
    },
    []
  );

  const deleteCollectionPoint = useCallback(async (pointId: string): Promise<void> => {
    await database.write(async () => {
      const record = await database.get<CollectionPoint>("collection_points").find(pointId);
      await record.destroyPermanently();
    });
  }, []);

  const getCollectionPoint = useCallback(
    async (pointId: string): Promise<CollectionPointItem | null> => {
      try {
        const point = await database.get<CollectionPoint>("collection_points").find(pointId);
        return toCollectionPointItem(point);
      } catch (err) {
        console.error(`Failed to get collection point ${pointId}:`, err);
        return null;
      }
    },
    []
  );

  const getPendingSyncPoints = useCallback(async (): Promise<CollectionPointItem[]> => {
    const points = await database
      .get<CollectionPoint>("collection_points")
      .query(Q.where("is_pending_sync", true))
      .fetch();
    return points.map(toCollectionPointItem);
  }, []);

  const bulkCreatePoints = useCallback(
    async (
      routeId: string,
      pointsData: Array<{
        latitude: number;
        longitude: number;
        sequence: number;
        address?: string;
        collectionType: CollectionType;
        externalId?: string;
      }>
    ): Promise<CollectionPointItem[]> => {
      const createdPoints = await database.write(async () => {
        const points = await Promise.all(
          pointsData.map(async (data, index) => {
            const externalId =
              data.externalId || `cp_${routeId}_${index}_${Date.now()}`;

            return await database.get<CollectionPoint>("collection_points").create((record) => {
              record.externalId = externalId;
              record.routeId = routeId;
              record.wastePointId = "";
              record.sequence = data.sequence;
              record.latitude = data.latitude;
              record.longitude = data.longitude;
              record.address = data.address || "";
              record.collectionType = data.collectionType;
              record.status = "pending";
              record.specialInstructions = "";
              record.notes = "";
              record.photoUri = "";
              record.syncedAt = 0;
              record.isPendingSync = true;
            });
          })
        );
        return points;
      });

      return createdPoints.map(toCollectionPointItem);
    },
    []
  );

  return {
    createCollectionPoint,
    updateCollectionPoint,
    markCompleted,
    markSkipped,
    reportIssue,
    deleteCollectionPoint,
    getCollectionPoint,
    getPendingSyncPoints,
    bulkCreatePoints,
  };
}

export type { CollectionType, CollectionStatus };