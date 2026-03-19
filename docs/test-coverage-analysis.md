# Test Coverage Analysis

_Updated: 2026-03-19_

## Current State

The codebase has **22 JS/TS test files** and **12 Python test files** covering a small
fraction of the total source:

| Layer | Source Files | Test Files | Approx. Coverage |
|---|---|---|---|
| `lib/` | ~178 TS files | 8 test files | ~5% |
| `lib/plugins/` | ~28 TS files | 7 test files | ~25% |
| `server/` | ~42 TS files | 5 test files | ~12% |
| `stores/` | 18 TS files | 0 | 0% |
| `hooks/` | 18 TS files | 0 | 0% |
| `components/` | ~30 TSX files | 0 | 0% |
| `backend/` (Python) | ~14 py files | 7 test files | ~50% |

The Python backend is reasonably well covered. The TypeScript library and server layers
are severely under-tested, and there is no coverage reporting infrastructure at all.

---

## What Is Well Covered

These areas have solid, maintained tests and do not need immediate attention:

- **`NavigationEngine`** (`lib/__tests__/NavigationEngine.test.ts`, 696 lines) — bearing
  math, maneuver generation, voice instructions, snap-to-route, off-route detection, step
  progression, arrival detection.
- **Route optimiser (Chinese Postman)** (`lib/__tests__/routeOptimizer.test.ts`, 477 lines)
  — empty/degenerate graphs, circuit correctness, one-way streets, disconnected components,
  turn-penalty weights.
- **GeoJSON utilities** (`lib/__tests__/geojson-utils.test.ts`) — round-trip conversion,
  multi-vehicle coloring, matched routes.
- **Cycle detection** (`lib/__tests__/cycleDetector.test.ts`) — oscillation, stagnation,
  tabu list management.
- **Turn-aware CPP** (`lib/__tests__/turnAwareCpp.test.ts`) — turn-penalty integration.
- **Plugin system** (`lib/plugins/__tests__/`) — registry, config, gating, weather plugin,
  VRP solver plugin interface.
- **Backend algorithms** (`backend/tests/`) — Hierholzer circuit, CPP optimizer, VRP with
  TSPLIB benchmarks, GPX export API, vector cleaning, analytics.

---

## Priority 1 — Pure Functions with Zero Tests (Easy, High ROI)

These modules contain only deterministic functions with no I/O or platform dependencies.
They can be unit-tested with no mocking and no infrastructure setup.

### 1a. `lib/export-utils.ts`

**Risk:** Bugs silently corrupt route reports sent to fleet operators (CSV with wrong data,
JSON with un-sanitized invalid times, fleet management files with bad stop ordering).

Functions to add tests for:

| Function | Key test cases |
|---|---|
| `sanitizeEstimatedTime` | Speed < 10 km/h triggers recalculation to 25 km/h baseline; valid speeds pass through unchanged; zero/negative distance returns input |
| `formatDateCanadaTime` | Correct Eastern offset (UTC-5/UTC-4 DST); output format matches `YYYY-MM-DDTHH:MM:SS TZ`; known timestamp produces expected string |
| `formatDateDeviceLocal` | Uses device timezone; format shape consistent with Canada variant |
| `exportToCSV` | Header comment lines present; row count = point count; address with commas is double-quoted; address with embedded `"` is escaped |
| `exportToJSON` | Output is valid JSON; `statistics.estimatedTime` is sanitized; `metadata.exportedAt` is present |
| `exportStatisticsToCSV` | All metric rows present; correct unit suffixes; penalties included |
| `exportForFleetManagement` | `version: "1.0"` present; stops are 1-indexed; null notes written as `null` not `""` |
| `getExportExtension` / `getExportMimeType` | All four format branches (`json`, `csv`, `fleet`, `gpx`) return correct values |

### 1b. `lib/douglas-peucker.ts`

**Risk:** Incorrect simplification silently drops collection points before GPX export,
causing drivers to miss stops.

| Function | Key test cases |
|---|---|
| `douglasPeucker` | ≤2 points returned unchanged; perfectly collinear points reduce to 2 endpoints; tolerance=0 preserves all points; right-angle bend kept at correct position; default 10m tolerance |
| `simplifyRouteByReduction` | Output ratio ≤ `targetReduction`; ≤2 points returned as-is; binary search converges within 20 iterations |
| `calculateCompressionMetrics` | `pointsRemoved = original − simplified`; `reductionPercentage` is 1 d.p.; zero-removal gives 0% |
| `estimateGPXFileSize` | Scales linearly with point count; 0 points returns header-only size (≈ 1 KB) |

