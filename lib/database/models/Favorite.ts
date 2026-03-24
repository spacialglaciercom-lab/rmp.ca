/**
 * Favorite Model - User saved places (waypoints, depots, landmarks)
 */
import { Model } from '@nozbe/watermelondb';
import { field, date, readonly } from '@nozbe/watermelondb/decorators';

export type FavoriteCategory = 'waypoint' | 'depot' | 'landmark';

export default class Favorite extends Model {
  static table = 'favorites';

  @field('external_id') externalId!: string;
  @field('name') name!: string;
  @field('latitude') latitude!: number;
  @field('longitude') longitude!: number;
  @field('category') category!: FavoriteCategory;
  @field('notes') notes!: string;
  @date('synced_at') syncedAt!: number;
  @field('is_pending_sync') isPendingSync!: boolean;
  @readonly @date('created_at') createdAt!: number;
  @date('updated_at') updatedAt!: number;

  /**
   * Update favorite details
   */
  async updateDetails(name?: string, notes?: string) {
    await this.update((record) => {
      if (name) record.name = name;
      if (notes !== undefined) record.notes = notes;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }

  /**
   * Update location
   */
  async updateLocation(lat: number, lon: number) {
    await this.update((record) => {
      record.latitude = lat;
      record.longitude = lon;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }

  /**
   * Calculate distance from a given point
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
}
