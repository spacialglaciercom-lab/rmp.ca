/**
 * Minimal Overture extract service for rmp.ca.
 * WebSocket: accept { polygon }, respond with progress then complete + geojson_url.
 * HTTP: GET /geojson/:hash and GET /download/:hash return stored GeoJSON.
 */
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 9000;

// In-memory store: hash -> GeoJSON FeatureCollection (string)
const store = new Map();

function createHash() {
  return Math.random().toString(36).slice(2, 12);
}

const server = http.createServer((req, res) => {
  const url = req.url || "";
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
  ws.on("message", (data) => {
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

    // Progress (matches real webovertureextract flow so client UI is consistent)
    ws.send(JSON.stringify({ stage: "downloading", progress: 0 }));
    ws.send(JSON.stringify({ stage: "clipping", progress: 30 }));
    ws.send(JSON.stringify({ stage: "building_graph", progress: 70 }));

    // Generate mock GeoJSON data within the polygon bounds
    const features = [];
    const coords = polygon.coordinates[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // Calculate bounding box
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Generate random points
    for (let i = 0; i < 10; i++) {
      const lat = minY + Math.random() * (maxY - minY);
      const lon = minX + Math.random() * (maxX - minX);
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lon, lat]
        },
        properties: {
          id: `node-${i}`,
          type: "mock_node"
        }
      });
    }

    // Generate random mock road segments
    for (let i = 0; i < 5; i++) {
        const startLat = minY + Math.random() * (maxY - minY);
        const startLon = minX + Math.random() * (maxX - minX);
        const endLat = minY + Math.random() * (maxY - minY);
        const endLon = minX + Math.random() * (maxX - minX);
        features.push({
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: [
                    [startLon, startLat],
                    [endLon, endLat]
                ]
            },
            properties: {
                id: `way-${i}`,
                class: "residential"
            }
        });
    }

    const hash = createHash();
    const geojson = {
      type: "FeatureCollection",
      features: features,
    };
    store.set(hash, JSON.stringify(geojson));

    ws.send(
      JSON.stringify({
        stage: "complete",
        geojson_url: `/geojson/${hash}`,
        nodes: 10,
        edges: 5,
        segments: 5,
      })
    );
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Extract service listening on http://0.0.0.0:${PORT} (WS /ws/extract, GET /geojson/:hash, GET /download/:hash)`);
});
