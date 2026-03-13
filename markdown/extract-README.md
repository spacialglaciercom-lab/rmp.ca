# Overture Extract Service

Overture extract is part of the **rmp.ca** repo. It provides a WebSocket + HTTP API used by the app’s **Extract** tab to turn a drawn polygon into road-network GeoJSON from Overture Maps.

## API contract

- **WebSocket** `ws://host/ws/extract` (or same path on wss):
  - Client sends: `{ "polygon": <GeoJSON Polygon geometry> }`.
  - Server sends progress: `{ "stage": "downloading"|"clipping"|"building_graph", "progress"?: number }`.
  - On success: `{ "stage": "complete", "geojson_url": "/geojson/<hash>", "nodes": number, "edges": number, "segments": number }`.
  - On error: `{ "stage": "error", "error": string }`.

- **HTTP**
  - `GET /geojson/:hash` — returns GeoJSON FeatureCollection (roads).
  - `GET /download/:hash` — returns same or downloadable asset.

The Node server in this repo proxies `/ws/extract` and these HTTP routes to the extract upstream (`EXTRACT_WS_UPSTREAM`). When the extract service runs in this repo (Docker or `node extract/server.js`), point the app at it; when you use an external deploy (e.g. Cloud Run), set `EXTRACT_WS_UPSTREAM` on the Node API.

## Run locally

From repo root:

```bash
cd extract && npm install && node server.js
```

Listens on **port 4000** (WebSocket and HTTP). Optional env: `PORT=4000`.

## Run with Docker (from repo root)

```bash
docker compose up --build extract
```

Backend and app can point at it with:

- App: `EXPO_PUBLIC_OVERTURE_EXTRACT_URL=http://localhost:4000`
- Node server: `EXTRACT_WS_UPSTREAM=http://extract:4000` (in compose) or `http://localhost:4000` (host).

## Implementation note

The default server in this directory is a **minimal implementation** that returns mock GeoJSON so the Extract tab works without an external service. For production or full Overture clipping you can:

- Replace this with a service that uses Overture data (e.g. STAC/GeoParquet) and clips to the polygon, or
- Deploy a separate extract service (e.g. Cloud Run) and set `EXTRACT_WS_UPSTREAM` on the Node API.
