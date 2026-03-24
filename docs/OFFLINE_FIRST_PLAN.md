# Offline-First Implementation Plan: WatermelonDB for Rural Drivers

## Executive Summary

Enable drivers in rural areas with spotty cell service to stay productive by implementing offline-first data storage with WatermelonDB and periodic sync when connectivity is available.

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Install Dependencies

```bash
pnpm add @nozbe/watermelondb @nozbe/watermelondb-decorators @nozbe/with-observables
pnpm add @nozbe/watermelondb-sqlite-adapter  # Native SQLite
# OR for Expo:
pnpm add expo-sqlite
```

### 1.2 Database Schema

Create `lib/database/schema.ts`:

```typescript
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    // Core entities
    tableSchema({
      name: 'waste_points',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'type', type: 'string' }, // bin | dumpster
        { name: 'capacity_liters', type: 'number' },
        { name: 'condition', type: 'string' }, // good | overflowing | damaged
        { name: 'address', type: 'string' },
        { name: 'zone_id', type: 'string', isIndexed: true },
        { name: 'last_serviced_at', type: 'number' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    
    tableSchema({
      name: 'routes',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'date', type: 'string', isIndexed: true },
        { name: 'driver_id', type: 'string', isIndexed: true },
        { name: 'vehicle_id', type: 'string' },
        { name: 'status', type: 'string' }, // not_started | in_progress | completed
        { name: 'total_points', type: 'number' },
        { name: 'completed_points', type: 'number' },
        { name: 'estimated_duration_minutes', type: 'number' },
        { name: 'actual_duration_minutes', type: 'number' },
        { name: 'total_distance_meters', type: 'number' },
        { name: 'route_source', type: 'string' }, // vrp | osm | manual
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    
    tableSchema({
      name: 'collection_points',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'route_id', type: 'string', isIndexed: true },
        { name: 'waste_point_id', type: 'string', isIndexed: true },
        { name: 'sequence', type: 'number' },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'address', type: 'string' },
        { name: 'collection_type', type: 'string' }, // residential | commercial | recycling | bulk
        { name: 'status', type: 'string' }, // pending | completed | skipped | issue
        { name: 'special_instructions', type: 'string' },
        { name: 'notes', type: 'string' },
        { name: 'photo_uri', type: 'string' },
        { name: 'completed_at', type: 'number' },
        { name: 'skipped_reason', type: 'string' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    
    tableSchema({
      name: 'zones',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'geojson', type: 'string' }, // JSON string
        { name: 'center_lat', type: 'number' },
        { name: 'center_lon', type: 'number' },
        { name: 'point_count', type: 'number' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    
    tableSchema({
      name: 'favorites',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'category', type: 'string' }, // waypoint | depot | landmark
        { name: 'notes', type: 'string' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    
    // Sync metadata
    tableSchema({
      name: 'sync_status',
      columns: [
        { name: 'table_name', type: 'string', isIndexed: true },
        { name: 'last_sync_at', type: 'number' },
        { name: 'last_sync_token', type: 'string' },
        { name: 'pending_changes_count', type: 'number' },
      ],
    }),
  ],
});
```

### 1.3 Model Definitions

Create `lib/database/models/`:

```typescript
// lib/database/models/WastePoint.ts
import { Model, Q } from '@nozbe/watermelondb';
import { field, date, readonly, children, relation } from '@nozbe/watermelondb/decorators';

export default class WastePoint extends Model {
  static table = 'waste_points';
  
  static associations = {
    collection_points: { type: 'has_many', foreignKey: 'waste_point_id' },
    zones: { type: 'belongs_to', key: 'zone_id' },
  };
  
  @field('external_id') externalId;
  @field('latitude') latitude;
  @field('longitude') longitude;
  @field('type') type;
  @field('capacity_liters') capacityLiters;
  @field('condition') condition;
  @field('address') address;
  @field('zone_id') zoneId;
  @date('last_serviced_at') lastServicedAt;
  @date('synced_at') syncedAt;
  @field('is_pending_sync') isPendingSync;
  @readonly @date('created_at') createdAt;
  @date('updated_at') updatedAt;
  
  @children('collection_points') collectionPoints;
  
  // Mark for sync
  markForSync() {
    this.update((record) => {
      record.isPendingSync = true;
      record.updatedAt = Date.now();
    });
  }
  
  // Distance calculation helper
  distanceFrom(lat: number, lon: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = (this.latitude - lat) * Math.PI / 180;
    const dLon = (this.longitude - lon) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat * Math.PI / 180) * Math.cos(this.latitude * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
}
```

