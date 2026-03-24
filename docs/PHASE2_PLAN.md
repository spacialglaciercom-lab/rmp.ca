# Phase 2: Integration & Backend Implementation

## Overview

Phase 1 (Foundation) is complete with:
- ✅ Database schema and models
- ✅ Sync engine (push/pull)
- ✅ Location-based sync
- ✅ Conflict resolver
- ✅ UI components (SyncStatusIndicator, OfflineNotice)
- ✅ Backend sync router (stub)
- ✅ Migration utilities
- ✅ React hooks and DatabaseProvider

Phase 2 focuses on **integration** and **real backend implementation**.

---

## 2.1 App Layout Integration (Priority: High)

### Task: Integrate DatabaseProvider into Root Layout

**File:** `app/_layout.tsx`

Wrap the app with `DatabaseProvider` to initialize WatermelonDB on startup:

```typescript
import { DatabaseProvider } from '@/lib/database/DatabaseProvider';

// In RootLayout component, wrap existing providers:
<DatabaseProvider>
  <FirebaseProvider>
    {/* ... existing providers ... */}
  </FirebaseProvider>
</DatabaseProvider>
```

**Implementation Steps:**
1. Import DatabaseProvider
2. Add to provider hierarchy (outermost or near outermost)
3. Handle initialization state (show loading during DB setup)
4. Run AsyncStorage migration on first launch

---

## 2.2 Sync Status UI Integration (Priority: High)

### Task: Add SyncStatusIndicator to Header

**Files to modify:**
- `app/(tabs)/_layout.tsx` - Tab navigation header
- `app/(tabs)/index.tsx` - Home screen
- `components/HeaderWeather.tsx` - Existing header component

**Implementation:**
```typescript
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator';
import { OfflineNotice } from '@/components/OfflineNotice';

// In header component:
<View style={styles.headerRight}>
  <SyncStatusIndicator />
  {/* existing header content */}
</View>

// Above main content:
<OfflineNotice />
```

---

## 2.3 Backend Sync Endpoints (Priority: High)

### Task: Implement Real Drizzle ORM Queries

**File:** `server/syncRouter.ts`

Replace TODO stubs with actual database operations:

#### 2.3.1 Pull Endpoint
```typescript
pull: protectedProcedure
  .input(PullRequestSchema)
  .query(async ({ ctx, input }) => {
    const { table, since, limit } = input;
    const userId = ctx.user.id;
    
    // Map table names to Drizzle schemas
    const tableMap = {
      waste_points: dbWastePoints,
      routes: dbRoutes,
      collection_points: dbCollectionPoints,
      zones: dbZones,
      favorites: dbFavorites,
    };
    
    const drizzleTable = tableMap[table as keyof typeof tableMap];
    if (!drizzleTable) throw new TRPCError({ code: 'BAD_REQUEST' });
    
    // Query changes since last sync
    let query = db.select()
      .from(drizzleTable)
      .where(eq(drizzleTable.userId, userId))
      .limit(limit);
    
    if (since) {
      query = query.where(gt(drizzleTable.updatedAt, new Date(since)));
    }
    
    const records = await query;
    
    return {
      changes: records.map(r => ({ id: r.id, data: r })),
      nextToken: records.length > 0 
        ? records[records.length - 1].updatedAt.toISOString() 
        : since,
    };
  }),
```

#### 2.3.2 Push Endpoint
```typescript
push: protectedProcedure
  .input(PushRequestSchema)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const results = [];
    
    for (const change of input.changes) {
      try {
        switch (change.action) {
          case 'create':
            await db.insert(tableMap[change.table])
              .values({ ...change.data, userId, id: change.id });
            break;
          case 'update':
            await db.update(tableMap[change.table])
              .set(change.data)
              .where(and(
                eq(tableMap[change.table].id, change.id),
                eq(tableMap[change.table].userId, userId)
              ));
            break;
          case 'delete':
            await db.delete(tableMap[change.table])
              .where(and(
                eq(tableMap[change.table].id, change.id),
                eq(tableMap[change.table].userId, userId)
              ));
            break;
        }
        results.push({ id: change.id, success: true });
      } catch (error) {
        results.push({ id: change.id, success: false, error: String(error) });
      }
    }
    
    return { results };
  }),
```

#### 2.3.3 Nearby Waste Points Endpoint
```typescript
nearbyWastePoints: protectedProcedure
  .input(NearbyRequestSchema)
  .query(async ({ ctx, input }) => {
    const { lat, lon, radiusKm, limit } = input;
    const userId = ctx.user.id;
    
    // Use PostGIS for spatial query
    const points = await db.select()
      .from(dbWastePoints)
      .where(and(
        eq(dbWastePoints.userId, userId),
        sql`ST_DWithin(
          ST_MakePoint(longitude, latitude)::geography,
          ST_MakePoint(${lon}, ${lat})::geography,
          ${radiusKm * 1000}
        )`
      ))
      .limit(limit);
    
    return { points };
  }),
```

---

## 2.4 Background Sync Scheduling (Priority: Medium)

### Task: Implement Background Sync with Expo TaskManager

**File:** `lib/database/sync/backgroundSync.ts`

```typescript
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { syncEngine } from './syncEngine';

const BACKGROUND_SYNC_TASK = 'background-sync';

// Define the background task
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const result = await syncEngine.attemptSync();
    return result.success 
      ? BackgroundFetch.BackgroundFetchResult.NewData 
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Register background sync
export async function registerBackgroundSync() {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Available) {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60, // 15 minutes
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
}

export async function unregisterBackgroundSync() {
  await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
}
```

