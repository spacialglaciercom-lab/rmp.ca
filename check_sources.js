#!/usr/bin/env node
/**
 * check_sources.js — Verify Overture data source licensing/attribution.
 *
 * Queries a small BBOX and prints `sources` field from transportation segments
 * so you can confirm attribution requirements (OpenStreetMap, etc.) are met.
 *
 * Usage: node check_sources.js [release]
 */
const duckdb = require('duckdb');

const OVERTURE_RELEASE = process.argv[2] || process.env.OVERTURE_RELEASE || "2026-04-15.0";
const BBOX = { minX: -73.57, minY: 45.50, maxX: -73.56, maxY: 45.51 };

async function run() {
  console.log(`Checking Overture sources for release: ${OVERTURE_RELEASE}`);
  const db = new duckdb.Database(':memory:');
  const con = db.connect();

  await new Promise((resolve, reject) => {
    con.run(
      "INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';",
      (err) => { if (err) reject(err); else resolve(); }
    );
  });

  const sql = `
    SELECT id, sources
    FROM read_parquet(
      's3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=segment/*',
      hive_partitioning=1
    )
    WHERE bbox.xmin >= ${BBOX.minX} AND bbox.xmax <= ${BBOX.maxX}
      AND bbox.ymin >= ${BBOX.minY} AND bbox.ymax <= ${BBOX.maxY}
    LIMIT 5
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

      // Collect unique datasets
      const datasets = new Set();
      for (const row of rows) {
        if (Array.isArray(row.sources)) {
          for (const s of row.sources) {
            if (s.dataset) datasets.add(s.dataset);
          }
        }
      }

      console.log(`\nSegments sampled: ${rows.length}`);
      console.log(`Unique source datasets: ${[...datasets].join(', ') || '(none found)'}`);
      console.log('\nRaw sources:');
      console.log(JSON.stringify(rows, null, 2));

      if (datasets.has('OpenStreetMap')) {
        console.log('\nOpenStreetMap data detected — ODbL attribution required.');
      }

      resolve();
    });
  });
}

run().catch((e) => { console.error(e); process.exit(1); });
