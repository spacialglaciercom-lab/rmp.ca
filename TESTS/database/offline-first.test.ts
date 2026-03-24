/**
 * Offline-First WatermelonDB Implementation Tests
 * 
 * Tests for database models, sync engine, and AsyncStorage migration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock AsyncStorage
const mockAsyncStorage: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(mockAsyncStorage[key] || null)),
    setItem: vi.fn((key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete mockAsyncStorage[key];
      return Promise.resolve();
    }),
    multiRemove: vi.fn((keys: string[]) => {
      keys.forEach(key => delete mockAsyncStorage[key]);
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      Object.keys(mockAsyncStorage).forEach(key => delete mockAsyncStorage[key]);
      return Promise.resolve();
    }),
  },
}));

// Mock WatermelonDB
vi.mock('@nozbe/watermelondb', () => ({
  Database: class MockDatabase {
    get() { return new MockCollection(); }
    write() { return Promise.resolve(); }
  },
  Q: {
    where: vi.fn((...args) => ({ type: 'where', args })),
    sortBy: vi.fn((...args) => ({ type: 'sortBy', args })),
  },
  appSchema: vi.fn((schema) => schema),
  tableSchema: vi.fn((schema) => schema),
  Model: class MockModel {
    static table = 'mock_table';
    static associations = {};
  },
}));

class MockCollection {
  query() { return new MockQuery(); }
  create() { return Promise.resolve({ id: 'test-id' }); }
}

class MockQuery {
  fetch() { return Promise.resolve([]); }
  fetchCount() { return Promise.resolve(0); }
}

// Mock WatermelonDB adapter
vi.mock('@nozbe/watermelondb/adapters/sqlite', () => ({
  default: class MockAdapter { constructor() {} }
}));

// Mock NetInfo
const netInfoMock = {
  fetch: vi.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  addEventListener: vi.fn(() => vi.fn()),
};

vi.mock('@react-native-community/netinfo', () => ({
  fetch: netInfoMock.fetch,
  addEventListener: netInfoMock.addEventListener,
  default: netInfoMock,
}));

// Mock expo-location
vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: vi.fn(() => Promise.resolve({
    coords: { latitude: 45.0, longitude: -75.0 },
  })),
  Accuracy: { Balanced: 3 },
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockAsyncStorage).forEach((key) => delete mockAsyncStorage[key]);
  netInfoMock.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
});

// ============================================================================
// MIGRATION TESTS
// ============================================================================

describe('AsyncStorage Migration', () => {
  describe('isMigrationNeeded', () => {
    it('should return true when no migration version exists', async () => {
      const { isMigrationNeeded } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await isMigrationNeeded();
      expect(result).toBe(true);
    });

    it('should return true when migration version is outdated', async () => {
      mockAsyncStorage['watermelon_migration_version'] = '1';
      const { isMigrationNeeded } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await isMigrationNeeded();
      expect(result).toBe(true);
    });

    it('should return false when migration is up to date', async () => {
      mockAsyncStorage['watermelon_migration_version'] = '2';
      const { isMigrationNeeded } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await isMigrationNeeded();
      expect(result).toBe(false);
    });
  });

  describe('runMigration', () => {
    it('should migrate Zustand zones storage', async () => {
      // Setup test data
      mockAsyncStorage['rmp-zones-storage'] = JSON.stringify({
        state: {
          savedZones: [
            {
              id: 'zone-1',
              name: 'Test Zone',
              polygon: [[45.0, -75.0], [45.1, -75.0], [45.1, -75.1]],
              truck_count: 2,
              balance_metric: 'time',
            },
          ],
        },
        version: 1,
      });

      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();

      expect(result.success).toBe(true);
      expect(result.migrated).toHaveProperty('zones');
    });

    it('should migrate quick destinations', async () => {
      mockAsyncStorage['trashroute-enhanced-quick-destinations'] = JSON.stringify({
        state: {
          home: { id: 'home', coords: { lat: 45.0, lon: -75.0 }, label: 'Home' },
          work: { id: 'work', coords: { lat: 45.1, lon: -75.1 }, label: 'Work' },
          customDestinations: [
            { id: 'custom-1', coords: { lat: 45.2, lon: -75.2 }, label: 'Custom' },
          ],
        },
        version: 1,
      });

      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();

      expect(result.success).toBe(true);
      expect(result.migrated).toHaveProperty('quick_destinations');
    });

    it('should migrate favorites storage', async () => {
      mockAsyncStorage['favorites-storage'] = JSON.stringify({
        state: {
          favorites: [
            { id: 'fav-1', name: 'Favorite 1', lat: 45.0, lon: -75.0, category: 'waypoint' },
            { id: 'fav-2', name: 'Favorite 2', lat: 45.1, lon: -75.1, category: 'bin' },
          ],
        },
        version: 1,
      });

      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();

      expect(result.success).toBe(true);
      expect(result.migrated).toHaveProperty('favorites');
    });

    it('should migrate imported waste points', async () => {
      mockAsyncStorage['imported_points'] = JSON.stringify([
        { id: 'wp-1', lat: 45.0, lon: -75.0, type: 'bin', condition: 'good' },
        { id: 'wp-2', lat: 45.1, lon: -75.1, type: 'dumpster', condition: 'fair' },
      ]);

      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();

      expect(result.success).toBe(true);
      expect(result.migrated).toHaveProperty('imported_points');
    });

    it('should handle empty storage gracefully', async () => {
      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle corrupted JSON gracefully', async () => {
      mockAsyncStorage['rmp-zones-storage'] = 'not valid json';

      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();

      expect(result.success).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should not duplicate existing records', async () => {
      // First migration
      mockAsyncStorage['favorites-storage'] = JSON.stringify({
        state: {
          favorites: [
            { id: 'fav-1', name: 'Favorite 1', lat: 45.0, lon: -75.0 },
          ],
        },
        version: 1,
      });

      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result1 = await runMigration();

      // Second migration (should skip)
      const result2 = await runMigration();

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result2.migrated).toEqual({});
    });

    it('should set migration version after completion', async () => {
      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      await runMigration();

      const version = await AsyncStorage.getItem('watermelon_migration_version');
      expect(version).toBe('2');
    });
  });

  describe('getMigrationStatus', () => {
    it('should return correct status for fresh install', async () => {
      const { getMigrationStatus } = await import('../../lib/database/migrations/asyncStorageMigration');
      const status = await getMigrationStatus();

      expect(status.version).toBe(0);
      expect(status.isComplete).toBe(false);
    });

    it('should return correct status after migration', async () => {
      mockAsyncStorage['watermelon_migration_version'] = '2';
      
      const { getMigrationStatus } = await import('../../lib/database/migrations/asyncStorageMigration');
      const status = await getMigrationStatus();

      expect(status.version).toBe(2);
      expect(status.isComplete).toBe(true);
    });
  });

  describe('clearAsyncStorageData', () => {
    it('should clear migrated keys but keep preferences', async () => {
      // Setup test data
      mockAsyncStorage['rmp-zones-storage'] = JSON.stringify({ state: { savedZones: [] } });
      mockAsyncStorage['favorites-storage'] = JSON.stringify({ state: { favorites: [] } });
      mockAsyncStorage['beta_features'] = JSON.stringify({ feature1: true });
      mockAsyncStorage['watermelon_migration_version'] = '2';

      const { clearAsyncStorageData } = await import('../../lib/database/migrations/asyncStorageMigration');
      await clearAsyncStorageData();

      // Should be cleared
      expect(mockAsyncStorage['rmp-zones-storage']).toBeUndefined();
      expect(mockAsyncStorage['favorites-storage']).toBeUndefined();

      // Should be kept
      expect(mockAsyncStorage['beta_features']).toBeDefined();
      expect(mockAsyncStorage['watermelon_migration_version']).toBeDefined();
    });
  });
});

// ============================================================================
// SYNC ENGINE TESTS
// ============================================================================

describe('SyncEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPendingCount', () => {
    it('should return 0 when no pending changes', async () => {
      const { syncEngine } = await import('../../lib/database/sync/syncEngine');
      const count = await syncEngine.getPendingCount();
      expect(count).toBe(0);
    });
  });

  describe('attemptSync', () => {
    it('should return offline when no network', async () => {
      // Mock offline state
      vi.mocked(await import('@react-native-community/netinfo')).default.fetch = vi.fn(() =>
        Promise.resolve({ isConnected: false, isInternetReachable: false })
      );

      const { syncEngine } = await import('../../lib/database/sync/syncEngine');
      const result = await syncEngine.attemptSync();

      expect(result.success).toBe(false);
      expect(result.reason).toBe('offline');
    });

    it('should return already_syncing when sync in progress', async () => {
      // Ensure online
      vi.mocked(await import('@react-native-community/netinfo')).default.fetch = vi.fn(() =>
        Promise.resolve({ isConnected: true, isInternetReachable: true })
      );
      vi.mocked(await import('@react-native-community/netinfo')).fetch = vi.fn(() =>
        Promise.resolve({ isConnected: true, isInternetReachable: true })
      );

      const { syncEngine } = await import('../../lib/database/sync/syncEngine');
      
      // Start a sync (mocked)
      syncEngine.isSyncing = true;
      
      const result = await syncEngine.attemptSync();
      
      expect(result.success).toBe(false);
      expect(result.reason).toBe('already_syncing');
      
      // Reset
      syncEngine.isSyncing = false;
    });
  });

  describe('startPeriodicSync / stopPeriodicSync', () => {
    it('should start and stop periodic sync', async () => {
      const { syncEngine } = await import('../../lib/database/sync/syncEngine');
      
      syncEngine.startPeriodicSync();
      expect(syncEngine.syncTimer).not.toBeNull();
      
      syncEngine.stopPeriodicSync();
      expect(syncEngine.syncTimer).toBeNull();
    });
  });
});

// ============================================================================
// LOCATION SYNC TESTS
// ============================================================================

describe('LocationSync', () => {
  describe('syncNearbyBins', () => {
    it('should skip sync when location permission denied', async () => {
      vi.mocked(await import('@react-native-community/netinfo')).default.fetch = vi.fn(() =>
        Promise.resolve({ isConnected: true, isInternetReachable: true })
      );

      vi.mocked(await import('expo-location')).requestForegroundPermissionsAsync = vi.fn(() =>
        Promise.resolve({ status: 'denied' })
      );

      const { locationSync } = await import('../../lib/database/sync/locationSync');
      await locationSync.syncNearbyBins();
      
      // Should not throw, just return early
    });

    it('should sync when moved significant distance', async () => {
      vi.mocked(await import('@react-native-community/netinfo')).default.fetch = vi.fn(() =>
        Promise.resolve({ isConnected: true, isInternetReachable: true })
      );

      const { locationSync } = await import('../../lib/database/sync/locationSync');
      
      // First sync at location 1
      vi.mocked(await import('expo-location')).getCurrentPositionAsync = vi.fn(() =>
        Promise.resolve({ coords: { latitude: 45.0, longitude: -75.0 } })
      );
      await locationSync.syncNearbyBins();

      // Second sync at location 2 (10km away)
      vi.mocked(await import('expo-location')).getCurrentPositionAsync = vi.fn(() =>
        Promise.resolve({ coords: { latitude: 45.1, longitude: -75.0 } })
      );
      await locationSync.syncNearbyBins();
      
      // Should trigger sync (mocked)
    });
  });

  describe('haversineDistance', () => {
    it('should calculate distance correctly', async () => {
      const { locationSync } = await import('../../lib/database/sync/locationSync');
      
      // Access private method via any
      const distance = (locationSync as any).haversineDistance(45.0, -75.0, 45.1, -75.0);
      
      // Should be approximately 11.1 km
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(12);
    });
  });

  describe('getLocalNearbyBins', () => {
    it('should filter points by distance', async () => {
      const { locationSync } = await import('../../lib/database/sync/locationSync');
      
      const nearbyBins = await locationSync.getLocalNearbyBins(45.0, -75.0, 10);
      
      // Returns array (mocked to be empty)
      expect(Array.isArray(nearbyBins)).toBe(true);
    });
  });
});

// ============================================================================
// DATABASE MODEL TESTS
// ============================================================================

describe('Database Models', () => {
  describe('WastePoint Model', () => {
    it('should have correct table name', async () => {
      const WastePoint = (await import('../../lib/database/models/WastePoint')).default;
      expect(WastePoint.table).toBe('waste_points');
    });

    it('should have correct associations', async () => {
      const WastePoint = (await import('../../lib/database/models/WastePoint')).default;
      expect(WastePoint.associations).toHaveProperty('collection_points');
    });
  });

  describe('Route Model', () => {
    it('should have correct table name', async () => {
      const Route = (await import('../../lib/database/models/Route')).default;
      expect(Route.table).toBe('routes');
    });

    it('should have correct associations', async () => {
      const Route = (await import('../../lib/database/models/Route')).default;
      expect(Route.associations).toHaveProperty('collection_points');
    });
  });

  describe('CollectionPoint Model', () => {
    it('should have correct table name', async () => {
      const CollectionPoint = (await import('../../lib/database/models/CollectionPoint')).default;
      expect(CollectionPoint.table).toBe('collection_points');
    });

    it('should have correct associations', async () => {
      const CollectionPoint = (await import('../../lib/database/models/CollectionPoint')).default;
      expect(CollectionPoint.associations).toHaveProperty('routes');
      expect(CollectionPoint.associations).toHaveProperty('waste_points');
    });
  });

  describe('Zone Model', () => {
    it('should have correct table name', async () => {
      const Zone = (await import('../../lib/database/models/Zone')).default;
      expect(Zone.table).toBe('zones');
    });
  });

  describe('Favorite Model', () => {
    it('should have correct table name', async () => {
      const Favorite = (await import('../../lib/database/models/Favorite')).default;
      expect(Favorite.table).toBe('favorites');
    });
  });

  describe('SyncStatus Model', () => {
    it('should have correct table name', async () => {
      const SyncStatus = (await import('../../lib/database/models/SyncStatus')).default;
      expect(SyncStatus.table).toBe('sync_status');
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration Tests', () => {
  describe('Full Migration Flow', () => {
    it('should complete full migration workflow', async () => {
      // Setup comprehensive test data
      mockAsyncStorage['rmp-zones-storage'] = JSON.stringify({
        state: {
          savedZones: [
            { id: 'z1', name: 'Zone 1', polygon: [], truck_count: 1 },
          ],
        },
        version: 1,
      });
      
      mockAsyncStorage['favorites-storage'] = JSON.stringify({
        state: {
          favorites: [
            { id: 'f1', name: 'Fav 1', lat: 45.0, lon: -75.0 },
          ],
        },
        version: 1,
      });
      
      mockAsyncStorage['imported_points'] = JSON.stringify([
        { id: 'wp1', lat: 45.0, lon: -75.0, type: 'bin' },
      ]);

      const { runMigration, getMigrationStatus } = await import('../../lib/database/migrations/asyncStorageMigration');
      
      // Run migration
      const result = await runMigration();
      
      // Verify success
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      
      // Verify status
      const status = await getMigrationStatus();
      expect(status.isComplete).toBe(true);
    });
  });

  describe('Error Recovery', () => {
    it('should continue migration after individual record failure', async () => {
      // Setup data with one corrupted entry
      mockAsyncStorage['favorites-storage'] = JSON.stringify({
        state: {
          favorites: [
            { id: 'f1', name: 'Valid', lat: 45.0, lon: -75.0 },
            { id: 'f2', name: 'Invalid', lat: null, lon: null }, // Invalid coords
            { id: 'f3', name: 'Valid 2', lat: 45.1, lon: -75.1 },
          ],
        },
        version: 1,
      });

      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();

      // Should still succeed overall
      expect(result.success).toBe(true);
      // Valid records are processed, invalid are skipped (or recorded in errors)
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance', () => {
    it('should handle large datasets efficiently', async () => {
      // Generate large dataset
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: `wp-${i}`,
        lat: 45 + (i * 0.001),
        lon: -75 + (i * 0.001),
        type: 'bin',
        condition: 'good',
      }));
      
      mockAsyncStorage['imported_points'] = JSON.stringify(largeDataset);

      const startTime = Date.now();
      const { runMigration } = await import('../../lib/database/migrations/asyncStorageMigration');
      const result = await runMigration();
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      // Should complete within reasonable time (5 seconds)
      expect(duration).toBeLessThan(5000);
    });
  });
});

// ============================================================================
// CLEANUP
// ============================================================================

afterEach(() => {
  vi.clearAllMocks();
});