# Test Coverage Analysis

_Updated: 2026-03-19_

## Executive Summary

The codebase has solid unit tests for its core route-optimization algorithms, but large swaths of the application — VRP solvers, geospatial utilities, export/import helpers, React hooks, and all server-side routers — have no test coverage at all. This document maps the gaps and proposes specific, high-value tests to add.

---

## Current State

| Layer | Source Files | Test Files | Coverage |
|-------|-------------|------------|----------|
| `lib/` core algorithms | ~165 | 10 | Partial |
| `lib/plugins/` | ~20 | 7 | Good |
| `server/` | ~42 | 6 (integration only) | Minimal |
| `backend/` Python | ~23 | 8 | Partial |
| `components/` | ~97 | 0 | None |
| `hooks/` | ~18 | 0 | None |
| `services/` | ~18 | 0 | None |
| `stores/` | ~18 | 0 | None |
| `app/` screens | ~20 | 0 | None |

**Testing framework:** Vitest 4.x with jsdom; Python pytest for the FastAPI backend.

### What is already well-tested
- Core Chinese Postman / Eulerian circuit solver (`routeOptimizer.test.ts`)
- Turn-aware CPP solver (`turnAwareCpp.test.ts`)
- Cost-correction and cost-aware optimizer
- Coordinate utilities and GeoJSON helpers
- Plugin registry, config, and gate system
- Server proxy endpoints (smoke-level integration tests)

---

## Priority Areas for Improvement

The following areas are ordered by risk: **business-critical logic first**, then data-correctness utilities, then infrastructure.

---

### 1. VRP Solvers — `lib/vrp-solvers/`

**Files:** `clarke-wright.ts`, `two-opt.ts`, `sweep.ts`, `or-opt.ts`, `kmp.ts`

**Why critical:** These algorithms directly determine driver routes. An off-by-one in savings ranking or a broken 2-opt swap silently produces suboptimal — or illegal — routes that drivers follow in the field.

**Only existing coverage:** `lib/plugins/__tests__/vrp-solvers.test.ts` tests plugin *registration*, not the algorithms themselves.

**Recommended tests:**

```ts
describe('clarkeWrightSolver', () => {
  it('respects vehicle count (output routes <= numVehicles)')
  it('route savings are sorted descending before merging')
  it('each route starts and ends at the depot (index 0)')
  it('no stop appears in more than one route')
  it('all stops are covered across all routes')
  it('handles single vehicle — all stops in one route')
  it('handles single stop gracefully')
  it('applies max-stops-per-route capacity cap')
})

describe('twoOptSolver', () => {
  it('sweep phase clusters stops by angle from depot')
  it('2-opt never increases total route distance')
  it('2-opt converges (no improvement on second pass)')
  it('filters empty routes (length <= 2 nodes)')
  it('floating-point epsilon avoids infinite swap loops')
  it('all stops are covered across all routes')
})
```

---

### 2. OSM / GeoJSON Data Pipeline — `lib/osm-filter.ts`, `lib/osmToStreetEdges.ts`, `lib/geojsonToOsmData.ts`

**Why critical:** Bad filtering lets footways or private driveways into the routing graph, producing routes the truck cannot legally drive. Node deduplication bugs create duplicate graph nodes that break the Eulerian solver.

**Recommended tests:**

```ts
describe('osm-filter', () => {
  // shouldIncludeHighway
  it('includes: residential, unclassified, tertiary, secondary, living_street')
  it('excludes: footway, cycleway, steps, path, track, bridleway, pedestrian, corridor')
  it('includes service=alley, excludes service=driveway|parking_aisle|parking')
  it('excludes access=private regardless of highway type')
  it('excludes area=yes and area=parking')
  it('returns false for missing highway tag')

  // isOneWay
  it('recognises oneway=yes, oneway=1, oneway=true')
  it('recognises oneway=-1 as reverse-oneway')
  it('returns false for oneway=no and missing tag')

  // getStreetName
  it('prefers name over addr:street over name:en')
  it('returns undefined when no name tag present')
})

describe('osmToStreetEdges', () => {
  it('dead-end nodes are detected as intersections')
  it('nodes shared by two+ ways are detected as intersections')
  it('self-intersecting ways split at revisited node')
  it('intermediate shape-points are preserved in edge coordinates')
  it('haversineMeters returns expected distance for known coordinate pairs')
  it('oneway tag is propagated to StreetEdge')
  it('produces no edges when nodes array contains unknown IDs')
})

describe('geojsonToOsmData', () => {
  it('excludes footway/cycleway/pedestrian features by default')
  it('includes residential/tertiary/secondary by default')
  it('allowClasses override adds types not in default list')
  it('denyClasses override removes types from default list')
  it('coordinates within 1e-7 degrees share the same node')
  it('MultiLineString produces one OSMWay per sub-array')
  it('infers oneway from GeoJSON oneway/direction properties')
  it('round-trips: osmDataToGeoJSON(geojsonToOsmData(fc)) preserves all coordinates')
})
```

