/**
 * WatermelonDB Database Setup for Web
 * 
 * Uses LokiJS adapter for browser-based storage (IndexedDB)
 * SQLite adapter doesn't work in browsers due to Node.js dependencies
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from './schema';
import WastePoint from './models/WastePoint';
import Route from './models/Route';
import CollectionPoint from './models/CollectionPoint';
import Zone from './models/Zone';
import Favorite from './models/Favorite';
import SyncStatus from './models/SyncStatus';

// LokiJS adapter for web (uses IndexedDB under the hood)
const adapter = new LokiJSAdapter({
  schema,
  // Use IndexedDB for persistence
  useWebWorker: false,
  useIncrementalIndexedDB: true,
  onSetUpError: (error: Error) => {
    console.error('[WatermelonDB] Database setup failed:', error);
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
    const { Q } = await import('@nozbe/watermelondb');
    return database.get('routes').query(Q.where('date', date)).fetch();
  },

  /**
   * Get all waste points
   */
  async getAllWastePoints() {
    return database.get('waste_points').fetch();
  },

  /**
   * Get pending sync count
   */
  async getPendingSyncCount() {
    const { Q } = await import('@nozbe/watermelondb');
    const tables = ['waste_points', 'routes', 'collection_points', 'zones', 'favorites'];
    let total = 0;
    for (const table of tables) {
      total += await database.get(table)
        .query(Q.where('is_pending_sync', true))
        .fetchCount();
    }
    return total;
  },
};

export default database;
