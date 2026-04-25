# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**TrashRoute / RouteMaster Pro / rmp.ca** — cross-platform (iOS, Android, Web) waste-collection route planning and optimization. Expo (React Native + RN-Web) front end, Node/tRPC backend, PostgreSQL + PostGIS authority, optional Python FastAPI optimizer, and a Kotlin Multiplatform `shared-logic` math module.

The package manager is **pnpm 10** (`packageManager` in `package.json`). Do not use `npm install` / `yarn`; the `lockfile:clean` script and `.gitignore` actively reject `package-lock.json` and `yarn.lock`.

## Common commands

All scripts run with `NODE_OPTIONS=--max-old-space-size=8192` — the codebase is large enough that the default Node heap will OOM. Raise it further (16384) for very large Metro/web builds.

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Run web dev server (Expo, port 19007) | `pnpm dev` |
| Run Node API server (Express + tRPC, port 3000) | `pnpm dev:server` |
| Run extract service (Overture, port 9000) | `pnpm dev:extract` |
| Run all three together | `pnpm dev:all` |
| Build production server bundle | `pnpm build:server` (esbuild → `dist/`) |
| Build web export | `pnpm build` (Expo) |
| Production start | `pnpm start` (runs `prestart` → `build:server`) |
| Mobile dev (Expo, clear cache) | `pnpm mobile` |
| Mobile on LAN (auto-detects host IP) | `pnpm mobile:lan` |
| Tests (Vitest, single fork) | `pnpm test` |
| Run a single test file | `pnpm test path/to/file.test.ts` |
| Server integration tests | `pnpm test:integration` (requires `TEST_API_BASE_URL`) |
| Spatial fixtures script | `pnpm test:spatial` |
| Typecheck | `pnpm check` (`tsc --noEmit`) |
| Lint (expo-config-eslint flat) | `pnpm lint` |
| Format | `pnpm format` |
| DB migrations (Drizzle) | `pnpm db:push` (generate + migrate; requires `DATABASE_URL`) |
| Build KMP shared-logic (needs JDK 17) | `pnpm run build:shared-logic` |

There is **no `pnpm test:watch`**; Vitest is configured `pool: "forks"` with `singleFork: true` to avoid V8 coverage-merge races. The `e2e/` directory is excluded from Vitest.

## Environment files

Three layered env files are loaded by `scripts/load-server-env.js` before module import (so secrets are available at top-level `import` time):

- `.env.server` — server secrets (DB URL, AI keys); never committed.
- `.env` — shared/public vars (e.g. `EXPO_PUBLIC_*`, `NODE_OPTIONS`).
- `.env.r2` — Cloudflare R2 credentials.

`dotenv` is configured **not** to override existing env vars — anything set by Docker/Railway/CI wins. Templates: `.env.example`, `.env.server.example`, `.env.r2.example`.

For mobile on a physical device, `EXPO_PUBLIC_API_BASE_URL` and `REACT_NATIVE_PACKAGER_HOSTNAME` must be set to the dev machine's LAN IP — `localhost` resolves to the phone, not the laptop.

## Architecture: how data flows

The system is **offline-first**: the device's WatermelonDB (SQLite) is treated as primary for UX, with eventual convergence to PostGIS via tRPC.

```
File (CSV/GPX/GeoJSON/JSON)
  → hooks/useRouteImport.ts          (parse → ImportPoint[])
  → components/RoutePreviewMap.tsx   (preview, edit)
  → lib/routeSolver.ts               (local NN + 2-opt + Or-opt cleanup, OR server)
  → server/spatialRouter.ts          (spatial.solveTSP via pgRouting/VROOM)
  → server/syncRouter.ts             (sync.push / sync.pull, returns mappedIds)
  → drizzle + PostGIS                (geography(Point/LineString, 4326))
```

**Three distinct optimizers** that solve different problems — do **not** confuse them:

| Module | Problem | Where it runs |
|--------|---------|---------------|
| `lib/route-optimizer-v2/` (`RouteOptimizer` class) | **Chinese Postman** — cover every street ≥1 time. Uses edge doubling + Hierholzer with right-turn-biased edge selection, U-turn restrictions, virtual dead-head edges to balance, multi-component support. | On-device, offline. |
| `lib/routeSolver.ts` (`solveLocal` / `solveServer`) | **TSP/VRP** — sequence discrete stops. Local: nearest-neighbor + 2-opt + Or-opt. Server: pgRouting / VROOM. | On-device or via `spatial.solveTSP`. |
| `backend/` Python FastAPI + `server/optimizerRouter.ts` | **TSP/VRP at scale** + spectral zone partitioning. | Python service (port 8000), proxied via `optimizer.*` tRPC procedures. |

**tRPC is the source of truth for the API surface.** All routers are mounted in `server/routers.ts`; the Express adapter lives in `server/_core/index.ts` at `/api/trpc`. The full procedure list is in `README.md` under "API Surface" — keep it in sync when adding/removing procedures. Notable routers: `sync`, `spatial`, `aiRouteAnalysis`, `org`, `navigation`, `voice`, `costHistory`, `gpxTraining`, `logisticsZones`, `optimizer`, `rbac`, `rag`.