```typescript
// lib/database/models/Route.ts
import { Model } from '@nozbe/watermelondb';
import { field, date, readonly, children } from '@nozbe/watermelondb/decorators';

export default class Route extends Model {
  static table = 'routes';
  
  static associations = {
    collection_points: { type: 'has_many', foreignKey: 'route_id' },
  };
  
  @field('external_id') externalId;
  @field('date') date;
  @field('driver_id') driverId;
  @field('vehicle_id') vehicleId;
  @field('status') status;
  @field('total_points') totalPoints;
  @field('completed_points') completedPoints;
  @field('estimated_duration_minutes') estimatedDurationMinutes;
  @field('actual_duration_minutes') actualDurationMinutes;
  @field('total_distance_meters') totalDistanceMeters;
  @field('route_source') routeSource;
  @date('synced_at') syncedAt;
  @field('is_pending_sync') isPendingSync;
  @readonly @date('created_at') createdAt;
  @date('updated_at') updatedAt;
  
  @children('collection_points') collectionPoints;
  
  // Computed progress
  get progress(): number {
    return this.totalPoints > 0 ? this.completedPoints / this.totalPoints : 0;
  }
  
  // Start route
  async startRoute() {
    await this.update((record) => {
      record.status = 'in_progress';
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }
  
  // Complete route
  async completeRoute(actualDuration: number) {
    await this.update((record) => {
      record.status = 'completed';
      record.actualDurationMinutes = actualDuration;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }
}
```

```typescript
// lib/database/models/CollectionPoint.ts
import { Model } from '@nozbe/watermelondb';
import { field, date, readonly, relation } from '@nozbe/watermelondb/decorators';

export default class CollectionPoint extends Model {
  static table = 'collection_points';
  
  static associations = {
    routes: { type: 'belongs_to', key: 'route_id' },
    waste_points: { type: 'belongs_to', key: 'waste_point_id' },
  };
  
  @field('external_id') externalId;
  @field('route_id') routeId;
  @field('waste_point_id') wastePointId;
  @field('sequence') sequence;
  @field('latitude') latitude;
  @field('longitude') longitude;
  @field('address') address;
  @field('collection_type') collectionType;
  @field('status') status;
  @field('special_instructions') specialInstructions;
  @field('notes') notes;
  @field('photo_uri') photoUri;
  @date('completed_at') completedAt;
  @field('skipped_reason') skippedReason;
  @date('synced_at') syncedAt;
  @field('is_pending_sync') isPendingSync;
  @readonly @date('created_at') createdAt;
  @date('updated_at') updatedAt;
  
  @relation('routes', 'route_id') route;
  @relation('waste_points', 'waste_point_id') wastePoint;
  
  // Mark as completed
  async markCompleted(photoUri?: string, notes?: string) {
    await this.update((record) => {
      record.status = 'completed';
      record.completedAt = Date.now();
      if (photoUri) record.photoUri = photoUri;
      if (notes) record.notes = notes;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
    
    // Update parent route
    const route = await this.route.fetch();
    await route.update((r) => {
      r.completedPoints = (r.completedPoints || 0) + 1;
      r.isPendingSync = true;
    });
  }
  
  // Mark as skipped
  async markSkipped(reason: string) {
    await this.update((record) => {
      record.status = 'skipped';
      record.skippedReason = reason;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }
  
  // Report issue
  async reportIssue(notes: string, photoUri?: string) {
    await this.update((record) => {
      record.status = 'issue';
      record.notes = notes;
      if (photoUri) record.photoUri = photoUri;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }
}
```

### 1.4 Database Setup

Create `lib/database/index.ts`:

