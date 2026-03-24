/**
 * Migration Utility: AsyncStorage to WatermelonDB
 * 
 * Migrates existing data from AsyncStorage to WatermelonDB SQLite storage.
 * Run once on app startup for users upgrading from AsyncStorage version.
 * 
 * Handles both direct AsyncStorage keys and Zustand persisted storage format.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { database } from "../index";
import { Q } from "@nozbe/watermelondb";

// Migration status key
const MIGRATION_KEY = "watermelon_migration_version";
const CURRENT_MIGRATION_VERSION = 2; // Bumped for improved migration

// Zustand persisted storage keys (these wrap data in { state: {...}, version: N })
const ZUSTAND_STORAGE_KEYS = {
  ZONES: "rmp-zones-storage",
  QUICK_DESTINATIONS: "trashroute-enhanced-quick-destinations",
  ROUTE_PARAMS: "trashroute-route-params-storage",
  MAP_STATE: "rmp-map-state-storage",
  MAP_LAYERS: "rmp-map-layers-storage",
  FAVORITES: "favorites-storage", // Old favorites key
} as const;

// Direct AsyncStorage keys (raw JSON data)
const DIRECT_STORAGE_KEYS = {
  IMPORTED_POINTS: "imported_points",
  OSM_IMPORT_TIMESTAMP: "osm_import_timestamp",
  OSM_DATA: "osm_data",
  TRASHROUTE_IMPORTED_POINTS: "trashroute_imported_points",
  TRASHROUTE_IMPORTED_DISTANCE: "trashroute_imported_distance_km",
} as const;

// Keys to keep in AsyncStorage (user preferences, not data to migrate)
const KEEP_IN_ASYNC_STORAGE = [
  "beta_features", // BetaFeaturesContext
  MIGRATION_KEY,
];

/**
 * Check if migration is needed
 */
export async function isMigrationNeeded(): Promise<boolean> {
  try {
    const version = await AsyncStorage.getItem(MIGRATION_KEY);
    const parsedVersion = version ? parseInt(version, 10) : 0;
    return parsedVersion < CURRENT_MIGRATION_VERSION;
  } catch {
    return true;
  }
}

/**
 * Run migration from AsyncStorage to WatermelonDB
 */
export async function runMigration(): Promise<{
  success: boolean;
  migrated: Record<string, number>;
  errors: string[];
}> {
  const result: {
    success: boolean;
    migrated: Record<string, number>;
    errors: string[];
  } = {
    success: true,
    migrated: {},
    errors: [],
  };

  try {
    // Check if migration already done
    const migrationVersion = await AsyncStorage.getItem(MIGRATION_KEY);
    if (migrationVersion) {
      const version = parseInt(migrationVersion, 10);
      if (version >= CURRENT_MIGRATION_VERSION) {
        console.log("Migration already completed, skipping");
        return result;
      }
    }

    console.log("Starting migration from AsyncStorage to WatermelonDB...");

    // Migrate Zustand persisted stores
    await migrateZustandStores(result);

    // Migrate direct AsyncStorage keys
    await migrateDirectKeys(result);

    // Mark migration complete
    await AsyncStorage.setItem(MIGRATION_KEY, String(CURRENT_MIGRATION_VERSION));
    console.log("Migration completed successfully");
  } catch (error: any) {
    result.success = false;
    result.errors.push(`Migration failed: ${error.message}`);
    console.error("Migration failed:", error);
  }

  return result;
}

/**
 * Migrate Zustand persisted stores
 */
