#!/usr/bin/env tsx
/**
 * DEM Data Fetcher Script
 * 
 * Fetches ASTER GDEM data from NASA Earthdata and loads it into PostGIS.
 * 
 * Usage:
 *   pnpm run fetch-dem --bbox="-73.9,45.4,-73.5,45.7" --max-granules=5
 *   pnpm run fetch-dem --granule="ASTGTMV003_N45W074"
 * 
 * Environment Variables:
 *   EARTHDATA_BEARER_TOKEN - NASA Earthdata Bearer token (required)
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   DEM_DOWNLOAD_DIR - Directory for temporary downloads (default: /tmp/earthdata)
 */

import { parseArgs } from "util";
import { EarthdataService, getEarthdataService, type BoundingBox } from "../services/earthdataService";
import { db } from "../server/db";
import { demGranules } from "../drizzle/schema/dem";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const { values } = parseArgs({
  options: {
    "bounding-box": {
      type: "string",
      short: "b",
    },
    "granule": {
      type: "string",
      short: "g",
    },
    "max-granules": {
      type: "string",
      short: "m",
      default: "10",
    },
    "tile-size": {
      type: "string",
      short: "t",
      default: "100x100",
    },
    "overwrite": {
      type: "boolean",
      short: "o",
      default: false,
    },
    "dry-run": {
      type: "boolean",
      default: false,
    },
    "verbose": {
      type: "boolean",
      short: "v",
      default: false,
    },
    "help": {
      type: "boolean",
      short: "h",
      default: false,
    },
  },
  strict: true,
});

// ============================================================================
// Help
// ============================================================================

