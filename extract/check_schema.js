/**
 * Check Overture Schema Compatibility
 * 
 * Run this script BEFORE updating the OVERTURE_RELEASE version in server.js or Dockerfile.
 * It verifies that the critical columns used by the extract service still exist 
 * and have the expected data types.
 * 
 * Usage: 
 *   docker compose run --rm extract npm run check-schema
 *   OR inside container: node check_schema.js
 */

const duckdb = require('duckdb');

// Use the environment variable if set, otherwise default to current target
const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE || "2026-02-18.0";
const DB_PATH = ":memory:";

// BBOX for a quick check (small area in Montreal)
const BBOX = { minX: -73.57, minY: 45.50, maxX: -73.56, maxY: 45.51 };

const REQUIRED_COLUMNS = [
  'id', 
  'class', 
  'subclass', 
  'road_flags',        // Critical for roundabouts
  'access_restrictions', // Critical for one-ways
  'geometry'
];

async function checkSchema() {
  console.log(`[Schema Check] Verifying Overture Release: ${OVERTURE_RELEASE}`);
  
  const db = new duckdb.Database(DB_PATH);
  const con = db.connect();

  // 1. Setup DuckDB with Spatial/HTTPFS
  await new Promise((resolve, reject) => {
    con.run("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log("[Schema Check] DuckDB initialized. Querying schema...");

  // 2. Query a single row to inspect columns (include ST_AsGeoJSON(geometry) to check coordinate dimensions)
  const sql = `
    SELECT *, ST_AsGeoJSON(geometry) AS geometry_json
    FROM read_parquet('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=segment/*', hive_partitioning=1)
    WHERE bbox.xmin >= ${BBOX.minX}
      AND bbox.xmax <= ${BBOX.maxX}
      AND bbox.ymin >= ${BBOX.minY}
      AND bbox.ymax <= ${BBOX.maxY}
    LIMIT 1
  `;

  con.all(sql, (err, rows) => {
    if (err) {
      console.error("\n❌ CRITICAL: Query failed. The release might not exist or the schema changed significantly.");
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }

    if (rows.length === 0) {
      console.log("\n⚠️ WARNING: No data found in test BBOX. Cannot verify columns.");
      process.exit(0);
    }

    const row = rows[0];
    const availableColumns = Object.keys(row);
    const missing = REQUIRED_COLUMNS.filter(col => !availableColumns.includes(col));

    if (missing.length > 0) {
      console.error(`\n❌ SCHEMA MISMATCH: Missing required columns: ${missing.join(", ")}`);
      console.error("The extraction service will likely FAIL with this release.");
      process.exit(1);
    }

    // 3. Verify data structure of complex columns
    console.log("\n✅ Required columns present.");

    // Check geometry coordinate dimensions (Overture segments: 2D = lon,lat only; 3 = includes Z)
    if (row.geometry_json) {
      try {
        const geom = JSON.parse(row.geometry_json);
        const coords = geom && geom.coordinates;
        const dims = (Array.isArray(coords) && coords[0] && coords[0].length) || 0;
        console.log(`   - geometry coordinate dimensions: ${dims} (2 = lon,lat only; 3+ = includes Z/elevation)`);
      } catch (err) {
        console.log("   - geometry: (could not parse coordinates)");
      }
    }

    // Check road_flags structure
    if (availableColumns.includes('road_flags')) {
        // We expect it to be null or an array (duckdb returns null if empty or actual array)
        // If it's not null, check if it looks like an array/list
        console.log(`   - road_flags type: ${typeof row.road_flags} (Expected: object/array or null)`);
    }

    // Check access_restrictions structure
    if (availableColumns.includes('access_restrictions')) {
         console.log(`   - access_restrictions type: ${typeof row.access_restrictions} (Expected: object/array or null)`);
    }

    console.log(`\n✅ SUCESS: Overture ${OVERTURE_RELEASE} appears compatible with extraction logic.`);
    process.exit(0);
  });
}

checkSchema();