async function migrateZustandStores(
  result: { migrated: Record<string, number>; errors: string[] }
): Promise<void> {
  // Migrate zones
  try {
    const zonesData = await AsyncStorage.getItem(ZUSTAND_STORAGE_KEYS.ZONES);
    if (zonesData) {
      const parsed = JSON.parse(zonesData);
      const zones = parsed?.state?.savedZones || [];
      if (Array.isArray(zones) && zones.length > 0) {
        const count = await migrateZones(zones);
        result.migrated["zones"] = count;
        console.log(`Migrated ${count} zones from Zustand storage`);
      }
    }
  } catch (error: any) {
    result.errors.push(`zones: ${error.message}`);
    console.error("Failed to migrate zones:", error);
  }

  // Migrate quick destinations (favorites-like)
  try {
    const quickDestData = await AsyncStorage.getItem(
      ZUSTAND_STORAGE_KEYS.QUICK_DESTINATIONS
    );
    if (quickDestData) {
      const parsed = JSON.parse(quickDestData);
      const destinations = [
        parsed?.state?.home,
        parsed?.state?.work,
        ...(parsed?.state?.customDestinations || []),
        ...(parsed?.state?.recentDestinations || []),
      ].filter(Boolean);

      if (destinations.length > 0) {
        const count = await migrateQuickDestinations(destinations);
        result.migrated["quick_destinations"] = count;
        console.log(`Migrated ${count} quick destinations from Zustand storage`);
      }
    }
  } catch (error: any) {
    result.errors.push(`quick_destinations: ${error.message}`);
    console.error("Failed to migrate quick destinations:", error);
  }

  // Migrate old favorites storage
  try {
    const favoritesData = await AsyncStorage.getItem(
      ZUSTAND_STORAGE_KEYS.FAVORITES
    );
    if (favoritesData) {
      const parsed = JSON.parse(favoritesData);
      const favorites = parsed?.state?.favorites || [];
      if (Array.isArray(favorites) && favorites.length > 0) {
        const count = await migrateFavorites(favorites);
        result.migrated["favorites"] = count;
        console.log(`Migrated ${count} favorites from Zustand storage`);
      }
    }
  } catch (error: any) {
    result.errors.push(`favorites: ${error.message}`);
    console.error("Failed to migrate favorites:", error);
  }
}

/**
 * Migrate direct AsyncStorage keys
 */
async function migrateDirectKeys(
  result: { migrated: Record<string, number>; errors: string[] }
): Promise<void> {
  // Migrate imported points (OSM data)
  try {
    const importedPoints = await AsyncStorage.getItem(
      DIRECT_STORAGE_KEYS.IMPORTED_POINTS
    );
    if (importedPoints) {
      const points = JSON.parse(importedPoints);
      if (Array.isArray(points) && points.length > 0) {
        const count = await migrateWastePoints(points, "imported_points");
        result.migrated["imported_points"] = count;
        console.log(`Migrated ${count} imported waste points`);
      }
    }
  } catch (error: any) {
    result.errors.push(`imported_points: ${error.message}`);
    console.error("Failed to migrate imported points:", error);
  }

  // Migrate trashroute imported points
  try {
    const trashroutePoints = await AsyncStorage.getItem(
      DIRECT_STORAGE_KEYS.TRASHROUTE_IMPORTED_POINTS
    );
    if (trashroutePoints) {
      const points = JSON.parse(trashroutePoints);
      if (Array.isArray(points) && points.length > 0) {
        const count = await migrateWastePoints(points, "trashroute_imported");
        result.migrated["trashroute_imported_points"] = count;
        console.log(`Migrated ${count} trashroute imported points`);
      }
    }
  } catch (error: any) {
    result.errors.push(`trashroute_imported_points: ${error.message}`);
    console.error("Failed to migrate trashroute imported points:", error);
  }
}

/**
 * Migrate zones to WatermelonDB
 */
async function migrateZones(zones: any[]): Promise<number> {
  let count = 0;
  await database.write(async () => {
    for (const zone of zones) {
      try {
        // Check if zone already exists
        const existing = await database
          .get("zones")
          .query(Q.where("external_id", zone.id))
          .fetch();

        if (existing.length === 0) {
          await database.get("zones").create((z: any) => {
            z.externalId = zone.id;
            z.name = zone.name || `Zone ${zone.id}`;
            z.polygon = JSON.stringify(zone.polygon || []);
            z.zones = JSON.stringify(zone.zones || []);
            z.truckCount = zone.truck_count || 1;
            z.balanceMetric = zone.balance_metric || "time";
            z.createdAt = zone.createdAt
              ? new Date(zone.createdAt).getTime()
              : Date.now();
            z.syncedAt = Date.now();
            z.isPendingSync = false;
          });
          count++;
        }
      } catch (error) {
        console.error(`Failed to migrate zone ${zone.id}:`, error);
      }
    }
  });
  return count;
}

/**
 * Migrate quick destinations to favorites table
 */
