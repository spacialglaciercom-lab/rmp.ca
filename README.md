# TrashRoute (RouteMaster Pro)

**TrashRoute** (also known as **RouteMaster Pro** / rmp.ca) is a cross-platform app for **waste collection route planning and optimization**. It helps plan and optimize routes using the Chinese Postman problem, zone partitioning, and map-based extraction from OpenStreetMap and Overture.

## Features

- **Map** — View and edit routes on MapLibre (native) or Leaflet (web). Draw polygons, extract road networks from Overture/OSM, and manage layers.
- **Planner** — Build routes from extracted or imported GeoJSON; run optimization (Chinese Postman / VRP) and zone partitioning.
- **Route** — View optimized routes, export to GPX, and manage collection points.
- **Record** — Record routes and collection points in the field (mobile).
- **Home** — Dashboard with weather, processing queue, and quick access to planning and contribution.
- **Settings** — Theme, map preferences, OSM/Mapillary sign-in, and app configuration.

### Backend & services

- **Node server** — Express + tRPC API, Firebase auth, optional MySQL (Drizzle), AI/LLM and storage integrations. See [server/README.md](server/README.md).
- **Optimizer** — Chinese Postman and zone partitioning; can run on Railway or another host. See [backend/README.md](backend/README.md) for the Python FastAPI zone-partition service.
- **Overture extract** — WebSocket service for polygon → GeoJSON extraction (Extract tab). Web and native connect **directly** to the extract service by default; set `EXPO_PUBLIC_OVERTURE_WS_BASE` to your main API URL to use the backend proxy instead. See `.env.example` for URLs.

## Tech stack

| Layer | Technologies |
|-------|--------------|
| App | **Expo** (SDK 54), **React Native**, **expo-router**, **NativeWind** (Tailwind), **Zustand** |
| Maps | MapLibre GL, Leaflet, react-leaflet, OSM, Overture, PMTiles, DuckDB-WASM |
| API | **tRPC**, **TanStack Query**, **Firebase** (Auth, Firestore, Storage, Analytics) |
| Server | **Express**, **Drizzle** (MySQL), **Firebase Admin** |
| Optimization | Custom optimizer service (Chinese Postman, zone partition); Python FastAPI backend for spectral partitioning |

## Prerequisites

- **Node.js** 18+ and **pnpm** 9.x (`packageManager` in `package.json`: `pnpm@9.12.0`)
- For **mobile**: Xcode (iOS) and/or Android Studio, Expo dev client
- For **zone partition backend**: Python 3.x, see [backend/README.md](backend/README.md)
- Optional: Firebase project, MySQL/TiDB for user data, API keys (maps, weather, OSM OAuth, etc.)

## Setup

1. **Clone and install**

   ```bash
   git clone <repo-url> rmp.ca && cd rmp.ca
   pnpm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set at least:

   - `EXPO_PUBLIC_API_BASE_URL` — Node/Express + tRPC server (e.g. `http://localhost:3000` for local).
   - `EXPO_PUBLIC_OPTIMIZER_URL` — Optimizer API (Chinese Postman, zones). For local dev you can point to a Railway or other deployed URL, or run your own.
   - `EXPO_PUBLIC_OVERTURE_EXTRACT_URL` — Overture extract service (Extract tab). Optional if you don’t use that flow.

   For auth, AI, maps, and DB, see comments in `.env.example` and [server/README.md](server/README.md).

3. **Run**

   **Web (Expo):**

   ```bash
   pnpm dev
   ```

   **Web + Node server (API, tRPC):**

   ```bash
   pnpm dev:all
   ```

   **Mobile (Expo Go or dev client):**

   ```bash
   pnpm mobile          # Expo start (choose device)
   pnpm mobile:ios      # iOS
   pnpm mobile:android  # Android
   ```

   **Build web:**

   ```bash
   pnpm build
   ```

   **Build and run Node server (production-style):**

   ```bash
   pnpm build:server && pnpm start
   ```

## Scripts (Windows / repo scripts)

