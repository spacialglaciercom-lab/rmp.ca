# TrashRoute (RouteMaster Pro)

**TrashRoute** (also known as **RouteMaster Pro** / [rmp.ca](https://rmp.ca)) is a cross-platform application for **waste collection route planning and optimization**. It leverages the Chinese Postman problem, zone partitioning, and map-based data extraction from OpenStreetMap (OSM) and Overture to build efficient routes.

---

## 🚀 Overview

- **Map** — View and edit routes on MapLibre (native) or Leaflet (web). Features include polygon drawing, road network extraction (Overture/OSM), and layer management.
- **Planner** — Build routes from extracted or imported GeoJSON; run optimization (Chinese Postman / VRP) and spectral zone partitioning.
- **Route** — View optimized routes, export to GPX, and manage collection points.
- **Record** — Real-time route recording and collection point logging in the field (mobile).
- **Home** — Dashboard with weather updates, processing queue, and quick access to planning.
- **Settings** — Personalization (theme, maps), OSM/Mapillary authentication, and global app configuration.

---

## 🛠 Tech Stack

| Layer            | Technologies                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App**          | [Expo](https://expo.dev/) (SDK 54), React Native, [expo-router](https://docs.expo.dev/router/introduction/), [NativeWind](https://www.nativewind.dev/) (Tailwind), Zustand |
| **Maps**         | MapLibre GL, Leaflet, react-leaflet, OSM, Overture, PMTiles, DuckDB-WASM                                                                                                   |
| **API/Backend**  | **tRPC**, Express, TanStack Query, [Firebase](https://firebase.google.com/) (Auth, Firestore, Storage, Analytics)                                                          |
| **Database**     | [Drizzle ORM](https://orm.drizzle.team/), MySQL/TiDB, MongoDB                                                                                                              |
| **Optimization** | Custom optimizer (Chinese Postman); Python FastAPI backend for spectral partitioning                                                                                       |
| **AI/Voice**     | OpenAI-compatible AI SDK, Genkit, ElevenLabs, Moonshine (transcription)                                                                                                    |

---

## 📋 Requirements

- **Node.js**: 18.x or higher
- **Package Manager**: [pnpm](https://pnpm.io/) (v10.0.0 specified in `package.json`)
- **Python**: 3.x (for the zone partition backend)
- **Mobile Development**:
  - **iOS**: Xcode & CocoaPods
  - **Android**: Android Studio & SDK
- **Optional Services**: Firebase project, MySQL/TiDB instance, API keys (Maps, Weather, OSM OAuth).

---

## ⚙️ Setup & Installation

1.  **Clone the Repository**

    ```bash
    git clone <repo-url> rmp.ca
    cd rmp.ca
    ```

2.  **Install Dependencies**

    ```bash
    pnpm install
    ```

3.  **Configure Environment Variables**
    Copy `.env.example` to `.env` and set the required values:

    ```bash
    cp .env.example .env
    ```

    Key variables to set:
    - `EXPO_PUBLIC_API_BASE_URL`: Your Node/Express + tRPC server.
    - `EXPO_PUBLIC_OPTIMIZER_URL`: Optimizer API endpoint.
    - `EXPO_PUBLIC_OVERTURE_EXTRACT_URL`: Overture extract service (WebSocket). The extract service is **included in this repo** under `extract/`; see `extract/README.md` and `docs/DOCKER.md`.
    - `NGROK_AUTHTOKEN`: Required for mobile tunneling (`pnpm mobile:tunnel`).

4.  **Database Migration (if using MySQL)**
    ```bash
    pnpm db:push
    ```

---

## 🏃 Commands & Scripts

### Development

- `pnpm dev` — Start Expo for web (port 19007).
- `pnpm dev:server` — Start Node.js tRPC server with `tsx watch`.
- `pnpm dev:all` — Run both the app and the server concurrently.
- `pnpm mobile` — Start Expo with a clear cache (for mobile testing).
- `pnpm mobile:ios` / `pnpm mobile:android` — Run directly on a simulator/emulator.

### Build & Production

- `pnpm build` — Export Expo app for web production.
- `pnpm build:server` — Bundle the Node server using `esbuild` to `dist/`.
- `pnpm start` — Run the bundled server from `dist/index.js`.
- `pnpm build:android` — Trigger an EAS build for Android.

### Utilities

- `pnpm lint` / `pnpm format` — Code quality and formatting.
- `pnpm check` — Type-check using TypeScript.
- `pnpm test` — Run unit tests with Vitest.
- `pnpm cache:clear` — Comprehensive cache cleanup script.
- `pnpm mobile:tunnel` — Start a tunnel via ngrok for remote mobile testing.

### Docker (local stack)

The full dev stack (MySQL, backend, optimizer, Overture) runs via **Docker Compose from the parent folder** of this repo (where `docker-compose.yml` lives). This repo provides the app and backend images. See [docs/DOCKER.md](docs/DOCKER.md) for how to run `docker compose up --build`.

---

## 📁 Project Structure

- `app/` — **Entry Point (App):** Expo Router screens and tab definitions.
- `server/` — **Entry Point (API):** Express server, tRPC routers, and backend logic.
- `backend/` — Python FastAPI service for advanced optimization (spectral partitioning).
- `components/` — Shared React components and map logic.
- `lib/` — core libraries, plugin system, and Firebase/tRPC configurations.
- `services/` — Business logic: optimizers, instruction managers, etc.
- `stores/` — State management via Zustand.
- `drizzle/` — Database schema definitions and migrations.
- `hooks/` — Custom React hooks (auth, theme, etc.).
- `scripts/` — Utility scripts for dev-ops, patching, and automation.

---

## 🌍 Environment Variables

Refer to `.env.example` for a full list. Primary categories include:

- **Base URLs**: API, Optimizer, Overture Extract.
- **Authentication**: Firebase, OSM OAuth, Mapillary.
- **API Keys**: Google Maps, Mapbox, OpenWeatherMap.
- **AI/LLM**: OpenRouter, ElevenLabs, Mistral.
- **Database**: `DATABASE_URL`, `MONGODB_URI`.

---

## 🧪 Testing

- **Unit/Integration**: Run `pnpm test` (Vitest).
- **Type Safety**: Run `pnpm check` (tsc).
- **Spatial Tests**: Run `pnpm test:spatial` (Custom script).
- **E2E (optional)**: For end-to-end tests on the Expo/React Native app, consider [Maestro](https://maestro.mobile.dev/) (cross-platform, no app code changes) or [Detox](https://wix.github.io/Detox/) (native integration, good for CI). Configure and run E2E flows (e.g. login, open map, run optimization) as needed.

---

## 🔌 Plugins

The app features an OsmAnd-inspired plugin system. Plugins can be toggled in **Settings → Plugins**.

- Configured via `lib/plugins/default-config.json`.
- See `docs/PLUGIN-DEVELOPMENT.md` for details on creating and deploying plugins.

---

## 📜 License

**Proprietary.** All rights reserved. No use, copy, modification, or distribution without prior approval from the copyright holder.

---

## 🔗 Additional Documentation

- [server/README.md](server/README.md) — Backend architecture.
- [backend/README.md](backend/README.md) — Optimization service details.
- [docs/DOCKER.md](docs/DOCKER.md) — Docker local dev stack (run from parent folder).
- [docs/PLUGIN-DEVELOPMENT.md](docs/PLUGIN-DEVELOPMENT.md) — Plugin system guide.
- [scripts/README.md](scripts/README.md) — Infrastructure scripts.
- [backend/docs/](backend/docs/) — Detailed GeoJSON cleaning and pipeline plans.
