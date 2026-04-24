/**
 * SyncStatus Model - Track sync state per table
 */
import { Model } from '@nozbe/watermelondb';
import { field, date } from '@nozbe/watermelondb/decorators';

export default class SyncStatus extends Model {
  static table = 'sync_status';

  @field('table_name') tableName!: string;
  @date('last_sync_at') lastSyncAt!: number;
  @field('last_sync_token') lastSyncToken!: string;
  @field('pending_changes_count') pendingChangesCount!: number;

  /**
   * Update sync status after successful sync
   */
  async updateAfterSync(token?: string) {
    await this.update((record) => {
      record.lastSyncAt = Date.now();
      if (token) record.lastSyncToken = token;
    });
  }

  /**
   * Update pending changes count
   */
  async updatePendingCount(count: number) {
    await this.update((record) => {
      record.pendingChangesCount = count;
    });
  }
}
