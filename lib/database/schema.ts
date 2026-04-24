/**
 * WatermelonDB Schema for Offline-First Data Storage
 * 
 * This schema supports offline-first operation for rural drivers
 * with spotty cell service. All entities track sync status.
 */
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    // Waste points (bins/dumpsters) for zone mapping
    tableSchema({
      name: 'waste_points',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'type', type: 'string' }, // bin | dumpster
        { name: 'capacity_liters', type: 'number' },
        { name: 'condition', type: 'string' }, // good | overflowing | damaged
        { name: 'address', type: 'string' },
        { name: 'zone_id', type: 'string', isIndexed: true },
        { name: 'last_serviced_at', type: 'number' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // Routes for collection drivers
    tableSchema({
      name: 'routes',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'date', type: 'string', isIndexed: true },
        { name: 'driver_id', type: 'string', isIndexed: true },
        { name: 'vehicle_id', type: 'string' },
        { name: 'status', type: 'string' }, // not_started | in_progress | completed
        { name: 'total_points', type: 'number' },
        { name: 'completed_points', type: 'number' },
        { name: 'estimated_duration_minutes', type: 'number' },
        { name: 'actual_duration_minutes', type: 'number' },
        { name: 'total_distance_meters', type: 'number' },
        { name: 'route_source', type: 'string' }, // vrp | osm | manual
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // Individual collection stops within a route
    tableSchema({
      name: 'collection_points',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'route_id', type: 'string', isIndexed: true },
        { name: 'waste_point_id', type: 'string', isIndexed: true },
        { name: 'sequence', type: 'number' },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'address', type: 'string' },
        { name: 'collection_type', type: 'string' }, // residential | commercial | recycling | bulk
        { name: 'status', type: 'string' }, // pending | completed | skipped | issue
        { name: 'special_instructions', type: 'string' },
        { name: 'notes', type: 'string' },
        { name: 'photo_uri', type: 'string' },
        { name: 'completed_at', type: 'number' },
        { name: 'skipped_reason', type: 'string' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // Zone partitions for route optimization
    tableSchema({
      name: 'zones',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'geojson', type: 'string' }, // JSON string
        { name: 'center_lat', type: 'number' },
        { name: 'center_lon', type: 'number' },
        { name: 'point_count', type: 'number' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // User favorites (waypoints, depots, landmarks)
    tableSchema({
      name: 'favorites',
      columns: [
        { name: 'external_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'latitude', type: 'number' },
        { name: 'longitude', type: 'number' },
        { name: 'category', type: 'string' }, // waypoint | depot | landmark
        { name: 'notes', type: 'string' },
        { name: 'synced_at', type: 'number' },
        { name: 'is_pending_sync', type: 'boolean' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    // Sync metadata for tracking sync state per table
    tableSchema({
      name: 'sync_status',
      columns: [
        { name: 'table_name', type: 'string', isIndexed: true },
        { name: 'last_sync_at', type: 'number' },
        { name: 'last_sync_token', type: 'string' },
        { name: 'pending_changes_count', type: 'number' },
      ],
    }),
  ],
});