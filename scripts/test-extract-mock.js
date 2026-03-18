const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:9000/ws/extract');

ws.on('open', () => {
  console.log('Connected to extract service');
  const polygon = {
    type: 'Polygon',
    coordinates: [[
      [-73.56, 45.48],
      [-73.57, 45.48],
      [-73.57, 45.49],
      [-73.56, 45.49],
      [-73.56, 45.48]
    ]]
  };
  ws.send(JSON.stringify({ polygon }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('Received:', msg);
  if (msg.stage === 'complete') {
    console.log('Extraction complete. GeoJSON URL:', msg.geojson_url);
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
  process.exit(1);
});
