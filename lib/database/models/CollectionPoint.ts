/**
 * CollectionPoint Model - Individual stops within a route
 */
import { Model } from '@nozbe/watermelondb';
import { field, date, readonly, relation } from '@nozbe/watermelondb/decorators';

export type CollectionType = 'residential' | 'commercial' | 'recycling' | 'bulk';
export type CollectionStatus = 'pending' | 'completed' | 'skipped' | 'issue';

export default class CollectionPoint extends Model {
  static table = 'collection_points';

  static associations = {
    routes: { type: 'belongs_to' as const, key: 'route_id' },
    waste_points: { type: 'belongs_to' as const, key: 'waste_point_id' },
  };

  @field('external_id') externalId!: string;
  @field('route_id') routeId!: string;
  @field('waste_point_id') wastePointId!: string;
  @field('sequence') sequence!: number;
  @field('latitude') latitude!: number;
  @field('longitude') longitude!: number;
  @field('address') address!: string;
  @field('collection_type') collectionType!: CollectionType;
  @field('status') status!: CollectionStatus;
  @field('special_instructions') specialInstructions!: string;
  @field('notes') notes!: string;
  @field('photo_uri') photoUri!: string;
  @date('completed_at') completedAt!: number;
  @field('skipped_reason') skippedReason!: string;
  @date('synced_at') syncedAt!: number;
  @field('is_pending_sync') isPendingSync!: boolean;
  @readonly @date('created_at') createdAt!: number;
  @date('updated_at') updatedAt!: number;

  @relation('routes', 'route_id') route!: any;
  @relation('waste_points', 'waste_point_id') wastePoint!: any;

  /**
   * Check if point is completed
   */
  get isCompleted(): boolean {
    return this.status === 'completed';
  }

  /**
   * Check if point is pending
   */
  get isPending(): boolean {
    return this.status === 'pending';
  }

  /**
   * Check if point has an issue
   */
  get hasIssue(): boolean {
    return this.status === 'issue';
  }

  /**
   * Mark as completed with optional photo and notes
   */
  async markCompleted(photoUri?: string, notes?: string) {
    await this.update((record) => {
      record.status = 'completed';
      record.completedAt = Date.now();
      if (photoUri) record.photoUri = photoUri;
      if (notes) record.notes = notes;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });

    // Update parent route's completed count
    const route = await this.route.fetch();
    if (route) {
      await route.incrementCompleted();
    }
  }

  /**
   * Mark as skipped with reason
   */
  async markSkipped(reason: string) {
    await this.update((record) => {
      record.status = 'skipped';
      record.skippedReason = reason;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });

    // Still count as "processed" for route progress
    const route = await this.route.fetch();
    if (route) {
      await route.incrementCompleted();
    }
  }

  /**
   * Report an issue with optional photo
   */
  async reportIssue(notes: string, photoUri?: string) {
    await this.update((record) => {
      record.status = 'issue';
      record.notes = notes;
      if (photoUri) record.photoUri = photoUri;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }

  /**
   * Add notes to the point
   */
  async addNotes(notes: string) {
    await this.update((record) => {
      record.notes = notes;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }

  /**
   * Attach a photo
   */
  async attachPhoto(photoUri: string) {
    await this.update((record) => {
      record.photoUri = photoUri;
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }
}
