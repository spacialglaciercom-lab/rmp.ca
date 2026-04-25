/**
 * Overture Maps extract service for rmp.ca.
 *
 * Queries real Overture transportation data from S3 Parquet via DuckDB,
 * clips to the user's polygon, builds a simple road network graph,
 * and returns GeoJSON + stats.
 *
 * WebSocket: /ws/extract  — accepts { polygon, theme }
 * HTTP:      GET /geojson/:hash, GET /download/:hash
 */
const http = require("http");
const { WebSocketServer } = require("ws");
const duckdb = require("duckdb");
const path = require("path");

const PORT = Number(process.env.PORT) || 9000;

/**
 * CAUTION: Overture Maps schema changes frequently.
 * Before updating this release version, run `node check_schema.js` 
 * to ensure `road_flags` and `access_restrictions` columns still exist.
 * Broken schema = Broken routing (loops/wrong directions).
 */
const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE || "2026-04-15.0";

const ROAD_CLASSES = [
  "residential",
  "tertiary",
  "secondary",
  "primary",
  "trunk",
  "motorway",
  "unclassified",
  "living_street",
  "service",
  "secondary_link",
  "primary_link",
  "trunk_link",
  "motorway_link",
];

const ROAD_CLASSES_SQL = ROAD_CLASSES.map((c) => `'${c}'`).join(",");

// In-memory store: hash -> GeoJSON string
const store = new Map();

function createHash() {
  return Math.random().toString(36).slice(2, 12);
}

// ---------------------------------------------------------------------------
// DuckDB singleton (in-memory, with spatial + httpfs)
// ---------------------------------------------------------------------------
let db = null;
let dbReady = false;
let dbInitPromise = null;

function getDB() {
  if (dbInitPromise) return dbInitPromise;
  dbInitPromise = new Promise((resolve, reject) => {
    db = new duckdb.Database(":memory:", (err) => {
      if (err) return reject(err);
      const con = db.connect();
      con.run("INSTALL spatial; LOAD spatial;", (err) => {
        if (err) console.warn("[DuckDB] spatial install:", err.message);
        con.run("INSTALL httpfs; LOAD httpfs;", (err) => {
          if (err) console.warn("[DuckDB] httpfs install:", err.message);
          con.run("SET s3_region='us-west-2';", (err) => {
            if (err) console.warn("[DuckDB] s3 region:", err.message);
            dbReady = true;
            console.log("[DuckDB] Ready (spatial + httpfs + S3)");
            resolve(db);
          });
        });
      });
    });
  });
  return dbInitPromise;
}

