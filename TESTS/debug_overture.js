const duckdb = require('duckdb');

const DB_PATH = ":memory:";
const OVERTURE_RELEASE = "2024-04-16.0"; // Or newer
const BBOX = { minX: -73.332, minY: 45.586, maxX: -73.330, maxY: 45.588 };

async function run() {
  const db = new duckdb.Database(DB_PATH);
  const con = db.connect();

  await new Promise((resolve, reject) => {
    con.run("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log("Querying Overture...");
  
  const sql = `
    SELECT
      id,
      names.primary AS name,
      class,
      subtype,
      subclass,
      access_restrictions,
      road_surface,
      ST_AsText(geometry) as wkt
    FROM read_parquet('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=segment/*', hive_partitioning=1)
    WHERE bbox.xmin >= ${BBOX.minX}
      AND bbox.xmax <= ${BBOX.maxX}
      AND bbox.ymin >= ${BBOX.minY}
      AND bbox.ymax <= ${BBOX.maxY}
    LIMIT 20
  `;

  con.all(sql, (err, rows) => {
    if (err) {
      console.error(err);
    } else {
      console.log(JSON.stringify(rows, null, 2));
    }
  });
}

run();
