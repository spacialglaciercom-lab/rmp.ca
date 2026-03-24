/**
 * WastePoint Model - Bins and dumpsters for zone mapping
 */
import { Model, Q } from '@nozbe/watermelondb';
import { field, date, readonly, children, relation } from '@nozbe/watermelondb/decorators';

export default class WastePoint extends Model {
  static table = 'waste_points';

  static associations = {
    collection_points: { type: 'has_many' as const, foreignKey: 'waste_point_id' },
    zones: { type: 'belongs_to' as const, key: 'zone_id' },
  };

  @field('external_id') externalId!: string;
  @field('latitude') latitude!: number;
  @field('longitude') longitude!: number;
  @field('type') type!: 'bin' | 'dumpster'; // bin | dumpster
  @field('capacity_liters') capacityLiters!: number;
  @field('condition') condition!: 'good' | 'overflowing' | 'damaged'; // good | overflowing | damaged
  @field('address') address!: string;
  @field('zone_id') zoneId!: string;
  @date('last_serviced_at') lastServicedAt!: number;
  @date('synced_at') syncedAt!: number;
  @field('is_pending_sync') isPendingSync!: boolean;
  @readonly @date('created_at') createdAt!: number;
  @date('updated_at') updatedAt!: number;

  @children('collection_points') collectionPoints!: any;

  /**
   * Mark this record for sync with server
   */
  markForSync() {
    return this.update((record) => {
      record.isPendingSync = true;
      record.updatedAt = Date.now();
    });
  }

  /**
   * Calculate distance from a given lat/lon in meters
   */
  distanceFrom(lat: number, lon: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((this.latitude as number) - lat) * Math.PI / 180;
    const dLon = ((this.longitude as number) - lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat * Math.PI / 180) * Math.cos((this.latitude as number) * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Update condition and mark for sync
   */
  async updateCondition(newCondition: 'good' | 'overflowing' | 'damaged') {
    await this.update((record) => {
      record.condition = newCondition;
      record.isPendingSync = true;
      record.updatedAt = Date.now();
    });
  }

  /**
   * Mark as serviced
   */
  async markServiced() {
    await this.update((record) => {
      record.lastServicedAt = Date.now();
      record.isPendingSync = true;
      record.updatedAt = Date.now();
    });
  }
}