async function migrateQuickDestinations(destinations: any[]): Promise<number> {
  let count = 0;
  await database.write(async () => {
    for (const dest of destinations) {
      if (!dest?.coords) continue;
      try {
        // Check if destination already exists
        const existing = await database
          .get("favorites")
          .query(
            Q.where("latitude", dest.coords.lat),
            Q.where("longitude", dest.coords.lon)
          )
          .fetch();

        if (existing.length === 0) {
          await database.get("favorites").create((f: any) => {
            f.name = dest.label || dest.id || "Quick Destination";
            f.latitude = dest.coords.lat;
            f.longitude = dest.coords.lon;
            f.category = dest.type || "waypoint";
            f.notes = dest.icon || "";
            f.createdAt = Date.now();
            f.syncedAt = Date.now();
            f.isPendingSync = false;
          });
          count++;
        }
      } catch (error) {
        console.error(`Failed to migrate destination ${dest.id}:`, error);
      }
    }
  });
  return count;
}

/**
 * Migrate favorites to WatermelonDB
 */
async function migrateFavorites(favorites: any[]): Promise<number> {
  let count = 0;
  await database.write(async () => {
    for (const fav of favorites) {
      if (!fav.lat && !fav.latitude) continue;
      try {
        const lat = fav.lat || fav.latitude;
        const lon = fav.lon || fav.longitude || fav.lng;

        // Check if favorite already exists
        const existing = await database
          .get("favorites")
          .query(Q.where("latitude", lat), Q.where("longitude", lon))
          .fetch();

        if (existing.length === 0) {
          await database.get("favorites").create((f: any) => {
            f.name = fav.name || "Unnamed Favorite";
            f.latitude = lat;
            f.longitude = lon;
            f.category = fav.category || "waypoint";
            f.notes = fav.notes || "";
            f.createdAt = fav.createdAt
              ? new Date(fav.createdAt).getTime()
              : Date.now();
            f.syncedAt = Date.now();
            f.isPendingSync = false;
          });
          count++;
        }
      } catch (error) {
        console.error(`Failed to migrate favorite ${fav.id}:`, error);
      }
    }
  });
  return count;
}

/**
 * Migrate waste points to WatermelonDB
 */
async function migrateWastePoints(
  points: any[],
  source: string
): Promise<number> {
  let count = 0;
  await database.write(async () => {
    for (const point of points) {
      const lat = point.lat || point.latitude;
      const lon = point.lon || point.longitude || point.lng;
      if (!lat || !lon) continue;

      try {
        // Check if point already exists
        const existing = await database
          .get("waste_points")
          .query(Q.where("latitude", lat), Q.where("longitude", lon))
          .fetch();

        if (existing.length === 0) {
          await database.get("waste_points").create((w: any) => {
            w.externalId = point.id || `${source}_${Date.now()}_${Math.random()}`;
            w.latitude = lat;
            w.longitude = lon;
            w.type = point.type || "unknown";
            w.condition = point.condition || "unknown";
            w.address = point.address || "";
            w.collectionDay = point.collectionDay || point.collection_day || "";
            w.nextCollection = point.nextCollection
              ? new Date(point.nextCollection).getTime()
              : null;
            w.createdAt = Date.now();
            w.syncedAt = Date.now();
            w.isPendingSync = true; // Needs to sync to server
          });
          count++;
        }
      } catch (error) {
        console.error(`Failed to migrate waste point:`, error);
      }
    }
  });
  return count;
}

/**
 * Clear all migrated AsyncStorage data (use after successful migration)
 * Keeps keys that should remain in AsyncStorage (like preferences)
 */
export async function clearAsyncStorageData(): Promise<void> {
  const keysToClear = [
    ...Object.values(ZUSTAND_STORAGE_KEYS),
    ...Object.values(DIRECT_STORAGE_KEYS),
    "osm_import_timestamp",
    "osm_data",
  ].filter((key) => !KEEP_IN_ASYNC_STORAGE.includes(key as any));

  try {
    await AsyncStorage.multiRemove(keysToClear);
    console.log("Cleared migrated AsyncStorage keys");
  } catch (error) {
    console.error("Failed to clear AsyncStorage:", error);
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{
  version: number;
  isComplete: boolean;
  lastMigrationTime: number | null;
}> {
  try {
    const version = await AsyncStorage.getItem(MIGRATION_KEY);
    const parsedVersion = version ? parseInt(version, 10) : 0;

    return {
      version: parsedVersion,
      isComplete: parsedVersion >= CURRENT_MIGRATION_VERSION,
      lastMigrationTime: parsedVersion > 0 ? Date.now() : null,
    };
  } catch {
    return {
      version: 0,
      isComplete: false,
      lastMigrationTime: null,
    };
  }
}