### 1c. `lib/osm-filter.ts`

**Risk:** Incorrect filtering lets footways/private driveways into the truck route or
excludes valid residential streets, corrupting the entire road graph.

| Function | Key test cases |
|---|---|
| `shouldIncludeHighway` | Each of the 7 allowed types returns `true`; `footway`, `motorway`, `primary` return `false`; `service` only included when `service=alley` |
| `shouldExcludeWay` | Each excluded highway type returns `true`; `parking_aisle`, `driveway` excluded; `access=private` excluded; `area=yes` excluded; combined tag wins (exclude takes priority) |
| `filterOSMWays` | Exclude logic wins over include; empty array returns empty; mixed array filters correctly |
| `isOneWay` | `"yes"`, `"1"`, `"true"` → `true`; `"no"`, `"-1"`, `undefined` → `false` |
| `getStreetName` | Fallback chain: `name` → `addr:street` → `name:en` → `undefined` |

### 1d. `lib/weather-utils.ts`

| Function | Key test cases |
|---|---|
| `cardinalToAbbrev` | All 16 named directions; case-insensitive input (`"north"` = `"NORTH"`); unknown string echoed back unchanged; `undefined` → `""` |

---

## Priority 2 — Algorithmic Modules Missing Unit Tests

### 2a. `lib/route-loop-pruner.ts` — `pruneRouteLoops`

A post-processing algorithm that removes repeated directed segments from the computed
route. A bug here causes the driver to traverse the same street excessively without
the optimizer knowing.

Suggested test cases:

- **No loops** — route with all unique segments returns `changed: false`.
- **Simple loop** — A→B→C→A→B with `maxSegmentVisits=1` collapses to A→B→C→A.
- **Allowed two-pass** — a segment visited exactly `maxSegmentVisits` times is kept intact.
- **Three-visit pruning** — third traversal of a segment is removed.
- **Too short to prune** — 2-point route returns original unchanged.
- **`changed` flag** — `true` when points removed, `false` otherwise.
- **`stats` consistency** — `beforePoints − removedPoints = afterPoints`.
- **`maxIterations` cap** — deeply looped route stops after cap (no infinite loop).
- **Consecutive deduplication** — identical adjacent coordinates are collapsed before pruning.

### 2b. `lib/vrp-solvers/clarke-wright.ts`

The Clarke-Wright savings algorithm is a core VRP heuristic. The existing plugin-level
test in `lib/plugins/__tests__/vrp-solvers.test.ts` only exercises the plugin interface,
not the algorithm's correctness.

Suggested test cases:

- **Single stop** — depot + 1 stop produces one route covering that stop and returning.
- **Two stops, one vehicle** — both stops in a single route.
- **`numVehicles` enforced** — 4 stops and 2 vehicles → exactly 2 routes.
- **Balanced distribution** — stops spread approximately evenly (cap enforced).
- **All stops visited** — union of all route stops equals the full input stop list.
- **Depot at start and end** — every route begins and ends at index 0.
- **`totalDistanceKm`** — matches manual sum of segment distances.

### 2c. `lib/vrp-solvers/two-opt.ts`

The 2-opt improvement step and sweep construction likewise have no dedicated algorithm
tests. The same categories as Clarke-Wright apply, with an additional check:

- **2-opt never increases distance** — running improvement on a known sub-optimal route
  returns a route with distance ≤ the input.

---

## Priority 3 — Server-Side Route Coverage

The server has 42 TypeScript source files but tests for only 5 of them. Business-logic
routers have **zero tests**:

| File | What to test |
|---|---|
| `server/costHistoryRouter.ts` | CRUD operations; auth guard rejects unauthenticated; response shape |
| `server/orgRouter.ts` | Org creation; member addition; role enforcement (non-admin cannot manage members) |
| `server/navigationRouter.ts` | Route save and load; ownership check (user A cannot read user B's routes) |
| `server/optimizerRouter.ts` | Request forwarding to backend; error propagation when backend is down |
| `server/gpxTrainingRouter.ts` | File parsing; training data persisted correctly |
| `server/rag/ragService.ts` | Document chunking; retrieval returns correct top-k; empty corpus returns empty |
| `server/rbac/rbacRouter.ts` | Role grants/revocations; non-admin cannot elevate privileges |

The existing `auth.logout.test.ts` is the right pattern — lightweight tRPC context mock
with no live database. The same approach works for all of the above.

The existing auth tests also have gaps:

- Token revocation: subsequent requests after logout should fail.
- Org-scoped access: `orgProcedure` should reject users from a different org.
- Admin guard: admin-only procedures should return 403 for regular users.

---

## Priority 4 — Crash Recovery (`lib/crash-recovery.ts`)

This module saves and restores application state across crashes using AsyncStorage.
A bug here means users lose their planned routes after an app crash.

AsyncStorage is already stubbed in the Vitest environment via the react-native stub,
making these tests straightforward.

Suggested test cases:

- **`saveRecoveryData`** — partial data (only `collectionPoints`) saves only that field;
  timestamp is always updated.
- **`loadRecoveryData`** — returns `null` when no timestamp; parses all fields correctly.
- **24-hour expiry** — data older than 24 h returns `null` and clears storage.
- **Corrupt JSON** — malformed stored string returns `null` without throwing.
- **`clearRecoveryData`** — all keys removed from storage.
- **`checkForCrash`** — `true` when recovery data exists; `true` when last error exists;
  `false` when both empty.
- **`initializeCrashRecovery`** — assembles all three return fields correctly.

---

## Priority 5 — Zustand Stores (State Management)

All 18 stores in `stores/` have zero tests. Store bugs cause cascading UI failures that
are hard to reproduce and debug.

The highest-risk stores:

- **`circuitStore`** — Persists the active `TurnEdge[]` circuit after optimization and is
  used by re-optimization (`rerouteFromBreakdown`, `insertEmergencyStopAt`). Corruption
  here produces silently wrong re-routes.
- **`collectionNavigationStore`** — Navigation step, progress, arrival. Bugs leave the
  driver stuck on a wrong step.
- **`routeParametersStore`** — Turn penalties and fuel mode directly affect route quality.

What to test for each store:

- Initial state matches expected defaults.
- State transitions are correct (advance step, mark collected, etc.).
- Actions are immutable (previous state reference not mutated).
- Derived selectors return correct computed values.

---

## Priority 6 — Coverage Infrastructure

The project has **no coverage reporting configured**. Without it, regressions are
invisible and it is impossible to measure whether the improvements above make an impact.

**Add to `vitest.config.ts`:**

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  include: ['lib/**/*.ts', 'server/**/*.ts'],
  exclude: ['lib/__tests__/**', 'server/tests/**', '**/*.d.ts'],
  thresholds: {
    lines: 40,      // achievable today
    functions: 35,
    branches: 30,
  },
},
```

**Add to `package.json`:**

```json
"test:coverage": "vitest run --coverage"
```

Start with low thresholds and raise them as new tests land. Failing CI on coverage
regression prevents new code from shipping untested.

---

## Effort / Impact Summary

| Priority | Module(s) | Effort | Impact |
|---|---|---|---|
| 1a | `lib/export-utils.ts` | Low | High — data correctness in exported reports |
| 1b | `lib/douglas-peucker.ts` | Low | High — silent point loss in GPX exports |
| 1c | `lib/osm-filter.ts` | Low | High — road inclusion/exclusion logic |
| 1d | `lib/weather-utils.ts` | Very low | Low |
| 2a | `lib/route-loop-pruner.ts` | Medium | High — excessive segment traversal |
| 2b | `lib/vrp-solvers/clarke-wright.ts` | Medium | High — fleet route correctness |
| 2c | `lib/vrp-solvers/two-opt.ts` | Medium | Medium |
| 3 | Server routers (7 files) | High | High — business logic with no safety net |
| 4 | `lib/crash-recovery.ts` | Low | Medium — data loss on crash |
| 5 | Zustand stores (`circuitStore` first) | Medium | Medium — cascading UI failures |
| 6 | Coverage infrastructure | Very low | High — makes all regressions visible |

## Recommended Rollout

1. **Immediate:** Coverage infrastructure (Priority 6) — one config change, no code.
2. **Next sprint:** Priority 1a–1d — pure functions, no mocking, high confidence gain fast.
3. **Following sprint:** Priority 2a–2c — algorithmic correctness for pruning and VRP solvers.
4. **Medium term:** Priority 3 — server router tests using the existing auth test pattern.
5. **Ongoing:** Priority 4–5 alongside feature work; add store tests when stores are modified.