if (values.help) {
  console.log(`
DEM Data Fetcher - Fetch ASTER GDEM data from NASA Earthdata

Usage:
  pnpm run fetch-dem --bbox="-73.9,45.4,-73.5,45.7"
  pnpm run fetch-dem --granule="ASTGTMV003_N45W074"

Options:
  -b, --bounding-box <bbox>    Bounding box as "min_lon,min_lat,max_lon,max_lat"
  -g, --granule <id>           Specific granule ID to download
  -m, --max-granules <n>       Maximum granules to download (default: 10)
  -t, --tile-size <size>      Raster tile size (default: 100x100)
  -o, --overwrite              Overwrite existing data
  --dry-run                    Show what would be done without downloading
  -v, --verbose                Verbose output
  -h, --help                   Show this help message

Environment Variables:
  EARTHDATA_BEARER_TOKEN       NASA Earthdata Bearer token (required)
  DATABASE_URL                 PostgreSQL connection string (required)
  DEM_DOWNLOAD_DIR             Directory for temporary downloads

Examples:
  # Fetch DEM for Montreal area
  pnpm run fetch-dem --bbox="-73.9,45.4,-73.5,45.7"

  # Fetch specific granule
  pnpm run fetch-dem --granule="ASTGTMV003_N45W074"

  # Dry run to see what would be fetched
  pnpm run fetch-dem --bbox="-73.9,45.4,-73.5,45.7" --dry-run --verbose
`);
  process.exit(0);
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  const verbose = values.verbose;
  const dryRun = values["dry-run"];

  // Validate environment
  const bearerToken = process.env.EARTHDATA_BEARER_TOKEN;
  if (!bearerToken) {
    console.error("Error: EARTHDATA_BEARER_TOKEN not set");
    console.error("Get a token from https://urs.earthdata.nasa.gov/");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL not set");
    process.exit(1);
  }

  // Parse bounding box
  let bbox: BoundingBox | undefined;
  if (values["bounding-box"]) {
    const parts = values["bounding-box"].split(",").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      console.error("Error: Invalid bounding box format. Use: min_lon,min_lat,max_lon,max_lat");
      process.exit(1);
    }
    bbox = {
      minLon: parts[0],
      minLat: parts[1],
      maxLon: parts[2],
      maxLat: parts[3],
    };
  }

  // Initialize service
  const service = getEarthdataService(bearerToken);

  try {
    // Search for granules
    let granules;
    if (values.granule) {
      // Search for specific granule
      if (verbose) console.log(`Searching for granule: ${values.granule}`);
      
      // Use a global bbox to find the granule, but limit results
      granules = await service.searchAsterGdem(
        { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
        { maxResults: 100 }
      );
      
      granules = granules.filter(g => 
        g.id.includes(values.granule!) || 
        g.producerGranuleId.includes(values.granule!)
      );
      
      if (granules.length === 0) {
        console.error(`Error: Granule "${values.granule}" not found`);
        process.exit(1);
      }
    } else if (bbox) {
      // Search by bounding box
      if (verbose) {
        console.log(`Searching for granules in bbox: ${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`);
      }
      
      granules = await service.searchAsterGdem(bbox, {
        maxResults: parseInt(values["max-granules"]!, 10),
      });
    } else {
      console.error("Error: Either --bbox or --granule must be specified");
      process.exit(1);
    }

    console.log(`Found ${granules.length} granule(s)`);

    if (dryRun) {
      console.log("\nGranules found:");
      for (const g of granules) {
        console.log(`  - ${g.title}`);
        console.log(`    ID: ${g.id}`);
        console.log(`    Size: ${(g.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`    BBox: ${g.boundingBox.minLon},${g.boundingBox.minLat},${g.boundingBox.maxLon},${g.boundingBox.maxLat}`);
      }
      console.log("\nDry run complete. No data downloaded.");
      process.exit(0);
    }

    // Check which granules are already imported
    const existingGranules = await db
      .select({ granuleId: demGranules.granuleId })
      .from(demGranules)
      .where(eq(demGranules.status, "completed"));

    const existingIds = new Set(existingGranules.map(g => g.granuleId));

    // Filter out already imported granules (unless overwrite)
    const toDownload = values.overwrite 
      ? granules 
      : granules.filter(g => !existingIds.has(g.id));

    if (toDownload.length === 0) {
      console.log("All granules already imported. Use --overwrite to re-import.");
      process.exit(0);
    }

    console.log(`\nDownloading ${toDownload.length} granule(s)...`);

    // Download and process each granule
    for (const granule of toDownload) {
      console.log(`\n[${granule.id}] Processing: ${granule.title}`);

      try {
        // Create database record
        const [dbRecord] = await db.insert(demGranules).values({
          granuleId: granule.id,
          title: granule.title,
          producerGranuleId: granule.producerGranuleId,
          format: granule.format,
          fileSize: granule.size,
          checksum: granule.checksum,
          checksumType: granule.checksumType,
          minLon: granule.boundingBox.minLon,
          minLat: granule.boundingBox.minLat,
          maxLon: granule.boundingBox.maxLon,
          maxLat: granule.boundingBox.maxLat,
          temporalStart: granule.temporalExtent.startDate 
            ? new Date(granule.temporalExtent.startDate) 
            : null,
          temporalEnd: granule.temporalExtent.endDate 
            ? new Date(granule.temporalExtent.endDate) 
            : null,
          status: "processing",
          metadata: {
            dataLinks: granule.dataLinks,
            metadataLinks: granule.metadataLinks,
            processingLevel: "Level 3",
            platform: "Terra",
            instrument: "ASTER",
          },
        }).returning();

        // Download granule
        console.log(`  Downloading...`);
        const downloadResult = await service.downloadGranule(granule, {
          onProgress: (progress) => {
            if (verbose && progress.total > 0) {
              const percent = ((progress.downloaded / progress.total) * 100).toFixed(1);
              process.stdout.write(`\r  Progress: ${percent}%`);
            }
          },
        });
        console.log(`\n  Downloaded: ${downloadResult.localPath}`);

        // Update record with local path
        await db
          .update(demGranules)
          .set({ localPath: downloadResult.localPath })
          .where(eq(demGranules.id, dbRecord.id));

        // Process and load into PostGIS
        console.log(`  Processing and loading into PostGIS...`);
        const processingResult = await service.processAndLoadToPostgis(downloadResult, {
          tableName: "dem_elevation",
          tileSize: values["tile-size"],
          overwrite: values.overwrite,
        });

        // Update record with processing results
        await db
          .update(demGranules)
          .set({
            status: "completed",
            tileCount: processingResult.tilesLoaded,
            minElevation: processingResult.minElevation,
            maxElevation: processingResult.maxElevation,
            updatedAt: new Date(),
          })
          .where(eq(demGranules.id, dbRecord.id));

        console.log(`  Loaded ${processingResult.tilesLoaded} tiles`);
        console.log(`  Elevation range: ${processingResult.minElevation.toFixed(1)}m - ${processingResult.maxElevation.toFixed(1)}m`);

        // Clean up downloaded file
        if (downloadResult.localPath) {
          await fs.unlink(downloadResult.localPath).catch(() => {});
        }

      } catch (error) {
        console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
        
        // Update record with error
        await db
          .update(demGranules)
          .set({
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            updatedAt: new Date(),
          })
          .where(eq(demGranules.granuleId, granule.id));
      }
    }

    console.log("\nDone!");

    // Show summary
    const completed = await db
      .select()
      .from(demGranules)
      .where(eq(demGranules.status, "completed"));

    console.log(`\nTotal granules imported: ${completed.length}`);
    
    if (completed.length > 0) {
      const totalTiles = completed.reduce((sum, g) => sum + (g.tileCount || 0), 0);
      console.log(`Total tiles loaded: ${totalTiles}`);
    }

  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});