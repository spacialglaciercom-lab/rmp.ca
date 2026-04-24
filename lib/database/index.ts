/**
 * WatermelonDB Database Setup
 * 
 * Offline-first database for rural drivers with spotty cell service.
 * Provides local SQLite storage with sync capabilities.
 */
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { schema } from './schema';
import WastePoint from './models/WastePoint';
import Route from './models/Route';
import CollectionPoint from './models/CollectionPoint';
import Zone from './models/Zone';
import Favorite from './models/Favorite';
import SyncStatus from './models/SyncStatus';

// SQLite adapter - JSI disabled due to native module availability issues
const adapter = new SQLiteAdapter({
  schema,
  dbName: 'rmp_offline_db',
  jsi: false,
  onSetUpError: (error: Error) => {
    console.error('Database setup failed:', error);
  },
});

// Database instance with all model classes
export const database = new Database({
  adapter,
  modelClasses: [
    WastePoint,
    Route,
    CollectionPoint,
    Zone,
    Favorite,
    SyncStatus,
  ],
});

// Re-export models for convenience
export { WastePoint, Route, CollectionPoint, Zone, Favorite, SyncStatus };

// Database helper functions
export const db = {
  /**
   * Get a route by ID
   */
  async getRoute(id: string) {
    return database.get('routes').find(id);
  },

  /**
   * Get all routes for a date
   */
  async getRoutesByDate(date: string) {
    const { Q } = require('@nozbe/watermelondb');
    return database.get('routes').query(Q.where('date', date)).fetch();
  },

  /**
   * Get all pending sync records across all tables
   */
  async getPendingSyncCount(): Promise<number> {
    const { Q } = require('@nozbe/watermelondb');
    const tables = ['waste_points', 'routes', 'collection_points', 'zones', 'favorites'];
    let total = 0;
    
    for (const table of tables) {
      total += await database.get(table)
        .query(Q.where('is_pending_sync', true))
        .fetchCount();
    }
    
    return total;
  },

  /**
   * Get collection points for a route
   */
  async getCollectionPoints(routeId: string) {
    const { Q } = require('@nozbe/watermelondb');
    return database.get('collection_points')
      .query(Q.where('route_id', routeId), Q.sortBy('sequence'))
      .fetch();
  },

  /**
   * Get nearby waste points within radius
   */
  async getNearbyWastePoints(lat: number, lon: number, radiusKm: number) {
    const allPoints = await database.get('waste_points').query().fetch();
    const radiusM = radiusKm * 1000;
    
    return allPoints.filter((point: any) => {
      const distance = point.distanceFrom(lat, lon);
      return distance <= radiusM;
    });
  },

  /**
   * Create a new route
   */
  async createRoute(data: {
    externalId?: string;
    date: string;
    driverId: string;
    vehicleId?: string;
    totalPoints: number;
    estimatedDurationMinutes?: number;
    routeSource?: string;
  }) {
    return database.write(async () => {
      return database.get('routes').create((record: any) => {
        if (data.externalId) record.externalId = data.externalId;
        record.date = data.date;
        record.driverId = data.driverId;
        if (data.vehicleId) record.vehicleId = data.vehicleId;
        record.status = 'not_started';
        record.totalPoints = data.totalPoints;
        record.completedPoints = 0;
        if (data.estimatedDurationMinutes) {
          record.estimatedDurationMinutes = data.estimatedDurationMinutes;
        }
        record.routeSource = data.routeSource || 'manual';
        record.isPendingSync = true;
        record.createdAt = Date.now();
        record.updatedAt = Date.now();
      });
    });
  },

  /**
   * Create a collection point
   */
  async createCollectionPoint(data: {
    routeId: string;
    wastePointId?: string;
    sequence: number;
    latitude: number;
    longitude: number;
    address?: string;
    collectionType?: string;
    specialInstructions?: string;
  }) {
    return database.write(async () => {
      return database.get('collection_points').create((record: any) => {
        record.routeId = data.routeId;
        if (data.wastePointId) record.wastePointId = data.wastePointId;
        record.sequence = data.sequence;
        record.latitude = data.latitude;
        record.longitude = data.longitude;
        if (data.address) record.address = data.address;
        record.collectionType = data.collectionType || 'residential';
        record.status = 'pending';
        if (data.specialInstructions) {
          record.specialInstructions = data.specialInstructions;
        }
        record.isPendingSync = true;
        record.createdAt = Date.now();
        record.updatedAt = Date.now();
      });
    });
  },

  /**
   * Clear all local data (use with caution!)
   */
  async clearAllData() {
    await database.write(async () => {
      const tables = ['waste_points', 'routes', 'collection_points', 'zones', 'favorites', 'sync_status'];
      
      for (const table of tables) {
        const records = await database.get(table).query().fetch();
        for (const record of records) {
          await record.destroyPermanently();
        }
      }
    });
  },
};

// Export sync engine and location sync
export { syncEngine } from './sync/syncEngine';
export { locationSync } from './sync/locationSync';

// Export database provider and hooks
export { DatabaseProvider, useDatabaseContext, withDatabase } from './DatabaseProvider';
export { useDatabase, useLocationSync, useObserveTable } from './hooks/useDatabase';
export {
  useFavorites,
  useFavoritesByCategory,
  useFavoritesActions,
} from './hooks/useFavorites';
export type { FavoriteItem } from './hooks/useFavorites';
export {
  useRoutes,
  useRoutesByStatus,
  useRoute,
  useRoutesActions,
} from './hooks/useRoutes';
export type { RouteItem, RouteStatus, RouteSource } from './hooks/useRoutes';
export {
  useCollectionPoints,
  useCollectionPointsByRoute,
  useCollectionPointsByStatus,
  useCollectionPointsActions,
} from './hooks/useCollectionPoints';
export type { CollectionPointItem, CollectionType, CollectionStatus } from './hooks/useCollectionPoints';

// Export migration utilities
export {
  isMigrationNeeded,
  runMigration,
  getMigrationStatus,
} from './migrations/asyncStorageMigration';