/**
 * Zone Model - Zone partitions for route optimization
 */
import { Model } from '@nozbe/watermelondb';
import { field, date, readonly, children } from '@nozbe/watermelondb/decorators';

export default class Zone extends Model {
  static table = 'zones';

  static associations = {
    waste_points: { type: 'has_many' as const, foreignKey: 'zone_id' },
  };

  @field('external_id') externalId!: string;
  @field('name') name!: string;
  @field('geojson') geojson!: string; // JSON string of GeoJSON polygon
  @field('center_lat') centerLat!: number;
  @field('center_lon') centerLon!: number;
  @field('point_count') pointCount!: number;
  @date('synced_at') syncedAt!: number;
  @field('is_pending_sync') isPendingSync!: boolean;
  @readonly @date('created_at') createdAt!: number;
  @date('updated_at') updatedAt!: number;

  @children('waste_points') wastePoints!: any;

  /**
   * Parse GeoJSON from stored string
   */
  getGeoJSON(): object | null {
    try {
      return this.geojson ? JSON.parse(this.geojson as string) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set GeoJSON as string
   */
  setGeoJSON(geojson: object) {
    return this.update((record) => {
      record.geojson = JSON.stringify(geojson);
      record.isPendingSync = true;
      record.updatedAt = Date.now();
    });
  }

  /**
   * Update point count
   */
  async updatePointCount(count: number) {
    await this.update((record) => {
      record.pointCount = count;
      record.isPendingSync = true;
      record.updatedAt = Date.now();
    });
  }

  /**
   * Calculate distance from zone center to a point
   */
  distanceFromCenter(lat: number, lon: number): number {
    const R = 6371000; // Earth radius in meters
    const centerLat = this.centerLat as number;
    const centerLon = this.centerLon as number;
    const dLat = (centerLat - lat) * Math.PI / 180;
    const dLon = (centerLon - lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat * Math.PI / 180) * Math.cos(centerLat * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
