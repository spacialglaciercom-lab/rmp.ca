/**
 * useFavorites Hook - Offline-aware favorites management with WatermelonDB
 * 
 * Provides reactive favorites data using WatermelonDB observables.
 * All changes are persisted locally and synced when connectivity returns.
 */
import { useState, useEffect, useCallback } from 'react';
import { database, Favorite } from '../index';
import { Q } from '@nozbe/watermelondb';
import { useObserveTable } from './useDatabase';
import type { FavoriteCategory } from '../models/Favorite';

export interface FavoriteItem {
  id: string;
  externalId: string | null;
  name: string;
  latitude: number;
  longitude: number;
  category: FavoriteCategory;
  notes: string;
  isPendingSync: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Hook to observe all favorites with reactive updates
 */
export function useFavorites() {
  const { records, loading, error } = useObserveTable<Favorite>('favorites');
  
  // Transform WatermelonDB records to plain objects
  const favorites: FavoriteItem[] = records.map((record) => ({
    id: record.id,
    externalId: record.externalId || null,
    name: record.name,
    latitude: record.latitude,
    longitude: record.longitude,
    category: record.category as FavoriteCategory,
    notes: record.notes || '',
    isPendingSync: record.isPendingSync,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  }));

  return { favorites, loading, error };
}

/**
 * Hook to observe favorites filtered by category
 */
export function useFavoritesByCategory(category: FavoriteCategory) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const observe = async () => {
      try {
        setLoading(true);
        const query = database.get<Favorite>('favorites');
        const observable = query.query(Q.where('category', category)).observe();

        subscription = observable.subscribe({
          next: (records) => {
            setFavorites(
              records.map((record) => ({
                id: record.id,
                externalId: record.externalId || null,
                name: record.name,
                latitude: record.latitude,
                longitude: record.longitude,
                category: record.category as FavoriteCategory,
                notes: record.notes || '',
                isPendingSync: record.isPendingSync,
                createdAt: new Date(record.createdAt),
                updatedAt: new Date(record.updatedAt),
              }))
            );
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
  }, [category]);

  return { favorites, loading, error };
}

/**
 * Hook for favorite CRUD operations with offline support
 */
export function useFavoritesActions() {
  /**
   * Add a new favorite
   */
  const addFavorite = useCallback(
    async (params: {
      name: string;
      latitude: number;
      longitude: number;
      category?: FavoriteCategory;
      notes?: string;
      externalId?: string;
    }): Promise<Favorite> => {
      const favorite = await database.write(async () => {
        return database.get<Favorite>('favorites').create((record: any) => {
          record.name = params.name;
          record.latitude = params.latitude;
          record.longitude = params.longitude;
          record.category = params.category || 'waypoint';
          record.notes = params.notes || '';
          record.externalId = params.externalId || null;
          record.isPendingSync = true;
          record.createdAt = Date.now();
          record.updatedAt = Date.now();
        });
      });
      return favorite;
    },
    []
  );

  /**
   * Update an existing favorite
   */
  const updateFavorite = useCallback(
    async (
      id: string,
      updates: {
        name?: string;
        notes?: string;
        latitude?: number;
        longitude?: number;
        category?: FavoriteCategory;
      }
    ): Promise<Favorite | null> => {
      return database.write(async () => {
        const favorite = await database.get<Favorite>('favorites').find(id);
        await favorite.update((record: any) => {
          if (updates.name !== undefined) record.name = updates.name;
          if (updates.notes !== undefined) record.notes = updates.notes;
          if (updates.latitude !== undefined) record.latitude = updates.latitude;
          if (updates.longitude !== undefined) record.longitude = updates.longitude;
          if (updates.category !== undefined) record.category = updates.category;
          record.updatedAt = Date.now();
          record.isPendingSync = true;
        });
        return favorite;
      });
    },
    []
  );

  /**
   * Delete a favorite
   */
  const deleteFavorite = useCallback(async (id: string): Promise<void> => {
    await database.write(async () => {
      const favorite = await database.get<Favorite>('favorites').find(id);
      await favorite.destroyPermanently();
    });
  }, []);

  /**
   * Get a single favorite by ID
   */
  const getFavorite = useCallback(async (id: string): Promise<FavoriteItem | null> => {
    try {
      const favorite = await database.get<Favorite>('favorites').find(id);
      return {
        id: favorite.id,
        externalId: favorite.externalId || null,
        name: favorite.name,
        latitude: favorite.latitude,
        longitude: favorite.longitude,
        category: favorite.category as FavoriteCategory,
        notes: favorite.notes || '',
        isPendingSync: favorite.isPendingSync,
        createdAt: new Date(favorite.createdAt),
        updatedAt: new Date(favorite.updatedAt),
      };
    } catch {
      return null;
    }
  }, []);

  /**
   * Clear all favorites
   */
  const clearAllFavorites = useCallback(async (): Promise<void> => {
    await database.write(async () => {
      const favorites = await database.get<Favorite>('favorites').query().fetch();
      await Promise.all(favorites.map((f) => f.destroyPermanently()));
    });
  }, []);

  /**
   * Import favorites from GPX data
   */
  const importFromGPX = useCallback(
    async (gpxData: string): Promise<number> => {
      const points = parseGPXPoints(gpxData);
      if (points.length === 0) return 0;

      await database.write(async () => {
        for (const point of points) {
          await database.get<Favorite>('favorites').create((record: any) => {
            record.name = point.name;
            record.latitude = point.lat;
            record.longitude = point.lon;
            record.category = 'waypoint';
            record.notes = '';
            record.isPendingSync = true;
            record.createdAt = Date.now();
            record.updatedAt = Date.now();
          });
        }
      });

      return points.length;
    },
    []
  );

  /**
   * Export a favorite to GPX format
   */
  const exportFavoriteToGPX = useCallback((favorite: FavoriteItem): string => {
    const timestamp = new Date().toISOString();
    const safeName = escapeXml(favorite.name);
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteMasterPro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>
    <time>${timestamp}</time>
    <desc>Exported from RouteMasterPro My Places</desc>
  </metadata>
  <wpt lat="${favorite.latitude}" lon="${favorite.longitude}">
    <name>${safeName}</name>
    <time>${timestamp}</time>
  </wpt>
</gpx>`;
  }, []);

  return {
    addFavorite,
    updateFavorite,
    deleteFavorite,
    getFavorite,
    clearAllFavorites,
    importFromGPX,
    exportFavoriteToGPX,
  };
}

/**
 * Parse GPX data to extract waypoints
 */
function parseGPXPoints(
  gpxData: string
): Array<{ name: string; lat: number; lon: number }> {
  const points: Array<{ name: string; lat: number; lon: number }> = [];

  // Parse wpt (waypoint) elements
  const wptRegex =
    /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi;
  let match;
  while ((match = wptRegex.exec(gpxData)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      const inner = match[3];
      const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/i);
      const name = nameMatch ? nameMatch[1].trim() : `Point ${points.length + 1}`;
      points.push({ name, lat, lon });
    }
  }

  // Parse trkpt (track point) elements if no waypoints
  if (points.length === 0) {
    const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>/gi;
    const trackPts: Array<{ lat: number; lon: number }> = [];
    while ((match = trkptRegex.exec(gpxData)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        trackPts.push({ lat, lon });
      }
    }
    if (trackPts.length > 0) {
      const nameMatch = gpxData.match(/<name>([\s\S]*?)<\/name>/i);
      const name = nameMatch ? nameMatch[1].trim() : 'Imported Track';
      points.push({ name, lat: trackPts[0].lat, lon: trackPts[0].lon });
      if (trackPts.length > 1) {
        points.push({
          name: `${name} (end)`,
          lat: trackPts[trackPts.length - 1].lat,
          lon: trackPts[trackPts.length - 1].lon,
        });
      }
    }
  }

  return points;
}

/**
 * Escape XML special characters
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}