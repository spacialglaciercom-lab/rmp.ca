/**
 * Sync Engine for WatermelonDB
 * 
 * Handles bidirectional sync between local SQLite and remote server.
 * Supports offline-first operation with automatic sync when online.
 */
import { database } from '../index';
import { Q } from '@nozbe/watermelondb';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

// Sync configuration
interface SyncConfig {
  tables: string[];
  batchSize: number;
  maxRetries: number;
  syncInterval: number; // ms
  minSyncInterval: number; // ms between syncs
}

const DEFAULT_CONFIG: SyncConfig = {
  tables: ['waste_points', 'routes', 'collection_points', 'zones', 'favorites'],
  batchSize: 100,
  maxRetries: 3,
  syncInterval: 60000, // 1 minute
  minSyncInterval: 10000, // 10 seconds minimum between syncs
};

// Sync result interface
export interface SyncResult {
  success: boolean;
  reason?: string;
  pushed: number;
  pulled: number;
  errors: Error[];
}

// Sync status callback type
export type SyncStatusCallback = (status: {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  error: string | null;
}) => void;

/**
 * Sync Engine Class
 */
export class SyncEngine {
  private config: SyncConfig;
  private isSyncing: boolean = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime: number = 0;
  private statusCallbacks: Set<SyncStatusCallback> = new Set();
  private netInfoUnsubscribe: (() => void) | null = null;

  constructor(config: Partial<SyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Subscribe to sync status changes
   */
  subscribe(callback: SyncStatusCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * Notify all subscribers of status change
   */
  private async notifyStatus(error: string | null = null) {
    const pendingCount = await this.getPendingCount();
    const status = {
      isSyncing: this.isSyncing,
      pendingCount,
      lastSyncTime: this.lastSyncTime || null,
      error,
    };
    this.statusCallbacks.forEach(cb => cb(status));
  }

  /**
   * Start periodic sync
   * Idempotent - safe to call multiple times
   */
  startPeriodicSync(): void {
    // Guard against duplicate timers/listeners
    if (this.syncTimer) {
      console.log('[SyncEngine] startPeriodicSync: already running, skipping');
      return;
    }

    // Initial sync attempt
    this.attemptSync();

    // Set up periodic sync timer
    this.syncTimer = setInterval(() => {
      this.attemptSync();
    }, this.config.syncInterval) as unknown as NodeJS.Timeout;

    // Listen for network changes
    this.netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected && state.isInternetReachable) {
        this.attemptSync();
      }
    });
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
  }

  /**
   * Attempt sync if conditions are met
   */
  async attemptSync(): Promise<SyncResult> {
    const netInfo = await NetInfo.fetch();

    if (!netInfo.isConnected || !netInfo.isInternetReachable) {
      return { success: false, reason: 'offline', pushed: 0, pulled: 0, errors: [] };
    }

    if (this.isSyncing) {
      return { success: false, reason: 'already_syncing', pushed: 0, pulled: 0, errors: [] };
    }

    // Check minimum sync interval
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    if (timeSinceLastSync < this.config.minSyncInterval) {
      return { success: false, reason: 'too_soon', pushed: 0, pulled: 0, errors: [] };
    }

    return this.sync();
  }

  /**
   * Main sync method - push local changes, pull remote changes
   */
  async sync(): Promise<SyncResult> {
    this.isSyncing = true;
    await this.notifyStatus();

    const result: SyncResult = {
      success: true,
      pushed: 0,
      pulled: 0,
      errors: [],
    };

    try {
      // 1. Push local changes to server
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
      await this.notifyStatus();
    } catch (error: any) {
      result.success = false;
      result.errors.push(error);
      await this.notifyStatus(error.message);
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  /**
   * Push pending changes to server
   * Note: Actual API calls should be implemented based on your tRPC setup.
   * Records are only marked as synced after a successful server response.
   */
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
          
          // Prepare changes for API
          const changes = batch.map((record: any) => ({
            id: record.externalId || record.id,
            table: tableName,
            action: record.externalId ? 'update' : 'create',
            data: record._raw,
          }));

          // TODO: Replace with actual tRPC call
          // const result = await trpc.sync.push.mutate({ changes });
          // if (!result.success) {
          //   errors.push(new Error(`Push ${tableName} batch failed: ${result.message}`));
          //   continue; // Don't mark as synced — retry next time
          // }

          // Only mark as synced AFTER successful server response
          // Until the TODO above is implemented, skip marking to prevent data loss
          console.warn(
            `[SyncEngine] pushChanges: ${batch.length} ${tableName} record(s) pending. ` +
            `Server push not yet implemented — records remain pending.`
          );
        }
      } catch (error: any) {
        errors.push(new Error(`Push ${tableName} failed: ${error.message}`));
      }
    }

    return { count, errors };
  }

  /**
   * Pull remote changes from server
   * Note: Actual API calls should be implemented based on your tRPC setup
   */
  private async pullChanges(): Promise<{ count: number; errors: Error[] }> {
    const errors: Error[] = [];
    let count = 0;

    for (const tableName of this.config.tables) {
      try {
        // Get last sync token
        const syncStatusRecords = await database.get('sync_status')
          .query(Q.where('table_name', tableName))
          .fetch();
        const lastToken = (syncStatusRecords[0] as any)?.lastSyncToken || null;

        // TODO: Replace with actual tRPC call
        // const response = await trpc.sync.pull.query({
        //   table: tableName,
        //   since: lastToken,
        //   limit: this.config.batchSize,
        // });

        // For now, simulate empty response
        const response: { changes: Array<{ id: string; data: Record<string, unknown> }>; nextToken: string | null } = { changes: [], nextToken: lastToken };

        if (response.changes.length === 0) continue;

        // Apply changes locally
        await database.write(async () => {
          for (const change of response.changes) {
            const existing = await database.get(tableName)
              .query(Q.where('external_id', change.id))
              .fetch();

            if (existing.length > 0) {
              // Update existing record
              await existing[0].update((record: any) => {
                Object.assign(record, change.data);
                record.syncedAt = Date.now();
              });
            } else {
              // Create new record
              await database.get(tableName).create((record: any) => {
                record.externalId = change.id;
                Object.assign(record, change.data);
                record.syncedAt = Date.now();
              });
            }
          }
        });

        // Update sync token
        await this.updateSyncToken(tableName, response.nextToken || '');

        count += response.changes.length;
      } catch (error: any) {
        errors.push(new Error(`Pull ${tableName} failed: ${error.message}`));
      }
    }

    return { count, errors };
  }

  /**
   * Update sync token for a table
   */
  private async updateSyncToken(tableName: string, token: string): Promise<void> {
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
          record.pendingChangesCount = 0;
        });
      }
    });
  }

  /**
   * Update overall sync status
   */
  private async updateSyncStatus(): Promise<void> {
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

  /**
   * Get pending changes count
   */
  async getPendingCount(): Promise<number> {
    let total = 0;
    for (const tableName of this.config.tables) {
      total += await database.get(tableName)
        .query(Q.where('is_pending_sync', true))
        .fetchCount();
    }
    return total;
  }

  /**
   * Force sync (bypass interval check)
   */
  async forceSync(): Promise<SyncResult> {
    const wasSyncing = this.isSyncing;
    this.isSyncing = false;
    this.lastSyncTime = 0;
    return this.attemptSync();
  }

  /**
   * Check if currently syncing
   */
  get syncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Get last sync time
   */
  get lastSync(): number {
    return this.lastSyncTime;
  }
}

// Export singleton instance
export const syncEngine = new SyncEngine();