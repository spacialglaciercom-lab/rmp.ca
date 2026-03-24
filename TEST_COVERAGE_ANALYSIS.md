# Test Coverage Analysis

## Overview

**Project:** TrashRoute (rmp.ca) — cross-platform waste collection route planning app
**Tech Stack:** React Native/Expo, Node.js/Express/tRPC, Python FastAPI, Vitest (TS), pytest (Python)
**Date Analyzed:** 2026-03-19

## Current State

| Layer | Source Lines | Test Lines | Ratio |
|-------|-------------|-----------|-------|
| TypeScript (lib + server) | ~94,700 | ~2,100 | **2.2%** |
| Python backend | ~15,000 | ~2,300 | **~15%** |
| **Total** | **~110,000** | **~4,400** | **~4%** |

**Test files:** 14 Vitest + 7 pytest = 21 total
**CI/CD:** No test step in CI pipeline — tests are never run on deployment.

---

## What Is Tested (and Well)

| Area | File(s) | Quality |
|------|---------|---------|
| Coordinate validation | `coord-utils.test.ts` | Good — edge cases, NaN, null handling |
| GeoJSON generation | `geojson-utils.test.ts` | Good — shape validation, multi-vehicle |
| Cycle detection | `cycleDetector.test.ts` | Good — oscillation, tabu lists, SCC |
| Turn-aware CPP solver | `turnAwareCpp.test.ts` | Good — triangle, U-turns, 4×2 grid |
| Overture cache keys | `overtureExtractService.test.ts` | Good — bbox discrimination |
| Plugin registry lifecycle | `registry.test.ts` | Good — init/destroy/re-register |
| VRP solver registry | `vrp-solvers.test.ts` | Good — built-ins, custom registration |
| Weather plugin | `weather.test.ts` | Adequate — mock-based |
| Gate plugins | `gate-plugins.test.ts` | Adequate — contract tests |
| Auth (logout/me) | `auth.logout.test.ts` | Adequate — cookie clearing |

---

## Critical Gaps — Priority 1

### 1. Cost Optimization Pipeline (~3,300 lines, 0% coverage)
Six interconnected files with no tests at all:

- **`cost-correction-model.ts`** (~420 lines) — ML model that learns from historical data to improve cost estimates. No tests for prediction accuracy, confidence scores, or training logic.
- **`cost-aware-route-optimizer.ts`** (~680 lines) — integrates the cost model with route optimization; returns fuel/labor/maintenance breakdowns. Zero tests for cost calculations.
- **`cost-data-collector.ts`** (~830 lines) — calculates actual fuel consumption, time variance, maintenance costs from completed routes. No validation of the arithmetic.
- **`cpp-weight-integration.ts`** (~780 lines) — feeds corrected cost weights back into the CPP solver. No tests for weight updates, confidence thresholds, or DB persistence.
- **`cpp-performance-tracker.ts`** (~720 lines) — monitors solver execution time, convergence, and diagnostics. No tests.
- **`cost-model-validation.ts`** (~900 lines) — cross-validates cost predictions vs. actuals with statistical analysis. No tests for the validation algorithms.

**Why it matters:** This pipeline drives the core value proposition of cost-optimized routing. A bug in cost calculations silently produces wrong recommendations.

### 2. Navigation Engine (~550 lines, 0% coverage)
**`NavigationEngine.ts`** — the real-time turn-by-turn navigation state machine: snap-to-route, step progression, off-route detection, voice prompt triggers. No tests for:
- Location snapping accuracy
- Off-route threshold logic
- Step advancement conditions
- Navigation state transitions

### 3. Server Proxies (~1,570 lines, 0% coverage)
All external-service integration layers are untested:
- **`optimizerProxy.ts`** (~550 lines) — async 202+polling pattern, timeout management, retry logic
- **`aiProxy.ts`** (~400 lines) — LLM request proxying and message formatting
- **`wsExtractProxy.ts`** (~170 lines) — WebSocket proxy for extraction service
- **`mapsProxy.ts`** (~240 lines) — MapLibre/maps request proxy
- **`elevenLabsProxy.ts`** (~210 lines) — TTS proxy

The async polling loop in `optimizerProxy` is especially risky with no timeout or error-path tests.

---

## High-Priority Gaps — Priority 2

### 4. Route Optimization Core (minimal coverage)
The v2 `RouteOptimizer` is largely untested beyond the plugin-level mock tests already in place. Algorithm correctness under real inputs is unvalidated.

### 5. Cost History Router (~700 lines, 0% coverage)
**`costHistoryRouter.ts`** — complex MongoDB aggregations for cost trends and vehicle performance analytics. No query validation or aggregation correctness tests.

### 6. Geographic Algorithms
- **`douglass-peucker.ts`** (~180 lines) — line simplification used in route display; no geometric accuracy tests
- **`geojsonToOsmData.ts`** (~170 lines) — GeoJSON-to-OSM conversion; no conversion correctness tests
- **`bbox-region-download.ts`** (~300 lines) — offline tile download/caching; no tests

### 7. Export Utilities
**`export-utils.ts`** (~270 lines) — GPX and GeoJSON export generation. No format validation or encoding tests. Users downloading their routes could receive malformed files silently.

---

## Medium-Priority Gaps — Priority 3

- **`externalNavigation.ts`** (~350 lines) — handoff to Apple/Google Maps; no app-switching or URL-scheme tests
- **Python backend** — currently at ~15% coverage; vector operations and full OSRM integration paths are untested
- **Error recovery** — no tests for network failures, malformed backend responses, or partial data across any proxy
- **Database transactions** — no tests for concurrent writes or rollback scenarios

---

## Recommended Improvements

### Immediate (highest ROI)

1. **Add tests for `cost-correction-model.ts`** — unit test prediction outputs for known inputs, confidence score ranges, and training convergence.
2. **Add tests for `optimizerProxy.ts`** — mock the Python backend to test the 202-polling loop, backoff timing, and timeout/error paths.
3. **Add tests for `NavigationEngine.ts`** — mock the location provider; test snap-to-route with known polylines, off-route detection, and step progression.
4. **Add tests for `cost-data-collector.ts`** — verify fuel and time calculations against hand-computed values.
5. **Enable tests in CI/CD** — add a test step before the build/deploy steps.

### Short-Term

6. Add tests for `douglass-peucker.ts` — compare output against reference simplifications.
7. Add tests for `export-utils.ts` — parse exported GPX/GeoJSON and assert schema validity.
8. Add tests for `costHistoryRouter.ts` — use an in-memory MongoDB or mock Drizzle to validate aggregation queries.
9. Add tests for `geojsonToOsmData.ts` — round-trip conversion tests.

### Tooling Improvements

- Enable coverage reporting: add `--coverage` to the `test` script in `package.json` with a minimum threshold (e.g., 50% for `lib/`).
- Add `@vitest/coverage-v8` and configure thresholds in `vitest.config.ts` to fail CI when coverage drops.
- Consider snapshot testing for GeoJSON output functions to catch regressions automatically.

---

## Why Coverage Is Low

The existing tests focus on utilities and plugin contracts — areas that are easy to test in isolation. The untested code is all in areas that require mocking external dependencies (location services, HTTP backends, databases, WebSockets), which takes more setup effort but guards the most critical logic.