**Drizzle schema** (`drizzle/schema.ts`) declares a custom `geography` type — PostGIS `geography(Point|LineString, 4326)` — so spatial queries use `ST_DWithin` / `ST_Distance` with metre-correct distances, not planar SRID 4326. The Drizzle config explicitly excludes PostGIS internal tables (`spatial_ref_sys`, `geography_columns`, `geometry_columns`).

**`server/db.ts`** lazily constructs the postgres-js client and **does not cache failures** — every `getDb()` retries until `DATABASE_URL` works. Tests and tooling can run with no DB (`getDb()` returns `null`).

## Key cross-cutting conventions

- **Path aliases** (both `tsconfig.json` and `vitest.config.ts`): `@/*` → repo root, `@shared/*` → `shared/`. Vitest also stubs `react-native` → `lib/__tests__/stubs/react-native.ts` and `expo-modules-core` → `lib/__tests__/stubs/expo-modules-core.ts` so Rollup doesn't choke on Flow's `import typeof`.
- **Platform-specific files** use the React Native `.web.tsx` / `.tsx` split (e.g. `CollectionNavigator.web.tsx` vs `CollectionNavigator.tsx`). Always check whether a web fallback exists when editing native components.
- **NativeWind v4** (Tailwind for RN) — `global.css`, `tailwind.config.js`, `nativewind-env.d.ts`. Class strings work on both web and native.
- **Org scoping**: every persistent server mutation assumes a signed-in user with `orgId`. Multi-tenant isolation is enforced in router code, not just the schema.
- **Verified Scan / 10-metre geofence** (`spatial.verifyAndCollect`): only marks a bin collected if `ST_DWithin(location, driverPoint::geography, 10)` is true. Never weaken or bypass this — it is the security boundary between "QR scanned" and "physically present".
- **Antimeridian (±180°)**: import and distance code must handle Pacific-spanning routes correctly. Test fixture: `shared/test-fixtures/spatial/antimeridian_wrap.geojson`.

## `shared-logic` (Kotlin Multiplatform)

`shared-logic/` is a **Gradle KMP module** containing CVRP / CPP-style math for Android (and optionally Kotlin/JS). To keep `pnpm install` green for contributors without a JDK, the dependency is wired to an empty stub:

```json
"shared-logic": "file:./shared-logic/pnpm-stub"
```

To build the real artifact: `./gradlew :shared-logic:assemble` (or `pnpm run build:shared-logic`) — requires JDK 17.

## Submodules and out-of-tree code

- `Verification/`, `Tests/Verification/`, `Main.lean`, `lakefile.toml`, `lean-toolchain` — a **Lean 4** mathematical verification component. CI lives in `.github/workflows/lean_action_ci.yml`. Only touch when explicitly working on proofs.
- `modules/moonshine-voice/`, `modules/route-optimizer/` — local Expo modules (autolinking exclusions for Android are declared in `package.json`'s `expo.autolinking`).
- `modules/leap-extract/` — iOS-only Leap SDK; gitignored to keep Android builds working.
- `bastille/`, `cbsd/` — FreeBSD jail / VM provisioning for the `db01` PostGIS host.

## Tests

- Unit/integration: Vitest, located alongside source as `__tests__/` directories or `*.test.ts` files. Server tests are in `server/tests/`.
- E2E: Detox (`detox.config.js`, `e2e/`) — excluded from Vitest.
- Python: `backend/tests/` (pytest, run separately).
- SQL: `TESTS/database/` (PostGIS spatial regressions).
- Cross-package fixtures: `shared/test-fixtures/` — reuse these rather than inventing new ones, especially `algorithms/tsp_z_shape.json`, `perf/load_200_points.json`, `parsers/malformed_headers.csv`, `spatial/antimeridian_wrap.geojson`.

## Editing guidance specific to this repo

- When adding a tRPC procedure, register it in `server/routers.ts` **and** add it to the API surface table in `README.md`.
- When adding a new mobile screen, place it in `app/` (Expo Router file-based routing); platform-specific UI goes in `components/` with `.tsx` / `.web.tsx` siblings.
- When changing the DB schema, edit `drizzle/schema.ts`, then `pnpm db:push` to generate a migration in `drizzle/`. Never hand-edit generated `0NNN_*.sql` files; create a follow-up migration instead.
- `package.json` has `pnpm.overrides` pinning React 19.1.0, RN 0.81.5, and `apache-arrow` ^18.0.0 — do not bump these without coordinating across the Expo/React-Native/Metro/Reanimated matrix.
- Many proxy routes (`mapsProxy`, `osrmProxy`, `aiProxy`, `elevenLabsProxy`, `optimizerProxy`, `overpassProxy`, `wsExtractProxy`) exist to keep API keys server-side and to give web (same-origin) a single stable endpoint. New third-party integrations should follow this proxy pattern, not call the third party directly from the client.
