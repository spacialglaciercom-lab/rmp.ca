/**
 * Location-Based Sync for Nearby Bins
 * 
 * Syncs waste points within a radius of the driver's current location.
 * Optimized for rural areas with limited connectivity.
 */
import { database } from '../index';
import { Q } from '@nozbe/watermelondb';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { trpc } from '../../trpc';

// Location sync configuration
interface LocationSyncConfig {
  radiusKm: number;           // Sync radius around driver
  maxPoints: number;          // Max points to sync per request
  minSyncInterval: number;    // Minimum time between syncs (ms)
  minDistanceKm: number;      // Minimum distance before re-sync
}

const DEFAULT_CONFIG: LocationSyncConfig = {
  radiusKm: 10,
  maxPoints: 500,
  minSyncInterval: 300000, // 5 minutes
  minDistanceKm: 2, // 2 km
};

// Location sync result
export interface LocationSyncResult {
  success: boolean;
  pointsSynced: number;
  error?: string;
}

/**
 * Location Sync Class
 */
export class LocationSync {
  private config: LocationSyncConfig;
  private lastSyncLocation: { lat: number; lon: number } | null = null;
  private lastSyncTime: number = 0;
  private isSyncing: boolean = false;

  constructor(config: Partial<LocationSyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Sync nearby bins based on current location
   */
  async syncNearbyBins(): Promise<LocationSyncResult> {
    // Check if online
    const netInfo = await NetInfo.fetch();
    if (!netInfo.isConnected || !netInfo.isInternetReachable) {
      return { success: false, pointsSynced: 0, error: 'offline' };
    }

    // Check if already syncing
    if (this.isSyncing) {
      return { success: false, pointsSynced: 0, error: 'already_syncing' };
    }

    // Request location permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { success: false, pointsSynced: 0, error: 'permission_denied' };
    }

    this.isSyncing = true;

    try {
      // Get current location
      const location = await (Location as any).getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;

      // Check if we should skip sync
      if (this.shouldSkipSync(latitude, longitude)) {
        return { success: true, pointsSynced: 0 };
      }

      const response = await trpc.sync.nearbyWastePoints.query({
        lat: latitude,
        lon: longitude,
        radiusKm: this.config.radiusKm,
        limit: this.config.maxPoints,
      });

      // Update local database
      await database.write(async () => {
        for (const point of response.points as any[]) {
          const existing = await database.get('waste_points')
            .query(Q.where('external_id', point.id))
            .fetch();

          if (existing.length > 0) {
            // Update existing
            await existing[0].update((record: any) => {
              record.latitude = point.latitude;
              record.longitude = point.longitude;
              record.name = point.name;
              record.type = point.type;
              record.fillLevel = point.fill_level;
              record.status = point.status;
              record.syncedAt = Date.now();
            });
          } else {
            // Create new
            await database.get('waste_points').create((record: any) => {
              record.externalId = point.id;
              record.latitude = point.latitude;
              record.longitude = point.longitude;
              record.name = point.name;
              record.type = point.type;
              record.fillLevel = point.fill_level;
              record.status = point.status;
              record.syncedAt = Date.now();
              record.isPendingSync = false;
            });
          }
        }
      });

      this.lastSyncLocation = { lat: latitude, lon: longitude };
      this.lastSyncTime = Date.now();

      return { success: true, pointsSynced: response.points.length };
    } catch (error: any) {
      return { success: false, pointsSynced: 0, error: error.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Check if we should skip sync (time or distance threshold)
   */
  private shouldSkipSync(lat: number, lon: number): boolean {
    // Time check
    const timeSinceLastSync = Date.now() - this.lastSyncTime;
    if (timeSinceLastSync < this.config.minSyncInterval) {
      return true;
    }

    // Distance check
    if (this.lastSyncLocation) {
      const distance = this.haversineDistance(
        this.lastSyncLocation.lat,
        this.lastSyncLocation.lon,
        lat,
        lon
      );

      if (distance < this.config.minDistanceKm) {
        return true;
      }
    }

    return false;
  }

  /**
   * Haversine distance calculation (returns km)
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Get nearby bins from local database
   */
  async getLocalNearbyBins(lat: number, lon: number, radiusKm?: number): Promise<any[]> {
    const radius = radiusKm || this.config.radiusKm;
    const allPoints = await database.get('waste_points').query().fetch();

    return allPoints.filter((point: any) => {
      const distance = this.haversineDistance(
        lat, lon,
        point.latitude, point.longitude
      );
      return distance <= radius;
    });
  }

  /**
   * Get current location
   */
  async getCurrentLocation(): Promise<{ lat: number; lon: number } | null> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }

      const location = await (Location as any).getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        lat: location.coords.latitude,
        lon: location.coords.longitude,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get last sync location
   */
  get lastLocation(): { lat: number; lon: number } | null {
    return this.lastSyncLocation;
  }

  /**
   * Get last sync time
   */
  get lastSync(): number {
    return this.lastSyncTime;
  }

  /**
   * Check if currently syncing
   */
  get syncing(): boolean {
    return this.isSyncing;
  }
}

// Export singleton instance
export const locationSync = new LocationSync();