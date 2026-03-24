/**
 * Route Persistence Service
 * 
 * Step 3 of route planning workflow:
 * - Save route data to PostgreSQL/PostGIS on FreeBSD server (db01)
 * - Handle offline-first sync with WatermelonDB
 * - Support route creation, update, and deletion
 */
import { v4 as uuidv4 } from 'uuid';
import type { SolverResult } from './routeSolver';
import type { ImportPoint } from '@/hooks/useRouteImport';

// Types for route persistence
export interface RoutePoint extends ImportPoint {
  id: string;
  sequence: number;
  routeId: string;
  status: 'pending' | 'completed' | 'skipped' | 'issue';
  completedAt?: Date;
  notes?: string;
}

export interface RouteData {
  id: string;
  name: string;
  date: Date;
  driverId?: number;
  vehicleId?: string;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  totalPoints: number;
  completedPoints: number;
  estimatedDurationMinutes: number;
  actualDurationMinutes?: number;
  totalDistanceMeters: number;
  routeSource: 'manual' | 'vrp' | 'imported';
  points: RoutePoint[];
  depot?: RoutePoint;
}

export interface SaveRouteOptions {
  name: string;
  points: ImportPoint[];
  depot?: ImportPoint;
  solveResult?: SolverResult;
  driverId?: number;
  vehicleId?: string;
  routeSource?: 'manual' | 'vrp' | 'imported';
  orgId?: number;
  userId?: number;
}

export interface RoutePersistenceResult {
  success: boolean;
  routeId: string;
  message?: string;
  error?: string;
}

/**
 * Route Persistence Service
 * Handles saving routes to PostgreSQL/PostGIS and syncing with WatermelonDB
 */