```typescript
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb-sqlite-adapter';
import { schema } from './schema';
import WastePoint from './models/WastePoint';
import Route from './models/Route';
import CollectionPoint from './models/CollectionPoint';
import Zone from './models/Zone';
import Favorite from './models/Favorite';
import SyncStatus from './models/SyncStatus';

const adapter = new SQLiteAdapter({
  schema,
  dbName: 'rmp_offline_db',
  // Use SQLite WAL mode for better performance
  jsi: true,
  onSetUpError: (error) => {
    console.error('Database setup failed:', error);
  },
});

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

export { WastePoint, Route, CollectionPoint, Zone, Favorite };
```

---

## Phase 2: Sync Engine (Week 3-4)

### 2.1 Sync Protocol

Create `lib/database/sync/syncEngine.ts`:

```typescript
import { database } from '../index';
import { Q } from '@nozbe/watermelondb';
import NetInfo from '@react-native-community/netinfo';
import { trpc } from '../../lib/trpc';

interface SyncConfig {
  tables: string[];
  batchSize: number;
  maxRetries: number;
  syncInterval: number; // ms
}

const DEFAULT_CONFIG: SyncConfig = {
  tables: ['waste_points', 'routes', 'collection_points', 'zones', 'favorites'],
  batchSize: 100,
  maxRetries: 3,
  syncInterval: 60000, // 1 minute
};

export class SyncEngine {
  private config: SyncConfig;
  private isSyncing = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime: number = 0;
  
  constructor(config: Partial<SyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // Start periodic sync
  startPeriodicSync() {
    this.syncTimer = setInterval(() => {
      this.attemptSync();
    }, this.config.syncInterval);
    
    // Also listen for network changes
    NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        this.attemptSync();
      }
    });
  }
  
  stopPeriodicSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
  
  // Attempt sync if conditions are met
  async attemptSync(): Promise<SyncResult> {
    const netInfo = await NetInfo.fetch();
    
    if (!netInfo.isConnected || !netInfo.isInternetReachable) {
      return { success: false, reason: 'offline' };
    }
    
    if (this.isSyncing) {
      return { success: false, reason: 'already_syncing' };
    }
    
    return this.sync();
  }
  
  // Main sync method
  async sync(): Promise<SyncResult> {
    this.isSyncing = true;
    const result: SyncResult = {
      success: true,
      pushed: 0,
      pulled: 0,
      errors: [],
    };
    
    try {
      // 1. Push local changes
      const pushResult = await this.pushChanges();
      result.pushed = pushResult.count;
      result.errors.push(...pushResult.errors);
      
      // 2. Pull remote changes
      const pullResult = await this.pullChanges();
      result.pulled = pullResult.count;
      result.errors.push(...pullResult.errors);
      
      // 3. Update sync status
      await this.updateSyncStatus();
      
      this.lastSyncTime = Date.now();
    } catch (error) {
      result.success = false;
      result.errors.push(error.message);
    } finally {
      this.isSyncing = false;
    }
    
    return result;
  }
  
  // Push pending changes to server
  private async pushChanges(): Promise<{ count: number; errors: Error[] }> {
    const errors: Error[] = [];
    let count = 0;
    
    for (const tableName of this.config.tables) {
      try {
        const pendingRecords = await database.get(tableName)
          .query(Q.where('is_pending_sync', true))
          .fetch();
        
        if (pendingRecords.length === 0) continue;
        
        // Process in batches
        for (let i = 0; i < pendingRecords.length; i += this.config.batchSize) {
          const batch = pendingRecords.slice(i, i + this.config.batchSize);
          const changes = batch.map((record) => ({
            id: record.externalId || record.id,
            table: tableName,
            action: record.externalId ? 'update' : 'create',
            data: record._raw,
          }));
          
          await trpc.sync.push.mutate({ changes });
          
          // Mark as synced
          await database.write(async () => {
            for (const record of batch) {
              await record.update((r: any) => {
                r.isPendingSync = false;
                r.syncedAt = Date.now();
              });
            }
          });
          
          count += batch.length;
        }
      } catch (error) {
        errors.push(new Error(`Push ${tableName} failed: ${error.message}`));
      }
    }
    
    return { count, errors };
  }
  
  // Pull remote changes
  private async pullChanges(): Promise<{ count: number; errors: Error[] }> {
    const errors: Error[] = [];
    let count = 0;
    
    for (const tableName of this.config.tables) {
      try {
        // Get last sync token
        const syncStatus = await database.get('sync_status')
          .query(Q.where('table_name', tableName))
          .fetch();
        const lastToken = syncStatus[0]?.lastSyncToken || null;
        
        // Fetch changes from server
        const response = await trpc.sync.pull.query({
          table: tableName,
          since: lastToken,
          limit: this.config.batchSize,
        });
        
        if (response.changes.length === 0) continue;
        
        // Apply changes locally
        await database.write(async () => {
          for (const change of response.changes) {
            const existing = await database.get(tableName)
              .query(Q.where('external_id', change.id))
              .fetch();
            
            if (existing.length > 0) {
              // Update existing
              await existing[0].update((record: any) => {
                Object.assign(record, change.data);
                record.syncedAt = Date.now();
              });
            } else {
              // Create new
              await database.get(tableName).create((record: any) => {
                record.externalId = change.id;
                Object.assign(record, change.data);
                record.syncedAt = Date.now();
              });
            }
          }
        });
        
        // Update sync token
        await this.updateSyncToken(tableName, response.nextToken);
        
        count += response.changes.length;
      } catch (error) {
        errors.push(new Error(`Pull ${tableName} failed: ${error.message}`));
      }
    }
    
    return { count, errors };
  }
  
  // Update sync token for a table
  private async updateSyncToken(tableName: string, token: string) {
    await database.write(async () => {
      const existing = await database.get('sync_status')
        .query(Q.where('table_name', tableName))
        .fetch();
      
      if (existing.length > 0) {
        await existing[0].update((record: any) => {
          record.lastSyncToken = token;
          record.lastSyncAt = Date.now();
        });
      } else {
        await database.get('sync_status').create((record: any) => {
          record.tableName = tableName;
          record.lastSyncToken = token;
          record.lastSyncAt = Date.now();
        });
      }
    });
  }
  
  // Update overall sync status
  private async updateSyncStatus() {
    const pendingCounts = await Promise.all(
      this.config.tables.map(async (tableName) => {
        const count = await database.get(tableName)
          .query(Q.where('is_pending_sync', true))
          .fetchCount();
        return { tableName, count };
      })
    );
    
    await database.write(async () => {
      for (const { tableName, count } of pendingCounts) {
        const existing = await database.get('sync_status')
          .query(Q.where('table_name', tableName))
          .fetch();
        
        if (existing.length > 0) {
          await existing[0].update((record: any) => {
            record.pendingChangesCount = count;
          });
        }
      }
    });
  }
  
  // Get pending changes count
  async getPendingCount(): Promise<number> {
    let total = 0;
    for (const tableName of this.config.tables) {
      total += await database.get(tableName)
        .query(Q.where('is_pending_sync', true))
        .fetchCount();
    }
    return total;
  }
}

interface SyncResult {
  success: boolean;
  reason?: string;
  pushed: number;
  pulled: number;
  errors: Error[];
}

export const syncEngine = new SyncEngine();
```

