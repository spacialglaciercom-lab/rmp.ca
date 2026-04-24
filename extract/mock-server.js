/**
 * Mock extract service for local development
 * This replaces the DuckDB-based service for testing purposes
 */
const http = require('http');
const { WebSocketServer } = require('ws');
const PORT = Number(process.env.PORT) || 9000;

// In-memory store: hash -> GeoJSON string
const store = new Map();

function createHash() {
  return Math.random().toString(36).slice(2, 12);
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname.startsWith('/geojson/')) {
    const hash = url.pathname.split('/')[2];
    const geojson = store.get(hash);
    
    if (geojson) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(geojson);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } else if (url.pathname.startsWith('/download/')) {
    const hash = url.pathname.split('/')[2];
    const geojson = store.get(hash);
    
    if (geojson) {
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="extract-${hash}.geojson"`
      });
      res.end(geojson);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('[WS] Received:', data);
      
      // Generate a mock GeoJSON response
      const hash = createHash();
      const mockGeoJSON = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              road_class: 'residential',
              one_way: false,
              access_restrictions: []
            },
            geometry: {
              type: 'LineString',
              coordinates: [
                [-79.428488, 43.643943],
                [-79.427488, 43.643943],
                [-79.426488, 43.643943]
              ]
            }
          }
        ]
      });
      
      // Store the result
      store.set(hash, mockGeoJSON);
      
      // Send response
      ws.send(JSON.stringify({
        hash,
        geojson: mockGeoJSON,
        stats: {
          road_km: 0.3,
          nodes: 4,
          edges: 3,
          one_way_km: 0,
          two_way_km: 0.3
        }
      }));
      
    } catch (error) {
      console.error('[WS] Error:', error);
      ws.send(JSON.stringify({ error: 'Invalid request' }));
    }
  });
  
  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`[Mock Extract] Server running on http://localhost:${PORT}`);
  console.log(`[Mock Extract] WebSocket available at ws://localhost:${PORT}/ws/extract`);
});