---

### 3. Export / Import Utilities — `lib/exportService.ts`, `lib/gpxLoader.ts`

**Why important:** Data exports are the primary deliverable users share with city GIS teams. A malformed OSM XML or broken CSV escape corrupts that hand-off.

**Recommended tests:**

```ts
describe('exportService', () => {
  describe('toCSV', () => {
    it('escapes commas in property values')
    it('escapes double-quotes by doubling them')
    it('extracts first coordinate from Point geometry')
    it('extracts first coordinate from LineString geometry')
    it('emits all unique property keys as headers')
    it('handles features with different property sets (union of keys)')
    it('handles empty FeatureCollection')
  })

  describe('toOSMXML', () => {
    it('escapes & < > " \' in tag values')
    it('all node IDs referenced in way appear in nodes section')
    it('output parses as valid XML (DOMParser roundtrip)')
    it('bounds element contains correct min/max lat/lon')
    it('coordinate precision is 7 decimal places')
  })

  describe('generateSummary', () => {
    it('counts roads, buildings, amenities correctly')
    it('returns zero counts for empty input')
  })
})

describe('gpxLoader', () => {
  it('detects http/https strings and fetches them')
  it('reads File objects via .text()')
  it('parses raw GPX XML strings directly')
  it('falls back to waypoints when no track/route found')
  it('throws when GPX has no points at all')
  it('returns coordinates in [lon, lat] order')
  it('rejects non-200 HTTP responses with a descriptive error')
})
```

---

### 4. Weather Analysis — `services/weatherAnalysis.ts`

**Why important:** Weather penalties feed directly into edge cost calculations and driver recommendations. Wrong thresholds produce bad scheduling advice that may cause unsafe driving conditions.

**Recommended tests:**

```ts
describe('scoreWeather', () => {
  it('returns 0 for clear-sky conditions')
  it('returns 30 for light snow (0 < snow <= 2 mm/h)')
  it('returns 50 for heavy snow (> 2 mm/h)')
  it('returns 20 for light rain (1-5 mm/h)')
  it('returns 35 for heavy rain (> 5 mm/h)')
  it('returns 40 for visibility < 500 m')
  it('returns 35 for wind >= 15 m/s')
  it('caps combined score at 100')
  it('thunderstorm adds 30')
})

describe('getWeatherPenaltyMultiplier', () => {
  it('returns 0 for clear conditions')
  it('returns a value in [0, 0.2] range for all inputs')
  it('increases monotonically with risk score')
})

describe('analyzeRouteWeather', () => {
  it('produces one SegmentWeatherRisk per input segment')
  it('overallRiskScore is average of segment risks')
  it('totalDelayMinutes aggregates correctly')
  it('generates alert when any segment risk >= 70')
  it('generates rule-based recommendation when Leap AI is disabled')
  it('handles empty segments array without throwing')
})
```

---

### 5. Map Matching — `lib/mapMatching.ts`

**Why important:** This is the bridge between optimized abstract routes and actual navigation instructions. Bugs here cause wrong turn-by-turn guidance.

**Recommended tests** (unit-level with fetch mocking):

```ts
describe('mapMatching', () => {
  it('delegates to OSRM when no Google API key is configured')
  it('delegates to Google when API key is present')
  it('downsamples traces to <= 100 points before calling Google Roads')
  it('preserves first and last point when downsampling')
  it('batches > 25 waypoints into chunks with overlap deduplication')
  it('parses OSRM route response into MatchedRoute steps')
  it('parses Google Directions response including encoded polyline')
  it('maps Google maneuver types to OSRM equivalents')
  it('falls back to offline matching on OSRM network failure')
  it('aggregates totalDistance and totalDuration across legs')
  it('rejects single-point input with a descriptive error')
  it('handles empty waypoint array')
})
```

---

### 6. Zustand Stores — `stores/`

**Why important:** Stores are the single source of truth for driver state (active circuit, navigation position, zones). Untested mutations can corrupt runtime state silently and are hard to debug in production.