class RoutePersistenceService {
  /**
   * Save a route to PostgreSQL/PostGIS
   * Creates route record and all associated route stops
   */
  async saveRoute(options: SaveRouteOptions): Promise<RoutePersistenceResult> {
    const {
      name,
      points,
      depot,
      solveResult,
      driverId,
      vehicleId,
      routeSource = 'imported',
      orgId,
      userId,
    } = options;

    try {
      // Generate route ID
      const routeId = uuidv4();

      // Calculate route statistics
      const totalDistance = solveResult?.totalDistance ?? this.calculateTotalDistance(points, depot);
      const estimatedDuration = solveResult?.estimatedDuration ?? this.estimateDuration(points);

      // Prepare route data
      const routeData: RouteData = {
        id: routeId,
        name,
        date: new Date(),
        driverId,
        vehicleId,
        status: 'pending',
        totalPoints: points.length,
        completedPoints: 0,
        estimatedDurationMinutes: Math.round(estimatedDuration / 60),
        totalDistanceMeters: totalDistance,
        routeSource,
        points: this.orderPoints(points, solveResult),
        depot: depot ? { ...depot, id: depot.id, sequence: 0, routeId, status: 'pending' } : undefined,
      };

      // Save to PostgreSQL via tRPC
      const result = await this.saveToPostgreSQL(routeData, { orgId, userId });

      if (!result.success) {
        return result;
      }

      // Also save to WatermelonDB for offline access
      await this.saveToWatermelonDB(routeData);

      return {
        success: true,
        routeId,
        message: `Route "${name}" saved successfully with ${points.length} points`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to save route:', error);
      return {
        success: false,
        routeId: '',
        error: errorMsg,
      };
    }
  }

  /**
   * Save route to PostgreSQL/PostGIS via tRPC
   */
  private async saveToPostgreSQL(
    routeData: RouteData,
    context: { orgId?: number; userId?: number }
  ): Promise<RoutePersistenceResult> {
    try {
      // Dynamic import to avoid circular dependencies
      const { trpc } = await import('@/lib/trpc');

      // Create route record
      await trpc.sync.createRoute.mutate({
        id: routeData.id,
        name: routeData.name,
        date: routeData.date.toISOString(),
        driverId: routeData.driverId,
        vehicleId: routeData.vehicleId,
        status: routeData.status,
        totalPoints: routeData.totalPoints,
        completedPoints: routeData.completedPoints,
        estimatedDurationMinutes: routeData.estimatedDurationMinutes,
        totalDistanceMeters: routeData.totalDistanceMeters,
        routeSource: routeData.routeSource,
        orgId: context.orgId,
        userId: context.userId,
      });

      // Create route stops
      for (const point of routeData.points) {
        await trpc.sync.createRouteStop.mutate({
          id: point.id,
          routeId: routeData.id,
          sequence: point.sequence,
          address: point.address,
          latitude: point.lat,
          longitude: point.lon,
          collectionType: point.type,
          status: point.status,
          specialInstructions: point.notes,
        });
      }

      return { success: true, routeId: routeData.id };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save to PostgreSQL';
      console.error('PostgreSQL save error:', error);
      return { success: false, routeId: '', error: errorMsg };
    }
  }

  /**
   * Save route to WatermelonDB for offline access
   */
  private async saveToWatermelonDB(routeData: RouteData): Promise<void> {
    try {
      // Dynamic import to avoid circular dependencies
      const { database } = await import('@/lib/database');
      const { routes, routeStops } = await import('@/lib/database/schema');

      await database.write(async () => {
        // Create route record
        await database.get(routes.table).create((route: any) => {
          route._raw.id = routeData.id;
          route.name = routeData.name;
          route.date = routeData.date.getTime();
          route.status = routeData.status;
          route.totalPoints = routeData.totalPoints;
          route.completedPoints = routeData.completedPoints;
          route.estimatedDurationMinutes = routeData.estimatedDurationMinutes;
          route.totalDistanceMeters = routeData.totalDistanceMeters;
          route.routeSource = routeData.routeSource;
          route.syncedAt = null;
        });

        // Create route stops
        for (const point of routeData.points) {
          await database.get(routeStops.table).create((stop: any) => {
            stop._raw.id = point.id;
            stop.routeId = routeData.id;
            stop.sequence = point.sequence;
            stop.address = point.address ?? null;
            stop.latitude = point.lat;
            stop.longitude = point.lon;
            stop.collectionType = point.type ?? null;
            stop.status = point.status;
            stop.specialInstructions = point.notes ?? null;
            stop.syncedAt = null;
          });
        }
      });
    } catch (error) {
      console.error('WatermelonDB save error:', error);
      // Don't throw - offline save failure shouldn't block the operation
    }
  }

  /**
   * Update route status
   */
  async updateRouteStatus(
    routeId: string,
    status: 'pending' | 'active' | 'completed' | 'cancelled'
  ): Promise<RoutePersistenceResult> {
    try {
      const { trpc } = await import('@/lib/trpc');

      await trpc.sync.updateRoute.mutate({
        id: routeId,
        status,
        updatedAt: new Date().toISOString(),
      });

      return { success: true, routeId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update route';
      return { success: false, routeId: '', error: errorMsg };
    }
  }

  /**
   * Mark a route stop as completed
   */
  async completeStop(
    stopId: string,
    notes?: string,
    photoUri?: string
  ): Promise<RoutePersistenceResult> {
    try {
      const { trpc } = await import('@/lib/trpc');

      await trpc.sync.updateRouteStop.mutate({
        id: stopId,
        status: 'completed',
        completedAt: new Date().toISOString(),
        notes,
        photoUri,
      });

      return { success: true, routeId: stopId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to complete stop';
      return { success: false, routeId: '', error: errorMsg };
    }
  }

  /**
   * Delete a route and all its stops
   */
  async deleteRoute(routeId: string): Promise<RoutePersistenceResult> {
    try {
      const { trpc } = await import('@/lib/trpc');

      // Delete route (cascade will delete stops)
      await trpc.sync.deleteRoute.mutate({ id: routeId });

      // Also delete from WatermelonDB
      await this.deleteFromWatermelonDB(routeId);

      return { success: true, routeId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete route';
      return { success: false, routeId: '', error: errorMsg };
    }
  }

  /**
   * Delete route from WatermelonDB
   */
  private async deleteFromWatermelonDB(routeId: string): Promise<void> {
    try {
      const { database } = await import('@/lib/database');
      const { routes, routeStops } = await import('@/lib/database/schema');

      await database.write(async () => {
        // Delete route stops first
        const stops = await database.get(routeStops.table).query().fetch();
        for (const stop of stops) {
          if ((stop as any).routeId === routeId) {
            await (stop as any).destroyPermanently();
          }
        }

        // Delete route
        const route = await database.get(routes.table).find(routeId);
        await (route as any).destroyPermanently();
      });
    } catch (error) {
      console.error('WatermelonDB delete error:', error);
    }
  }

  /**
   * Get route by ID
   */
  async getRoute(routeId: string): Promise<RouteData | null> {
    try {
      const { trpc } = await import('@/lib/trpc');

      const route = await trpc.sync.getRoute.query({ id: routeId });
      const stops = await trpc.sync.getRouteStops.query({ routeId });

      return {
        id: route.id,
        name: route.name,
        date: new Date(route.date),
        driverId: route.driverId ?? undefined,
        vehicleId: route.vehicleId ?? undefined,
        status: route.status,
        totalPoints: route.totalPoints,
        completedPoints: route.completedPoints,
        estimatedDurationMinutes: route.estimatedDurationMinutes,
        actualDurationMinutes: route.actualDurationMinutes ?? undefined,
        totalDistanceMeters: route.totalDistanceMeters,
        routeSource: route.routeSource,
        points: stops.map((stop: any) => ({
          id: stop.id,
          sequence: stop.sequence,
          routeId: stop.routeId,
          lat: stop.latitude,
          lon: stop.longitude,
          name: stop.address,
          address: stop.address,
          type: stop.collectionType,
          status: stop.status,
          notes: stop.specialInstructions,
        })),
      };
    } catch (error) {
      console.error('Failed to get route:', error);
      return null;
    }
  }

  /**
   * Calculate total distance using haversine formula
   */
  private calculateTotalDistance(points: ImportPoint[], depot?: ImportPoint): number {
    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371000;
      const φ1 = (lat1 * Math.PI) / 180;
      const φ2 = (lat2 * Math.PI) / 180;
      const Δφ = ((lat2 - lat1) * Math.PI) / 180;
      const Δλ = ((lon2 - lon1) * Math.PI) / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c;
    };

    if (points.length < 2) return 0;

    let total = 0;
    const allPoints = depot ? [depot, ...points] : points;

    for (let i = 0; i < allPoints.length - 1; i++) {
      total += haversine(
        allPoints[i].lat,
        allPoints[i].lon,
        allPoints[i + 1].lat,
        allPoints[i + 1].lon
      );
    }

    return total;
  }

  /**
   * Estimate duration based on distance and number of stops
   */
  private estimateDuration(points: ImportPoint[]): number {
    const avgSpeedMps = (30 * 1000) / 3600; // 30 km/h
    const serviceTimePerStop = 120; // 2 minutes in seconds
    const distance = this.calculateTotalDistance(points);
    const travelTime = distance / avgSpeedMps;
    const serviceTime = points.length * serviceTimePerStop;
    return travelTime + serviceTime;
  }

  /**
   * Order points based on solve result
   */
  private orderPoints(points: ImportPoint[], solveResult?: SolverResult): RoutePoint[] {
    if (solveResult && solveResult.orderedPoints) {
      return solveResult.orderedPoints.map((p, idx) => ({
        ...p,
        id: p.id || uuidv4(),
        sequence: idx + 1,
        routeId: '',
        status: 'pending' as const,
      }));
    }

    return points.map((p, idx) => ({
      ...p,
      id: p.id || uuidv4(),
      sequence: idx + 1,
      routeId: '',
      status: 'pending' as const,
    }));
  }
}

// Export singleton instance
export const routePersistence = new RoutePersistenceService();

// Export convenience functions
export const saveRoute = (options: SaveRouteOptions) => routePersistence.saveRoute(options);
export const updateRouteStatus = (routeId: string, status: RouteData['status']) =>
  routePersistence.updateRouteStatus(routeId, status);
export const completeStop = (stopId: string, notes?: string, photoUri?: string) =>
  routePersistence.completeStop(stopId, notes, photoUri);
export const deleteRoute = (routeId: string) => routePersistence.deleteRoute(routeId);
export const getRoute = (routeId: string) => routePersistence.getRoute(routeId);