### 2.2 Backend Sync Endpoints

Add to `server/routers/syncRouter.ts`:

```typescript
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { db } from '../db';
import { eq, gt, and, inArray } from 'drizzle-orm';
import { wastePoints, routes, collectionPoints, zones, favorites } from '../schema';

const SYNC_TABLES = {
  waste_points: wastePoints,
  routes: routes,
  collection_points: collectionPoints,
  zones: zones,
  favorites: favorites,
};

export const syncRouter = router({
  // Pull changes from server
  pull: publicProcedure
    .input(z.object({
      table: z.enum(['waste_points', 'routes', 'collection_points', 'zones', 'favorites']),
      since: z.string().nullable(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const table = SYNC_TABLES[input.table];
      if (!table) throw new Error(`Unknown table: ${input.table}`);
      
      let query = db.select().from(table);
      
      if (input.since) {
        query = query.where(gt(table.updatedAt, new Date(input.since)));
      }
      
      const records = await query.limit(input.limit);
      
      const changes = records.map((record) => ({
        id: record.id,
        data: record,
        updatedAt: record.updatedAt.toISOString(),
      }));
      
      const nextToken = records.length > 0 
        ? records[records.length - 1].updatedAt.toISOString()
        : input.since;
      
      return { changes, nextToken };
    }),
  
  // Push changes to server
  push: publicProcedure
    .input(z.object({
      changes: z.array(z.object({
        id: z.string(),
        table: z.string(),
        action: z.enum(['create', 'update', 'delete']),
        data: z.record(z.any()),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      
      for (const change of input.changes) {
        const table = SYNC_TABLES[change.table as keyof typeof SYNC_TABLES];
        if (!table) continue;
        
        try {
          if (change.action === 'create') {
            await db.insert(table).values({
              ...change.data,
              id: change.id,
            });
          } else if (change.action === 'update') {
            await db.update(table)
              .set(change.data)
              .where(eq(table.id, change.id));
          } else if (change.action === 'delete') {
            await db.delete(table).where(eq(table.id, change.id));
          }
          
          results.push({ id: change.id, success: true });
        } catch (error) {
          results.push({ id: change.id, success: false, error: error.message });
        }
      }
      
      return { results };
    }),
  
  // Get sync status
  status: publicProcedure
    .query(async () => {
      const counts = await Promise.all(
        Object.entries(SYNC_TABLES).map(async ([name, table]) => {
          const count = await db.select({ count: sql`count(*)` }).from(table);
          return { table: name, count: count[0].count };
        })
      );
      
      return { tables: counts };
    }),
});
```

