# Route Optimization Plugin

CPP (Chinese Postman) route optimization and zone partitioning as a swappable plugin. The Planner uses `getPlugin('routeOptimization')?.getFeatures().routeOptimizer` and falls back to direct backend or local optimizer when the plugin is disabled or fails.

## Features

- **optimizer(geojson, options)** — Optimize road GeoJSON via Python FastAPI backend (proxied or direct). Optionally integrates with weather plugin `dataProviderForRoute` for avoid-zones (e.g. rainy areas).
- **partitioner(params)** — Partition road GeoJSON or points into zones (spectral clustering) via same backend.
- **chunkedOptimizer(geojson, options)** — For large GeoJSON (>5000 features), splits into chunks to avoid timeouts; merges route points (order across chunks may be suboptimal).

## Backend

- Optimizer backend is called via `services/overtureOptimizerService` (fetch to proxy on web, direct URL on native). Server also exposes **tRPC** `optimizer.optimize`, `optimizer.partition`, `optimizer.partitionFromGeoJSON`, `optimizer.partitionFromPoints`, `optimizer.health` in `server/optimizerRouter.ts` (proxies to `OPTIMIZER_BACKEND_URL`).
- **Errors**: Backend errors (timeouts, 5xx) are caught in the Planner and fall back to local optimizer. For future progress/streaming, the backend could expose a WebSocket; currently all calls are HTTP.
- **Real-time location**: Not part of this plugin; subscribe to location elsewhere (e.g. `expo-location`) and pass waypoints to the optimizer or use for live rerouting.

## Tests

- `lib/plugins/__tests__/route-optimization.test.ts` — Unit tests with mocked backend (optimizer shape, partitioner delegation, chunkedOptimizer splitting).