**Recommended tests** (using `@testing-library/react` `renderHook`):

```ts
describe('circuitStore', () => {
  it('initialises with empty circuit and streetEdges')
  it('setCircuit atomically updates both circuit and streetEdges')
  it('clearCircuit resets both fields to empty arrays')
  it('multiple setCircuit calls override, not append')
  it('subscribers receive updated state after setCircuit')
})

describe('routeParametersStore', () => {
  it('default values match expected production defaults')
  it('setNumVehicles updates numVehicles')
  it('setTurnPenalty clamps value to valid range')
})

describe('zonesStore', () => {
  it('addZone appends a new zone with a unique ID')
  it('removeZone deletes by ID without affecting others')
  it('updateZone mutates only the target zone')
})
```

---

### 7. Server Routers — `server/optimizerRouter.ts`, `server/navigationRouter.ts`, `server/orgRouter.ts`, `server/rbac/rbacRouter.ts`

**Why important:** tRPC router logic (auth guards, input validation, DB queries) is completely uncovered. Auth bypass bugs in `rbacRouter` or `orgRouter` are high-severity security issues.

**Recommended tests** (using tRPC `createCaller` for unit tests):

```ts
describe('rbacRouter', () => {
  it('rejects unauthenticated callers on protected procedures')
  it('returns 403 when caller lacks required role')
  it('grants access when caller has correct role')
  it('assignRole validates that role is a known enum value')
})

describe('optimizerRouter', () => {
  it('rejects malformed GeoJSON input (zod validation error)')
  it('proxies valid request to Python backend')
  it('returns structured error on backend timeout')
})

describe('orgRouter', () => {
  it('createOrg requires authenticated user')
  it('getOrg returns 404 for unknown org ID')
  it('members can only access their own org data')
})
```

---

### 8. React Hooks — `hooks/useRouteOptimization.ts`, `hooks/useOsmOptimizeRoute.ts`

**Why important:** These hooks orchestrate the full optimization pipeline including parallel network calls, timeouts, and error recovery. Untested async edge cases surface as silent route failures in production.

**Recommended tests** (using `@testing-library/react` `renderHook` + `vi.mock`):

```ts
describe('useRouteOptimization', () => {
  it('selects turn-aware mode when isTurnAware is true')
  it('selects standard mode when isTurnAware is false')
  it('falls back to standard mode when turn-aware pipeline throws')
  it('merges weather + ML + traffic penalties before graph construction')
  it('parallel penalty fetches are abandoned after 8s timeout')
  it('coverage percentage = edgesTraversed / totalEdges')
  it('circuit includes all StreetEdges at least once')
  it('emits analytics events on success and failure')
})
```

---

## Quick Wins (Low Effort, High Value)

These can be added in a single PR with minimal setup:

| Test | Effort | Risk Mitigated |
|------|--------|----------------|
| `osm-filter` inclusion/exclusion rules | Low | Illegal roads in routing graph |
| `weatherAnalysis.scoreWeather` | Low | Wrong driver recommendations |
| `exportService.toCSV` CSV escaping | Low | Corrupted data exports |
| `circuitStore` state mutations | Low | Corrupted navigation state |
| `geojsonToOsmData` road-class filtering | Low | Same as osm-filter |
| `osmToStreetEdges` Haversine accuracy | Low | Wrong distance/speed calculations |

---

## Suggested Incremental Rollout

1. **Sprint 1 — Algorithms:** VRP solvers (clarke-wright, two-opt) + geospatial pipeline (osm-filter, osmToStreetEdges, geojsonToOsmData)
2. **Sprint 2 — Data integrity:** exportService, gpxLoader, weatherAnalysis
3. **Sprint 3 — State & hooks:** Zustand stores + core hooks (useRouteOptimization)
4. **Sprint 4 — Server:** tRPC router unit tests + RBAC security tests
5. **Sprint 5 — Components:** Integration/snapshot tests for highest-traffic screens (map, planner, route)

---

## Coverage Tooling Recommendation

Add `@vitest/coverage-v8` to generate HTML coverage reports:

```bash
pnpm add -D @vitest/coverage-v8
```

```ts
// vitest.config.ts — add coverage block
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'lcov'],
  include: ['lib/**', 'services/**', 'hooks/**', 'stores/**', 'server/**'],
  exclude: ['**/__tests__/**', '**/tests/**', '**/*.d.ts'],
  thresholds: { lines: 60, functions: 60 },   // raise incrementally over time
},
```

Run with: `vitest run --coverage`
