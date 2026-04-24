# Test Coverage Analysis

**Date:** 2026-03-19
**Current state:** 22 passing test suites, 332 tests, 3 skipped (integration)

## Summary

| Layer | Source Files | Tested Files | File Coverage | Approx Line Coverage |
|-------|-------------|-------------|--------------|---------------------|
| TypeScript (lib/) | ~115 | 10 | 8.7% | ~12% |
| TypeScript (server/) | 19 | 5 | 26% | ~38% |
| TypeScript (plugins/) | ~10 | 7 | 70% | ~49% |
| Python (backend/) | 14 | 7 | 50% | ~46% |
| **Total** | **~158** | **29** | **~18%** | **~22%** |

## Infrastructure Gaps

1. **No coverage reporting configured** — Vitest has no `coverage` section; there is no `@vitest/coverage-v8` dependency. We cannot measure line/branch coverage.
2. **No coverage thresholds** — No minimum coverage enforced, so regressions go unnoticed.
3. **No CI/CD test step** — CI builds and deploys without running tests. Broken code can ship to production.

## Priority 1: Cost Optimization Pipeline (5,300+ lines, 0% coverage)

These files form the core business logic for cost-based route optimization and are **completely untested**:

| File | Lines | What it does |
|------|-------|-------------|
| `lib/cost-data-collector.ts` | 1,143 | Collects fuel consumption, time variance, maintenance costs from actual routes |
| `lib/cost-model-validation.ts` | 1,132 | Cross-validates cost predictions vs actuals with statistical analysis |
| `lib/cpp-weight-integration.ts` | 1,043 | Feeds corrected cost weights back to the CPP solver |
| `lib/cpp-performance-tracker.ts` | 959 | Monitors solver execution time, convergence, diagnostics |
| `lib/cost-aware-route-optimizer.ts` | 883 | Returns fuel/labor/maintenance cost breakdowns |
| `lib/incremental-model-trainer.ts` | 839 | Online ML model training from route feedback |
| `lib/weight-feedback-monitor.ts` | 834 | Monitors cost-weight feedback loops |

**Why this matters:** This is the core value proposition — bugs here silently produce wrong cost recommendations and pricing.

**Recommended tests:**
- Unit tests for cost arithmetic (fuel, labor, maintenance calculations)
- Validation that weight updates converge and don't oscillate
- Edge cases: zero-distance routes, single-stop routes, negative cost corrections
- Statistical validation output accuracy (R², RMSE checks)

## Priority 2: Geographic/Navigation Algorithms (1,900+ lines, 0% coverage)

| File | Lines | What it does |
|------|-------|-------------|
| `lib/mapMatching.ts` | 913 | Snaps GPS traces to road network |
| `lib/turnAwareGraph.ts` | 793 | Turn-aware graph data structure for routing |
| `lib/douglas-peucker.ts` | 221 | Line simplification algorithm |

**Why this matters:** Incorrect map matching or graph construction corrupts all downstream routing. Douglas-Peucker errors silently degrade route quality.

**Recommended tests:**
- Map matching with known GPS traces and expected road segments
- Turn graph construction from sample intersections
- Douglas-Peucker with known geometric tolerance assertions
- Edge cases: U-turns, dead ends, one-way streets, disconnected graphs

## Priority 3: Server Routers & Proxies (1,600+ lines, 0% coverage)

| File | Lines | What it does |
|------|-------|-------------|
| `server/costHistoryRouter.ts` | 808 | MongoDB aggregation queries for cost analytics |
| `server/aiProxy.ts` | 414 | Proxies requests to LLM APIs |
| `server/optimizerRouter.ts` | 219 | Routes optimizer API calls |
| `server/orgRouter.ts` | 138 | Organization CRUD |

**Why this matters:** `costHistoryRouter` has complex MongoDB aggregation pipelines that are easy to get wrong. `aiProxy` handles auth tokens and request formatting for external APIs.

**Recommended tests:**
- Mock MongoDB aggregation pipeline results; validate query shape
- AI proxy request/response transformation tests
- Error handling: timeouts, malformed responses, auth failures

## Priority 4: Offline/Update Features (4,300+ lines, 0% coverage)

| File | Lines | What it does |
|------|-------|-------------|
| `lib/update-validation-rollback.ts` | 1,224 | Validates updates and rolls back on failure |
| `lib/offline-map-download.ts` | 1,209 | Downloads and manages offline map tiles |
| `lib/nightly-update-notifications.ts` | 1,121 | Schedules and delivers update notifications |
| `lib/offline-extract.ts` | 724 | Extracts OSM/Overture data for offline use |

**Why this matters:** These features run in the field on unreliable networks. Bugs here cause silent data corruption or crashed apps when users are on-route.

**Recommended tests:**
- Rollback logic: partial download recovery, version mismatch handling
- Tile cache eviction and storage quota management
- Notification scheduling edge cases (timezone, DST)
- Offline extraction with mock WebSocket connections

## Priority 5: Data Import/Export (900+ lines, 0% coverage)

| File | Lines | What it does |
|------|-------|-------------|
| `lib/osm-parser.ts` | 545 | Parses OSM XML into internal format |
| `lib/waste-import.ts` | 367 | Imports waste collection schedules |
| `lib/export-utils.ts` | 322 | Exports routes as GPX/GeoJSON |
| `lib/geojsonToOsmData.ts` | 197 | Converts GeoJSON to OSM format |

**Recommended tests:**
- Round-trip: export then import and compare
- Malformed input handling (truncated XML, invalid GeoJSON)
- Large dataset performance (>10k nodes)

## Priority 6: Python Backend Gaps

| File | Lines | What it does |
|------|-------|-------------|
| `backend/app/main.py` | 855 | FastAPI app setup, middleware, endpoints |
| `backend/app/overture.py` | 330 | Overture data extraction |
| `backend/app/tasks/optimize_task.py` | 111 | Celery async optimization |
| `backend/app/tasks/vrp_task.py` | 126 | Celery async VRP |

**Recommended tests:**
- FastAPI endpoint integration tests (TestClient)
- Celery task result handling, retry, and timeout behavior
- Overture extraction with mock data

## Quick Wins

These are small, high-value additions:

1. **Add Vitest coverage reporting** — Install `@vitest/coverage-v8`, configure thresholds
2. **Add test step to CI/CD** — Add `pnpm test` before build in CI.
3. **Test `douglas-peucker.ts`** — Pure algorithm, no dependencies, easy to test
4. **Test `geojsonToOsmData.ts`** — Pure data transformation, easy fixtures
5. **Test `export-utils.ts`** — Already have GPX tests in Python; mirror for TypeScript

## Recommended Coverage Targets

| Milestone | Target | Focus Area |
|-----------|--------|-----------|
| Short-term | 35% | Cost pipeline + geographic algorithms |
| Medium-term | 50% | Server routers + offline features |
| Long-term | 70% | Full coverage with integration tests |
