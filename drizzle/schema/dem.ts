/**
 * Drizzle ORM Schema for DEM (Digital Elevation Model) Data
 * 
 * Stores metadata about imported ASTER GDEM granules and provides
 * efficient spatial queries for elevation data.
 * 
 * @see https://postgis.net/docs/using_raster_dataman.html
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  doublePrecision,
  integer,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================================
// Custom Types
// ============================================================================

/**
 * PostGIS Raster type (stored as binary in PostGIS)
 */
const raster = customType<{
  data: Buffer;
  driverData: string;
}>({
  dataType() {
    return "raster";
  },
});

/**
 * PostGIS Geometry type for spatial columns
 */
const geometry = (type: string, srid: number = 4326) =>
  customType<{
    data: string;
    driverData: string;
  }>({
    dataType() {
      return `geometry(${type}, ${srid})`;
    },
  });

// ============================================================================
// DEM Granule Metadata Table
// ============================================================================

/**
 * Tracks imported ASTER GDEM granules
 * 
 * This table stores metadata about each imported granule to avoid
 * re-downloading and to track coverage.
 */
export const demGranules = pgTable(
  "dem_granules",
  {
    id: serial("id").primaryKey(),
    
    /** NASA CMR Granule ID */
    granuleId: text("granule_id").notNull().unique(),
    
    /** Granule title from CMR */
    title: text("title").notNull(),
    
    /** Producer granule ID */
    producerGranuleId: text("producer_granule_id"),
    
    /** Local file path where data was downloaded */
    localPath: text("local_path"),
    
    /** File format (GeoTIFF, NetCDF, etc.) */
    format: text("format").default("GeoTIFF"),
    
    /** File size in bytes */
    fileSize: integer("file_size"),
    
    /** Checksum value */
    checksum: text("checksum"),
    
    /** Checksum algorithm (MD5, SHA256, etc.) */
    checksumType: text("checksum_type"),
    
    /** Bounding box of coverage (WGS84) */
    minLon: doublePrecision("min_lon").notNull(),
    minLat: doublePrecision("min_lat").notNull(),
    maxLon: doublePrecision("max_lon").notNull(),
    maxLat: doublePrecision("max_lat").notNull(),
    
    /** Geometry of coverage area */
    coverageGeom: geometry("Polygon", 4326)("coverage_geom"),
    
    /** Minimum elevation in this granule (meters) */
    minElevation: doublePrecision("min_elevation"),
    
    /** Maximum elevation in this granule (meters) */
    maxElevation: doublePrecision("max_elevation"),
    
    /** Number of raster tiles loaded */
    tileCount: integer("tile_count").default(0),
    
    /** Temporal extent start */
    temporalStart: timestamp("temporal_start"),
    
    /** Temporal extent end */
    temporalEnd: timestamp("temporal_end"),
    
    /** Import status */
    status: text("status", { enum: ["pending", "processing", "completed", "failed"] })
      .default("pending")
      .notNull(),
    
    /** Error message if import failed */
    errorMessage: text("error_message"),
    
    /** Additional metadata from CMR */
    metadata: jsonb("metadata").$type<{
      dataLinks: string[];
      metadataLinks: string[];
      processingLevel: string;
      platform: string;
      instrument: string;
    }>(),
    
    /** When this granule was imported */
    importedAt: timestamp("imported_at").defaultNow(),
    
    /** When this record was last updated */
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    granuleIdIdx: index("dem_granules_granule_id_idx").on(table.granuleId),
    producerGranuleIdIdx: index("dem_granules_producer_id_idx").on(table.producerGranuleId),
    statusIdx: index("dem_granules_status_idx").on(table.status),
    coverageIdx: index("dem_granules_coverage_idx").on(table.coverageGeom),
    importedAtIdx: index("dem_granules_imported_at_idx").on(table.importedAt),
  })
);

// ============================================================================
// DEM Elevation Tiles Table
// ============================================================================

/**
 * Stores raster tiles for elevation data
 * 
 * This table is populated by raster2pgsql and queried by spatial functions.
 * Each row represents a tile (typically 100x100 pixels) of the DEM.
 */
export const demElevation = pgTable(
  "dem_elevation",
  {
    /** Auto-increment primary key */
    rid: serial("rid").primaryKey(),
    
    /** Raster tile data */
    rast: raster("rast").notNull(),
    
    /** Foreign key to source granule */
    granuleId: integer("granule_id").references(() => demGranules.id),
    
    /** When this tile was imported */
    importedAt: timestamp("imported_at").defaultNow(),
  },
  (table) => ({
    granuleIdIdx: index("dem_elevation_granule_id_idx").on(table.granuleId),
    importedAtIdx: index("dem_elevation_imported_at_idx").on(table.importedAt),
  })
);

// ============================================================================
// Elevation Query Cache Table
// ============================================================================

/**
 * Caches elevation query results for frequently accessed routes
 * 
 * This improves performance for repeated queries along the same routes.
 */
export const elevationCache = pgTable(
  "elevation_cache",
  {
    id: serial("id").primaryKey(),
    
    /** Hash of the query parameters */
    queryHash: text("query_hash").notNull().unique(),
    
    /** Query type (point, linestring, geofence) */
    queryType: text("query_type", { enum: ["point", "linestring", "geofence"] }).notNull(),
    
    /** Input geometry as WKT */
    inputGeom: text("input_geom").notNull(),
    
    /** Cached result as JSON */
    result: jsonb("result").notNull().$type<{
      elevations: number[];
      distances?: number[];
      minElevation?: number;
      maxElevation?: number;
      avgElevation?: number;
      totalAscent?: number;
      totalDescent?: number;
    }>(),
    
    /** When this cache entry was created */
    createdAt: timestamp("created_at").defaultNow(),
    
    /** When this cache entry expires */
    expiresAt: timestamp("expires_at"),
  },
  (table) => ({
    queryHashIdx: index("elevation_cache_query_hash_idx").on(table.queryHash),
    createdAtIdx: index("elevation_cache_created_at_idx").on(table.createdAt),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const demGranulesRelations = relations(demGranules, ({ many }) => ({
  tiles: many(demElevation),
}));

export const demElevationRelations = relations(demElevation, ({ one }) => ({
  granule: one(demGranules, {
    fields: [demElevation.granuleId],
    references: [demGranules.id],
  }),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type DemGranule = typeof demGranules.$inferSelect;
export type NewDemGranule = typeof demGranules.$inferInsert;
export type DemElevationTile = typeof demElevation.$inferSelect;
export type NewDemElevationTile = typeof demElevation.$inferInsert;
export type ElevationCacheEntry = typeof elevationCache.$inferSelect;
export type NewElevationCacheEntry = typeof elevationCache.$inferInsert;