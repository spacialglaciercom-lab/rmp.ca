/**
 * Conflict Resolution for Sync
 * 
 * Handles conflicts when the same record is modified
 * on multiple devices before sync.
 */

export type ConflictResolution = 'server_wins' | 'client_wins' | 'merge' | 'manual';

export interface ConflictData {
  localRecord: any;
  serverRecord: any;
  tableName: string;
  conflictFields: string[];
}

export interface ResolvedRecord {
  data: any;
  resolution: ConflictResolution;
}

/**
 * Default conflict resolution strategies per table
 */
const DEFAULT_STRATEGIES: Record<string, ConflictResolution> = {
  waste_points: 'server_wins',
  routes: 'server_wins',
  collection_points: 'client_wins', // Driver's updates are most important
  zones: 'server_wins',
  favorites: 'client_wins',
};

/**
 * Resolve a sync conflict
 */
export function resolveConflict(
  conflict: ConflictData,
  strategy?: ConflictResolution
): ResolvedRecord {
  const resolution = strategy || DEFAULT_STRATEGIES[conflict.tableName] || 'server_wins';

  switch (resolution) {
    case 'server_wins':
      return {
        data: conflict.serverRecord,
        resolution: 'server_wins',
      };

    case 'client_wins':
      return {
        data: {
          ...conflict.serverRecord,
          ...conflict.localRecord,
          // Preserve server ID and sync metadata
          id: conflict.serverRecord.id,
          syncedAt: Date.now(),
        },
        resolution: 'client_wins',
      };

    case 'merge':
      return mergeRecords(conflict);

    case 'manual':
      // Return both records for manual resolution
      throw new Error('Manual conflict resolution required');

    default:
      return {
        data: conflict.serverRecord,
        resolution: 'server_wins',
      };
  }
}

/**
 * Merge local and server records intelligently
 */
function mergeRecords(conflict: ConflictData): ResolvedRecord {
  const merged: any = { ...conflict.serverRecord };

  for (const field of conflict.conflictFields) {
    // For timestamps, use the most recent
    if (field.endsWith('_at')) {
      const localTime = conflict.localRecord[field] || 0;
      const serverTime = conflict.serverRecord[field] || 0;
      merged[field] = Math.max(localTime, serverTime);
    }
    // For status fields, prefer client for collection_points
    else if (field === 'status' && conflict.tableName === 'collection_points') {
      merged[field] = conflict.localRecord[field];
    }
    // For counts, use the higher value
    else if (field.includes('count') || field.includes('points')) {
      merged[field] = Math.max(
        conflict.localRecord[field] || 0,
        conflict.serverRecord[field] || 0
      );
    }
    // For notes and photos, prefer non-empty values
    else if (field === 'notes' || field === 'photo_uri') {
      merged[field] = conflict.localRecord[field] || conflict.serverRecord[field];
    }
    // Default: use server value
    else {
      merged[field] = conflict.serverRecord[field];
    }
  }

  merged.syncedAt = Date.now();

  return {
    data: merged,
    resolution: 'merge',
  };
}

/**
 * Detect conflicts between local and server records
 */
export function detectConflicts(
  localRecord: any,
  serverRecord: any,
  fields: string[]
): string[] {
  const conflicts: string[] = [];

  for (const field of fields) {
    // Skip sync metadata fields
    if (field === 'synced_at' || field === 'is_pending_sync' || field === 'created_at') {
      continue;
    }

    const localValue = localRecord[field];
    const serverValue = serverRecord[field];

    // Check if values differ
    if (localValue !== serverValue) {
      // For numbers, check if difference is significant
      if (typeof localValue === 'number' && typeof serverValue === 'number') {
        if (Math.abs(localValue - serverValue) > 0.0001) {
          conflicts.push(field);
        }
      } else {
        conflicts.push(field);
      }
    }
  }

  return conflicts;
}

/**
 * Get conflict resolution strategy for a table
 */
export function getStrategy(tableName: string): ConflictResolution {
  return DEFAULT_STRATEGIES[tableName] || 'server_wins';
}

/**
 * Set custom conflict resolution strategy
 */
export function setStrategy(tableName: string, strategy: ConflictResolution): void {
  DEFAULT_STRATEGIES[tableName] = strategy;
}