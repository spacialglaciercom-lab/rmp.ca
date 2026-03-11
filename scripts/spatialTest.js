const { spatialQueryService } = require("../services/spatialQueryService");

(async () => {
  const results = await spatialQueryService.spatialQuery(`
    SELECT ST_Distance(geom, ST_MakePoint(40.7128, -74.0060))
    FROM street_edges
    LIMIT 5
  `);

  console.log("Spatial Query Results:", results);
})();