---

## Phase 3: Location-Based Sync (Week 5)

### 3.1 Nearby Bins Sync

Create `lib/database/sync/locationSync.ts`:

```typescript
import { database } from '../index';
import { Q } from '@nozbe/watermelondb';
import * as Location from 'expo-location';
import { trpc } from '../../trpc';

interface LocationSyncConfig {
  radiusKm: number;        // Sync radius around driver
  maxPoints: number;       // Max points to sync
  minSyncInterval: number; // Minimum time between syncs
}

const DEFAULT_CONFIG: LocationSyncConfig = {
  radiusKm: 10,
  maxPoints: 500,
  minSyncInterval: 300000, // 5 minutes
};

export class LocationSync {
  private config: LocationSyncConfig;
  private lastSyncLocation: { lat: number; lon: number } | null = null;
  private lastSyncTime: number = 0;
  
  constructor(config: Partial<LocationSyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // Sync nearby bins based on current location
  async syncNearbyBins(): Promise<void> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.warn('Location permission denied');
      return;
    }
    
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    
    const { latitude, longitude } = location.coords;
    
    // Check if we need to sync (moved significantly or time elapsed)
    if (this.shouldSkipSync(latitude, longitude)) {
      return;
    }
    
    // Fetch nearby bins from server
    const response = await trpc.spatial.nearbyWastePoints.query({
      lat: latitude,
      lon: longitude,
      radiusKm: this.config.radiusKm,
      limit: this.config.maxPoints,
    });
    
    // Update local database
    await database.write(async () => {
      for (const point of response.points) {
        const existing = await database.get('waste_points')
          .query(Q.where('external_id', point.id))
          .fetch();
        
        if (existing.length > 0) {
          await existing[0].update((record: any) => {
            record.latitude = point.lat;
            record.longitude = point.lon;
            record.type = point.type;
            record.condition = point.condition;
            record.address = point.address;
            record.syncedAt = Date.now();
          });
        } else {
          await database.get('waste_points').create((record: any) => {
            record.externalId = point.id;
            record.latitude = point.lat;
            record.longitude = point.lon;
            record.type = point.type;
            record.condition = point.condition;
            record.address = point.address;
            record.syncedAt = Date.now();
          });
        }
      }
    });
    
    this.lastSyncLocation = { lat: latitude, lon: longitude };
    this.lastSyncTime = Date.now();
  }
  
  // Check if we should skip sync
  private shouldSkipSync(lat: number, lon: number): boolean {
    // Time check
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    if (timeSinceLastSync < this.config.minSyncInterval) {
      return true;
    }
    
    // Distance check (if we have previous location)
    if (this.lastSyncLocation) {
      const distance = this.haversineDistance(
        this.lastSyncLocation.lat,
        this.lastSyncLocation.lon,
        lat,
        lon
      );
      
      // Only sync if moved more than half the radius
      if (distance < this.config.radiusKm * 0.5) {
        return true;
      }
    }
    
    return false;
  }
  
  // Haversine distance calculation
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  
  // Get nearby bins from local database
  async getLocalNearbyBins(lat: number, lon: number, radiusKm: number): Promise<any[]> {
    // Get all points and filter by distance (WatermelonDB doesn't support spatial queries)
    const allPoints = await database.get('waste_points').fetch();
    
    return allPoints.filter((point) => {
      const distance = this.haversineDistance(
        lat, lon,
        point.latitude, point.longitude
      );
      return distance <= radiusKm;
    });
  }
}

export const locationSync = new LocationSync();
```

