const duckdb = require('duckdb');
const OVERTURE_RELEASE = "2026-04-15.0"; 
const BBOX = { minX: -73.57, minY: 45.50, maxX: -73.56, maxY: 45.51 };

async function run() {
  const db = new duckdb.Database(':memory:');
  const con = db.connect();
  await new Promise((resolve, reject) => {
    con.run("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';", (err) => {
       if(err) reject(err); else resolve();
    });
  });

  const sql = `
    SELECT
      id,
      sources
    FROM read_parquet('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=segment/*', hive_partitioning=1)
    WHERE bbox.xmin >= ${BBOX.minX} AND bbox.xmax <= ${BBOX.maxX}
      AND bbox.ymin >= ${BBOX.minY} AND bbox.ymax <= ${BBOX.maxY}
    LIMIT 2
  `;

  con.all(sql, (err, rows) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(rows, null, 2));
  });
}
run();