---

## 2.5 Offline-Aware Screen Updates (Priority: Medium)

### Task: Update Existing Screens to Use Local Database

#### 2.5.1 Collection Navigation Screen
**File:** `components/NavigationView.tsx`

- Replace API calls with local database queries
- Use `useObserveTable` for reactive updates
- Queue changes for sync when offline

#### 2.5.2 Route Planning Screen
**File:** `components/planner-content.tsx`

- Cache routes locally
- Allow offline route creation
- Sync when connectivity returns

#### 2.5.3 Favorites Management
**File:** `stores/favorites.ts` (or equivalent)

- Migrate from Zustand/AsyncStorage to WatermelonDB
- Use WatermelonDB observers for reactive UI

---

## 2.6 Migration Execution (Priority: Medium)

### Task: Run Migration on App Launch

**File:** `lib/database/migrations/asyncStorageMigration.ts`

Update to handle production data:

```typescript
export async function runMigrationIfNeeded(): Promise<MigrationResult> {
  const migrationStatus = await getMigrationStatus();
  
  if (migrationStatus.completed) {
    return { skipped: true, reason: 'already_migrated' };
  }
  
  console.log('Starting AsyncStorage migration...');
  
  try {
    // Migrate each data type
    const routesCount = await migrateRoutes();
    const favoritesCount = await migrateFavorites();
    const wastePointsCount = await migrateWastePoints();
    
    // Mark migration complete
    await AsyncStorage.setItem(MIGRATION_COMPLETE_KEY, 'true');
    
    return {
      success: true,
      migrated: { routes: routesCount, favorites: favoritesCount, wastePoints: wastePointsCount },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
```

---

## 2.7 Testing Strategy (Priority: High)

### Unit Tests

**File:** `TESTS/lib/database/sync.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { database } from '@/lib/database';
import { syncEngine } from '@/lib/database/sync/syncEngine';

describe('SyncEngine', () => {
  beforeEach(async () => {
    // Reset database state
    await database.write(async () => {
      const tables = ['waste_points', 'routes', 'collection_points'];
      for (const table of tables) {
        const records = await database.get(table).query().fetch();
        for (const record of records) {
          await record.destroyPermanently();
        }
      }
    });
  });

  it('should mark records as pending sync on create', async () => {
    await database.write(async () => {
      await database.get('waste_points').create((record: any) => {
        record.externalId = 'test-1';
        record.latitude = 45.0;
        record.longitude = -75.0;
        record.type = 'bin';
        record.isPendingSync = true;
      });
    });

    const pending = await database.get('waste_points')
      .query(Q.where('is_pending_sync', true))
      .fetch();
    
    expect(pending.length).toBe(1);
  });

  it('should handle offline sync gracefully', async () => {
    // Mock offline state
    jest.spyOn(NetInfo, 'fetch').mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    } as any);

    const result = await syncEngine.attemptSync();
    
    expect(result.success).toBe(false);
    expect(result.reason).toBe('offline');
  });
});
```

### Integration Tests

1. **Offline Create → Online Sync**
   - Create record offline
   - Verify pending sync flag
   - Simulate network restoration
   - Verify sync completes

2. **Conflict Resolution**
   - Create conflict scenario
   - Verify resolution strategy applied
   - Verify no data loss

3. **Location-Based Sync**
   - Mock GPS position
   - Verify nearby bins fetched
   - Verify local database updated

---

## Implementation Timeline

| Week | Tasks | Deliverables |
|------|-------|--------------|
| 1 | 2.1, 2.2 | DatabaseProvider integrated, SyncStatus in UI |
| 2 | 2.3 | Backend sync endpoints with Drizzle ORM |
| 3 | 2.4, 2.5 | Background sync, offline-aware screens |
| 4 | 2.6, 2.7 | Migration execution, testing |

---

## Files to Create/Modify

### New Files
```
lib/database/sync/backgroundSync.ts     # Background sync task
TESTS/lib/database/sync.test.ts         # Sync unit tests
TESTS/lib/database/models.test.ts      # Model tests
```

### Files to Modify
```
app/_layout.tsx                        # Add DatabaseProvider
app/(tabs)/_layout.tsx                 # Add SyncStatusIndicator
components/HeaderWeather.tsx           # Add sync status
components/NavigationView.tsx          # Offline-aware updates
server/syncRouter.ts                   # Real Drizzle queries
lib/database/migrations/asyncStorageMigration.ts  # Production migration
```

---

## Success Criteria

1. ✅ App initializes WatermelonDB on launch
2. ✅ Sync status visible in UI at all times
3. ✅ Backend endpoints return real data from PostgreSQL
4. ✅ Background sync runs every 15+ minutes
5. ✅ Users can work fully offline
6. ✅ Changes sync automatically when online
7. ✅ Migration from AsyncStorage works without data loss
8. ✅ All tests pass

---

## Dependencies

- Phase 1 implementation (complete)
- Drizzle ORM schema for PostgreSQL
- PostGIS extension for spatial queries
- Expo TaskManager and BackgroundFetch

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Migration data loss | Backup AsyncStorage before migration, rollback capability |
| Background sync battery drain | Use minimum interval, respect power saving mode |
| Sync conflicts | Clear conflict resolution UI, manual resolution option |
| Large dataset performance | Pagination, lazy loading, query optimization |