| Script | Description |
|--------|-------------|
| `pnpm dev` | Expo web on port 19007 |
| `pnpm dev:server` | Node tRPC server (watch) |
| `pnpm dev:all` | Expo + server concurrently |
| `pnpm build` / `pnpm build:web` | Export Expo web |
| `pnpm build:server` | Bundle server to `dist/` |
| `pnpm db:push` | Drizzle generate + migrate |
| `pnpm test` | Vitest |
| `pnpm check` | TypeScript check |
| `pnpm lint` | Expo lint |
| `pnpm mobile:android` | Expo start + Android (dev client for hot reload) |
| `pnpm build:android` | EAS build for Android |

See [scripts/README.md](scripts/README.md) for Windows batch/PowerShell scripts (start app + backends, kill ports, startup).

## Project structure

```
rmp.ca/
├── app/                    # Expo Router screens (tabs: Home, Route, Planner, Map, Record, Settings)
├── components/             # Shared UI, map components, planner, Overture extract
├── server/                 # Node API: Express, tRPC, auth, DB (server/README.md)
├── backend/                # Python FastAPI zone partition service (backend/README.md)
├── lib/                    # TRPC, theme, maps, storage, Firebase, plugins, etc.
│   └── plugins/           # Plugin system: registry, config, built-ins (see docs/PLUGIN-DEVELOPMENT.md)
├── hooks/                  # useAuth, useColors, etc.
├── stores/                 # Zustand stores
├── drizzle/               # DB schema and migrations
├── services/               # Optimizer, instruction manager, etc.
├── scripts/               # Start/kill scripts, EAS, cache (scripts/README.md)
├── .env.example            # Env template
└── package.json
```

### Plugin setup

Plugins are toggled in **Settings → Plugins** and configured via `lib/plugins/default-config.json` and per-plugin `lib/plugins/[id]/config.json` (apiKeys, endpoints). See [docs/PLUGIN-DEVELOPMENT.md](docs/PLUGIN-DEVELOPMENT.md) for adding plugins, testing, and deployment.

## Documentation

- [docs/PLUGIN-DEVELOPMENT.md](docs/PLUGIN-DEVELOPMENT.md) — Plugin system: config, registry, testing, deployment.
- [server/README.md](server/README.md) — Backend development (auth, tRPC, DB, LLM, storage).
- [backend/README.md](backend/README.md) — Zone partition API and deployment (e.g. Cloud Run).
- [scripts/README.md](scripts/README.md) — Local run scripts and ports.
- [backend/docs/GEOJSON-OSM-CLEANING-PLAN.md](backend/docs/GEOJSON-OSM-CLEANING-PLAN.md) — GeoJSON/OSM cleaning pipeline plan.
- [backend/docs/GEOJSON-CLEAN-REVIEW-AND-CHANGES.md](backend/docs/GEOJSON-CLEAN-REVIEW-AND-CHANGES.md) — GeoJSON clean implementation review and prioritized changes.

## Recent changes

- **Plugins** — Plugin system (OsmAnd-style): toggles in Settings, per-plugin `config.json` (apiKeys, endpoints), dev plugin for logging in development. See [docs/PLUGIN-DEVELOPMENT.md](docs/PLUGIN-DEVELOPMENT.md).
- **GeoJSON clean (backend)** — `POST /api/geojson/clean` now enforces a **50 MB** request body limit to reduce DoS risk; responses include a **`warnings`** array (e.g. when over 10% of features are dropped as invalid, with a suggestion to check CRS and geometry validity). Invalid-drop ratio is logged at warning level. See [backend/docs/GEOJSON-CLEAN-REVIEW-AND-CHANGES.md](backend/docs/GEOJSON-CLEAN-REVIEW-AND-CHANGES.md).
- **OSM → GeoJSON script** — `backend/scripts/osm_to_geojson.py` outputs GeoJSON in **WGS84 (EPSG:4326)** via `-t_srs EPSG:4326`; docstring updated accordingly.
- **Map** — Record (GPS) button wired in map floating controls; tap map to add bin in Zones/waste mode; pointer-events and empty-state handling improved on web.

## License

Proprietary. See repository or project owner for terms.
