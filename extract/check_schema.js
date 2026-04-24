#!/usr/bin/env node
/**
 * check_schema.js — Verify Overture Maps transportation schema columns.
 *
 * Before updating OVERTURE_RELEASE in server.js, run this to confirm that
 * `road_flags` and `access_restrictions` columns still exist in the new release.
 * Broken schema = broken routing (loops/wrong directions).
 *
 * Usage: node check_schema.js [release]
 *   e.g. node check_schema.js 2026-02-18.0
 */
const duckdb = require('duckdb');

const OVERTURE_RELEASE = process.argv[2] || process.env.OVERTURE_RELEASE || "2026-02-18.0";
const BBOX = { minX: -73.57, minY: 45.50, maxX: -73.56, maxY: 45.51 };

const REQUIRED_COLUMNS = [
  'id', 'names', 'subtype', 'class', 'subclass',
  'access_restrictions', 'road_flags', 'sources', 'geometry',
  'road_surface',
];

async function run() {
  console.log(`Checking Overture schema for release: ${OVERTURE_RELEASE}`);
  const db = new duckdb.Database(':memory:');
  const con = db.connect();

  await new Promise((resolve, reject) => {
    con.run(
      "INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';",
      (err) => { if (err) reject(err); else resolve(); }
    );
  });

  const sql = `
    SELECT *
    FROM read_parquet(
      's3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=segment/*',
      hive_partitioning=1
    )
    WHERE bbox.xmin >= ${BBOX.minX} AND bbox.xmax <= ${BBOX.maxX}
      AND bbox.ymin >= ${BBOX.minY} AND bbox.ymax <= ${BBOX.maxY}
    LIMIT 1
  `;

  return new Promise((resolve) => {
    con.all(sql, (err, rows) => {
      if (err) {
        console.error('Query failed:', err.message);
        process.exit(1);
      }
      if (!rows || rows.length === 0) {
        console.error('No rows returned — check BBOX or release version.');
        process.exit(1);
      }

      const columns = Object.keys(rows[0]);
      console.log(`Columns found (${columns.length}):`, columns.join(', '));

      const missing = REQUIRED_COLUMNS.filter(c => !columns.includes(c));
      if (missing.length > 0) {
        console.error(`\nMISSING COLUMNS: ${missing.join(', ')}`);
        console.error('DO NOT update OVERTURE_RELEASE in server.js until these are resolved.');
        process.exit(1);
      } else {
        console.log(`\nAll ${REQUIRED_COLUMNS.length} required columns present. Schema is compatible.`);
      }

      // Show sample road_flags and access_restrictions
      const row = rows[0];
      console.log('\nSample road_flags:', JSON.stringify(row.road_flags));
      console.log('Sample access_restrictions:', JSON.stringify(row.access_restrictions));

      resolve();
    });
  });
}

run().catch((e) => { console.error(e); process.exit(1); });