---

## Phase 4: UI Integration (Week 6)

### 4.1 Sync Status Component

Create `components/SyncStatusIndicator.tsx`:

```typescript
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useObservable } from '@nozbe/with-observables';
import { syncEngine } from '../lib/database/sync/syncEngine';
import { NetInfo } from '@react-native-community/netinfo';

export function SyncStatusIndicator() {
  const [isOnline, setIsOnline] = React.useState(true);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [isSyncing, setIsSyncing] = React.useState(false);
  
  React.useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected && state.isInternetReachable);
    });
    
    const interval = setInterval(async () => {
      setPendingCount(await syncEngine.getPendingCount());
    }, 5000);
    
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);
  
  const handleSync = async () => {
    setIsSyncing(true);
    await syncEngine.attemptSync();
    setIsSyncing(false);
    setPendingCount(await syncEngine.getPendingCount());
  };
  
  return (
    <View style={styles.container}>
      {!isOnline && (
        <View style={styles.offlineBadge}>
          <Text style={styles.offlineText}>Offline</Text>
        </View>
      )}
      
      {pendingCount > 0 && (
        <TouchableOpacity 
          style={styles.syncButton} 
          onPress={handleSync}
          disabled={isSyncing || !isOnline}
        >
          <Text style={styles.syncText}>
            {isSyncing ? 'Syncing...' : `${pendingCount} pending`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offlineBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  offlineText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  syncButton: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  syncText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});
```

### 4.2 Offline-Aware Collection Screen

Update collection navigation to work offline:

```typescript
// hooks/useOfflineCollection.ts
import { useObservable } from '@nozbe/with-observables';
import { database, CollectionPoint, Route } from '../lib/database';
import { Q } from '@nozbe/watermelondb';

export function useOfflineCollection(routeId: string) {
  const route = useObservable(
    database.get('routes').findAndObserve(routeId)
  );
  
  const collectionPoints = useObservable(
    database.get('collection_points')
      .query(Q.where('route_id', routeId), Q.sortBy('sequence'))
      .observeWithColumns(['status'])
  );
  
  const markPointCompleted = async (pointId: string, photoUri?: string, notes?: string) => {
    const point = await database.get('collection_points').find(pointId);
    await point.markCompleted(photoUri, notes);
  };
  
  const markPointSkipped = async (pointId: string, reason: string) => {
    const point = await database.get('collection_points').find(pointId);
    await point.markSkipped(reason);
  };
  
  const reportIssue = async (pointId: string, notes: string, photoUri?: string) => {
    const point = await database.get('collection_points').find(pointId);
    await point.reportIssue(notes, photoUri);
  };
  
  return {
    route,
    collectionPoints,
    markPointCompleted,
    markPointSkipped,
    reportIssue,
    pendingSyncCount: collectionPoints.filter(p => p.isPendingSync).length,
  };
}
```

---

## Phase 5: Migration & Testing (Week 7-8)

### 5.1 Migration from AsyncStorage