// ---------------------------------------------------------------------------
// Run a DuckDB query, return rows as objects
// ---------------------------------------------------------------------------
function queryAll(sql) {
  return new Promise(async (resolve, reject) => {
    const database = await getDB();
    const con = database.connect();
    con.all(sql, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ---------------------------------------------------------------------------
// Compute bounding box from polygon coordinates
// ---------------------------------------------------------------------------
function bboxFromPolygon(coords) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Build a simple road network graph from LineString features
// ---------------------------------------------------------------------------
function buildGraph(features) {
  const nodeMap = new Map(); // "lon,lat" -> nodeId
  let nextNodeId = 0;
  const edges = [];

  // Overture segment geometry is 2D LineString (lon, lat) per schema; no Z/elevation in nodes.
  function getNodeId(lon, lat) {
    // Snap to ~1m precision to merge nearby endpoints
    const key = `${lon.toFixed(6)},${lat.toFixed(6)}`;
    if (nodeMap.has(key)) return nodeMap.get(key);
    const id = nextNodeId++;
    nodeMap.set(key, id);
    return id;
  }

  for (const f of features) {
    if (f.geometry.type !== "LineString") continue;
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];
    // Use first two elements only (lon, lat); Overture segments are 2D per schema
    const u = getNodeId(startCoord[0], startCoord[1]);
    const v = getNodeId(endCoord[0], endCoord[1]);
    edges.push({ u, v, feature: f });
  }

  return { nodeCount: nodeMap.size, edgeCount: edges.length, edges };
}

// ---------------------------------------------------------------------------
// Extract real Overture data for a polygon
// ---------------------------------------------------------------------------
async function extractOverture(polygon, ws, theme) {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 3) throw new Error("Polygon must have ≥3 vertices");

  const { minX, minY, maxX, maxY } = bboxFromPolygon(ring);
  const wkt = `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(", ")}))`;

  // Stage 1: Download segments from S3
  ws.send(JSON.stringify({ stage: "downloading", progress: 0 }));
  console.log(`[Extract] Querying segments bbox=[${minX.toFixed(4)},${minY.toFixed(4)},${maxX.toFixed(4)},${maxY.toFixed(4)}]`);

  const segmentSQL = `
    SELECT
      id,
      names.primary AS name,
      subtype,
      class,
      subclass,
      access_restrictions,
      road_flags,
      sources,
      ST_AsGeoJSON(geometry) AS geometry_json,
      road_surface[1].value AS surface
    FROM read_parquet(
      's3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=segment/*',
      hive_partitioning=1
    )
    WHERE bbox.xmin >= ${minX}
      AND bbox.xmax <= ${maxX}
      AND bbox.ymin >= ${minY}
      AND bbox.ymax <= ${maxY}
      AND class IN (${ROAD_CLASSES_SQL})
      AND ST_Intersects(geometry, ST_GeomFromText('${wkt}'))
  `;

  let segments;
  try {
    segments = await queryAll(segmentSQL);
  } catch (err) {
    console.error("[Extract] Segment query failed:", err.message);
    throw new Error(`Overture query failed: ${err.message}`);
  }
  console.log(`[Extract] Segments from S3: ${segments.length}`);

  // Check whether Overture segment geometry includes Z (elevation). Schema/docs use 2D LineString.
  let coordDims = null;
  for (const row of segments) {
    try {
      const g = JSON.parse(row.geometry_json);
      const coords = g?.coordinates;
      if (Array.isArray(coords) && coords.length > 0 && Array.isArray(coords[0])) {
        coordDims = coords[0].length;
        break;
      }
    } catch (_) {}
  }
  if (coordDims !== null) {
    console.log(`[Extract] Overture segment coordinate dimensions: ${coordDims} (2=lon,lat only; 3+=includes Z/elevation)`);
  }

  // Stage 2: Clip to exact polygon
  ws.send(JSON.stringify({ stage: "clipping", progress: 30 }));

  const features = [];
  for (const row of segments) {
    let geom;
    try {
      geom = JSON.parse(row.geometry_json);
    } catch {
      continue;
    }
    const props = {};
    if (row.id) props.id = row.id;
    if (row.name) props.name = row.name;
    if (row.class) props.class = row.class;
    if (row.subtype) props.subtype = row.subtype;
    if (row.subclass) props.subclass = row.subclass;
    if (row.surface) props.surface = row.surface;

    // Extract OSM Way ID from sources
    // Overture sources format: [{ dataset: 'OpenStreetMap', record_id: 'w12345@1' }]
    if (Array.isArray(row.sources)) {
      const osmSource = row.sources.find(s => s.dataset === 'OpenStreetMap');
      if (osmSource && osmSource.record_id) {
        // record_id often looks like 'w12345@1', we want '12345'
        // Regex: matches (node|way|relation)? followed by digits
        const match = osmSource.record_id.match(/w(\d+)/); 
        if (match) {
            props.osm_id = match[1];
        }
      }
    }

    // --- ONEWAY & ROUNDABOUT LOGIC (Updated for Overture 2026-04-15) ---
    
    let isRoundabout = false;
    // Check road_flags for 'is_roundabout'
    if (Array.isArray(row.road_flags)) {
      for (const rf of row.road_flags) {
        if (rf.values && Array.isArray(rf.values)) {
          if (rf.values.includes("is_roundabout") || rf.values.includes("roundabout")) {
            isRoundabout = true;
          }
        }
      }
    }
    // Fallback check on subclass
    if (row.subclass === "roundabout" || row.class === "roundabout") {
      isRoundabout = true;
    }

    if (isRoundabout) {
      props.junction = "roundabout";
      // Assume one-way for roundabouts unless restricted otherwise (though usually implied)
    }

    // Check access_restrictions for one-way rules
    let oneway = null;
    if (Array.isArray(row.access_restrictions)) {
      for (const rule of row.access_restrictions) {
        if (rule.access_type === "denied" && rule.when) {
          const h = rule.when.heading;
          const mode = rule.when.mode;
          // Apply if mode is unset (all) or explicitly includes motor_vehicle
          const applies = !mode || (Array.isArray(mode) && mode.includes("motor_vehicle"));
          
          if (applies && h) {
            if (h === "backward") oneway = "yes";
            else if (h === "forward") oneway = "-1";
          }
        }
      }
    }

    if (oneway) {
      props.oneway = oneway;
    } else {
      // Retain heuristic fallbacks if no explicit restriction found
      if (row.class && row.class.endsWith("_link")) props.oneway = "yes";
      if (row.class === "motorway" || row.class === "trunk") props.oneway = "yes";
      // If inferred as roundabout but no explicit restriction, ensure one-way
      if (isRoundabout) props.oneway = "yes"; 
    }

    features.push({ type: "Feature", geometry: geom, properties: props });
  }

  // Also fetch connectors (intersection points)
  let connectors = [];
  try {
    const connectorSQL = `
      SELECT
        id,
        ST_AsGeoJSON(geometry) AS geometry_json
      FROM read_parquet(
        's3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=transportation/type=connector/*',
        hive_partitioning=1
      )
      WHERE bbox.xmin >= ${minX}
        AND bbox.xmax <= ${maxX}
        AND bbox.ymin >= ${minY}
        AND bbox.ymax <= ${maxY}
    `;
    connectors = await queryAll(connectorSQL);
    console.log(`[Extract] Connectors from S3: ${connectors.length}`);
  } catch (err) {
    console.warn("[Extract] Connector query failed (non-fatal):", err.message);
  }

  for (const row of connectors) {
    let geom;
    try {
      geom = JSON.parse(row.geometry_json);
    } catch {
      continue;
    }
    features.push({
      type: "Feature",
      geometry: geom,
      properties: { id: row.id, type: "connector" },
    });
  }

  // Stage 3: Build graph
  ws.send(JSON.stringify({ stage: "building_graph", progress: 70 }));

  const lineFeatures = features.filter((f) => f.geometry.type === "LineString");
  const pointFeatures = features.filter((f) => f.geometry.type === "Point");
  const graph = buildGraph(lineFeatures);

  console.log(
    `[Extract] Result: ${features.length} features (${lineFeatures.length} roads, ${pointFeatures.length} connectors), graph: ${graph.nodeCount} nodes, ${graph.edgeCount} edges`
  );

  const geojson = { type: "FeatureCollection", features };
  return {
    geojson,
    nodes: graph.nodeCount,
    edges: graph.edgeCount,
    segments: lineFeatures.length,
  };
}

// ---------------------------------------------------------------------------
// HTTP server (GeoJSON retrieval)
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = req.url || "";

  // Health check
  if (req.method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", release: OVERTURE_RELEASE, duckdb: dbReady }));
    return;
  }

  const geojsonMatch = url.match(/^\/geojson\/([^/]+)$/);
  const downloadMatch = url.match(/^\/download\/([^/]+)$/);

  if (req.method === "GET" && geojsonMatch) {
    const hash = geojsonMatch[1];
    const body = store.get(hash);
    if (body) {
      res.writeHead(200, { "Content-Type": "application/geo+json" });
      res.end(body);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
    return;
  }

  if (req.method === "GET" && downloadMatch) {
    const hash = downloadMatch[1];
    const body = store.get(hash);
    if (body) {
      res.writeHead(200, {
        "Content-Type": "application/geo+json",
        "Content-Disposition": `attachment; filename="extract-${hash}.geojson"`,
      });
      res.end(body);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

// ---------------------------------------------------------------------------
// WebSocket (extraction)
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url || "", "http://localhost").pathname;
  if (pathname !== "/ws/extract") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ stage: "error", error: "Invalid JSON" }));
      return;
    }

    const polygon = msg?.polygon;
    if (!polygon || !polygon.coordinates) {
      ws.send(JSON.stringify({ stage: "error", error: "Missing polygon" }));
      return;
    }

    const theme = msg?.theme || "roads";
    console.log(`[Extract] New request: theme=${theme}, vertices=${polygon.coordinates[0]?.length || 0}`);

    try {
      const result = await extractOverture(polygon, ws, theme);
      const hash = createHash();
      store.set(hash, JSON.stringify(result.geojson));

      // Evict old entries if store gets large (keep last 50)
      if (store.size > 50) {
        const oldest = store.keys().next().value;
        store.delete(oldest);
      }

      ws.send(
        JSON.stringify({
          stage: "complete",
          geojson_url: `/geojson/${hash}`,
          nodes: result.nodes,
          edges: result.edges,
          segments: result.segments,
        })
      );
      console.log(`[Extract] Complete: hash=${hash} nodes=${result.nodes} edges=${result.edges} segments=${result.segments}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Extract] Error:", message);
      ws.send(JSON.stringify({ stage: "error", error: message }));
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// Pre-initialize DuckDB so first request is faster
getDB()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Extract service listening on http://0.0.0.0:${PORT} (WS /ws/extract, GET /geojson/:hash, GET /download/:hash)`
      );
      console.log(`Overture release: ${OVERTURE_RELEASE}`);
      console.log(`Road classes: ${ROAD_CLASSES.join(", ")}`);
    });
  })
  .catch((err) => {
    console.error("[Extract] DuckDB init failed:", err);
    process.exit(1);
  });
