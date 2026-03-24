/**
 * Route Model - Collection routes for drivers
 */
import { Model } from '@nozbe/watermelondb';
import { field, date, readonly, children } from '@nozbe/watermelondb/decorators';

export type RouteStatus = 'not_started' | 'in_progress' | 'completed';
export type RouteSource = 'vrp' | 'osm' | 'manual';

export default class Route extends Model {
  static table = 'routes';

  static associations = {
    collection_points: { type: 'has_many' as const, foreignKey: 'route_id' },
  };

  @field('external_id') externalId!: string;
  @field('date') date!: string;
  @field('driver_id') driverId!: string;
  @field('vehicle_id') vehicleId!: string;
  @field('status') status!: RouteStatus;
  @field('total_points') totalPoints!: number;
  @field('completed_points') completedPoints!: number;
  @field('estimated_duration_minutes') estimatedDurationMinutes!: number;
  @field('actual_duration_minutes') actualDurationMinutes!: number;
  @field('total_distance_meters') totalDistanceMeters!: number;
  @field('route_source') routeSource!: RouteSource;
  @date('synced_at') syncedAt!: number;
  @field('is_pending_sync') isPendingSync!: boolean;
  @readonly @date('created_at') createdAt!: number;
  @date('updated_at') updatedAt!: number;

  @children('collection_points') collectionPoints!: any;

  /**
   * Computed progress percentage (0-1)
   */
  get progress(): number {
    const total = this.totalPoints as number;
    const completed = this.completedPoints as number;
    return total > 0 ? completed / total : 0;
  }

  /**
   * Check if route is complete
   */
  get isComplete(): boolean {
    return this.status === 'completed';
  }

  /**
   * Check if route is in progress
   */
  get isInProgress(): boolean {
    return this.status === 'in_progress';
  }

  /**
   * Start the route
   */
  async startRoute() {
    await this.update((record) => {
      record.status = 'in_progress';
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }

  /**
   * Complete the route
   */
  async completeRoute(actualDurationMinutes?: number) {
    await this.update((record) => {
      record.status = 'completed';
      if (actualDurationMinutes !== undefined) {
        record.actualDurationMinutes = actualDurationMinutes;
      }
      record.updatedAt = Date.now();
      record.isPendingSync = true;
    });
  }

  /**
   * Increment completed points count
   */
  async incrementCompleted() {
    await this.update((record) => {
      record.completedPoints = (record.completedPoints as number) + 1;
      record.isPendingSync = true;
      record.updatedAt = Date.now();
    });
  }

  /**
   * Get ordered collection points
   */
  async getOrderedPoints() {
    const points = await this.collectionPoints.fetch();
    return points.sort((a: any, b: any) => (a.sequence as number) - (b.sequence as number));
  }

  /**
   * Get next pending collection point
   */
  async getNextPendingPoint() {
    const points = await this.getOrderedPoints();
    return points.find((p: any) => p.status === 'pending');
  }
}