Create `lib/database/migrations/migrateFromAsyncStorage.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { database } from '../index';

export async function migrateFromAsyncStorage(): Promise<void> {
  console.log('Starting migration from AsyncStorage...');
  
  // Migrate routes
  const routesJson = await AsyncStorage.getItem('routes');
  if (routesJson) {
    const routes = JSON.parse(routesJson);
    await database.write(async () => {
      for (const route of routes) {
        await database.get('routes').create((record: any) => {
          record.externalId = route.id;
          record.date = route.date;
          record.status = route.status;
          record.totalPoints = route.points?.length || 0;
          record.completedPoints = route.completedPoints || 0;
          record.routeSource = route.routeSource || 'manual';
          record.isPendingSync = false;
        });
      }
    });
    console.log(`Migrated ${routes.length} routes`);
  }
  
  // Migrate favorites
  const favoritesJson = await AsyncStorage.getItem('favorites');
  if (favoritesJson) {
    const favorites = JSON.parse(favoritesJson);
    await database.write(async () => {
      for (const fav of favorites) {
        await database.get('favorites').create((record: any) => {
          record.externalId = fav.id;
          record.name = fav.name;
          record.latitude = fav.latitude;
          record.longitude = fav.longitude;
          record.category = fav.category || 'waypoint';
          record.notes = fav.notes;
          record.isPendingSync = false;
        });
      }
    });
    console.log(`Migrated ${favorites.length} favorites`);
  }
  
  // Migrate waste points from store
  const wastePointsJson = await AsyncStorage.getItem('waste-points-store');
  if (wastePointsJson) {
    const store = JSON.parse(wastePointsJson);
    const points = store.state?.points || [];
    await database.write(async () => {
      for (const point of points) {
        await database.get('waste_points').create((record: any) => {
          record.externalId = point.id;
          record.latitude = point.lat;
          record.longitude = point.lon;
          record.type = point.type;
          record.condition = point.condition;
          record.address = point.address;
          record.isPendingSync = false;
        });
      }
    });
    console.log(`Migrated ${points.length} waste points`);
  }
  
  console.log('Migration complete!');
}
```

### 5.2 Test Plan

| Test Case | Description | Expected Result |
|-----------|-------------|-----------------|
| Offline Create | Create route while offline | Saved locally, marked pending |
| Offline Update | Complete collection point offline | Updated locally, marked pending |
| Auto Sync | Connection restored | Pending changes pushed automatically |
| Conflict Resolution | Same record edited on two devices | Server wins, local updated |
| Location Sync | Move 5km from last sync | New nearby bins downloaded |
| Large Dataset | 1000+ collection points | Pagination works, no memory issues |
| Background Sync | App in background | Sync continues (with OS limits) |
| Migration | Existing AsyncStorage data | All data migrated successfully |

---

## Implementation Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1-2 | Foundation | Schema, models, database setup |
| 3-4 | Sync Engine | Push/pull sync, conflict resolution |
| 5 | Location Sync | Nearby bins sync based on GPS |
| 6 | UI Integration | Sync status, offline-aware screens |
| 7 | Migration | AsyncStorage → WatermelonDB migration |
| 8 | Testing | Unit tests, integration tests, field testing |

---

## Benefits for Rural Drivers

1. **Full productivity offline** - Complete routes without cell service
2. **Automatic sync** - Changes sync when connectivity returns
3. **Location-aware** - Only syncs relevant nearby data
4. **Fast local queries** - SQLite performance for large datasets
5. **Conflict handling** - No data loss from sync conflicts
6. **Seamless UX** - No difference between online/offline operation

---

## Files to Create

```
lib/database/
├── index.ts                    # Database instance
├── schema.ts                   # WatermelonDB schema
├── models/
│   ├── WastePoint.ts
│   ├── Route.ts
│   ├── CollectionPoint.ts
│   ├── Zone.ts
│   ├── Favorite.ts
│   └── SyncStatus.ts
├── sync/
│   ├── syncEngine.ts           # Main sync logic
│   ├── locationSync.ts         # Location-based sync
│   └── conflictResolver.ts     # Conflict resolution
└── migrations/
    ├── index.ts
    └── migrateFromAsyncStorage.ts

components/
├── SyncStatusIndicator.tsx
└── OfflineNotice.tsx

hooks/
├── useOfflineCollection.ts
├── useSyncStatus.ts
└── useNearbyBins.ts

server/routers/
└── syncRouter.ts               # Backend sync endpoints
```
