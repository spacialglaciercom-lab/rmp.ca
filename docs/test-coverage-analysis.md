# Test Coverage Analysis

## Current State

The codebase has **19 test files** covering a small fraction of ~600+ source files:

| Layer | Source Files | Test Files | Coverage |
|---|---|---|---|
| `lib/` | ~178 TS files | 5 test files | ~3% |
| `lib/plugins/` | ~28 TS files | 7 test files | ~25% |
| `server/` | ~30 TS files | 2 test files | ~7% |
| `stores/` | 18 TS files | 0 | 0% |
| `services/` | 18 TS files | 0 | 0% |
| `hooks/` | 18 TS files | 0 | 0% |
| `backend/` (Python) | ~14 py files | 5 test files | ~43% |

The Python backend is relatively well-tested. The TypeScript frontend/lib layer is severely undertested.

---

## Priority Areas for Improvement

### 1. Route Optimization Core (Highest Priority)

**Why:** This is the core value proposition of the product. Bugs here directly affect route quality and cost efficiency.

**Files with no tests:**
- `lib/route-optimizer-v2/routeOptimizer.ts` — Right-side trash collection edge optimizer using Hierholzer. Builds adjacency lists, handles parallel edges (divided boulevards), resolves deadheads. No test for correctness of the actual output circuit.
- `lib/offline-optimizer-v2/optimizeFromGeoJSON.ts` — Converts GeoJSON to optimized routes with plugin support. The plugin pipeline (FuelAware, TurnPenalty) is never tested end-to-end.
- `lib/offline-optimizer-v2/routeOptimizerSimple.ts` — Simplified route optimizer with no tests at all.
- `lib/cost-aware-route-optimizer.ts` — Cost-optimal routing combining cost model predictions with route optimization. Produces efficiency scores, risk assessment, optimization recommendations.

**What to test:**
- That the Hierholzer-based optimizer produces valid Eulerian circuits (all edges traversed exactly once when graph is Eulerian)
- That deadhead edges are minimized in non-Eulerian graphs
- That the FuelAware and TurnPenalty plugins measurably affect output costs
- That GeoJSON input with various geometries (simple grid, irregular network, disconnected components) produces correct or graceful output
- Cost predictions are within reasonable bounds for known input configurations

---

### 2. Authentication & Authorization (High Priority)

**Why:** Security-critical. Bugs can expose user data or allow unauthorized access.

**Files with no tests:**
- `lib/_core/auth.ts` — Session token retrieval and storage with platform-aware logic (SecureStore on native, cookies on web). Zero tests.
- `server/_core/trpc.ts` — Authentication middleware (public, protected, admin, orgProcedure). The middleware chain that enforces access control on every API call.
- `server/_core/context.ts` — Request context setup that populates `user` and `org` on every tRPC call.
- `server/rbac/rbacRouter.ts` — Role-based access control router.

**Existing gaps in covered code:**
- `server/tests/auth.logout.test.ts` only tests `auth.me()` and `auth.logout()`. Missing: token revocation, concurrent session handling, org-scoped access enforcement, admin-only route protection.

**What to test:**
- Protected procedures reject unauthenticated requests (401)
- Admin procedures reject non-admin users (403)
- `orgProcedure` rejects users from different organizations
- Session token stored correctly per platform (SecureStore vs cookie)
- Logout invalidates the session and subsequent requests fail

---

### 3. Zustand Stores — State Management (High Priority)

**Why:** Stores are the single source of truth for the entire app. Corrupt or incorrect state causes cascading UI bugs that are hard to trace.

**Files with no tests (all 18 stores):**
- `stores/circuitStore.ts` — Persists the active `TurnEdge[]` circuit and `StreetEdge[]` graph after optimization. Used by re-optimization features (`rerouteFromBreakdown`, `insertEmergencyStopAt`). State corruption here means silently wrong re-routes.
- `stores/collectionNavigationStore.ts` — Navigation state: current step, progress, arrival detection.
- `stores/routeParametersStore.ts` — Turn penalties, fuel mode, and other optimization parameters that directly affect route quality.
- `stores/wastePointsStore.ts` — Waste collection point locations and status.

**What to test:**
- Initial state matches expected defaults
- State transitions are correct (e.g., advancing navigation steps)
- Persistence hydration restores correct shape (no missing fields after schema changes)
- Derived selectors return correct values
- Actions do not mutate state unexpectedly (immutability)
- `circuitStore`: inserting an emergency stop updates the circuit correctly; rerouting from breakdown produces a valid partial circuit

---

### 4. NavigationEngine (High Priority)

**Why:** Real-time navigation is safety-critical for drivers. Off-route detection, snap-to-route, and step advancement bugs can cause drivers to miss stops or get lost.

**File:** `lib/NavigationEngine.ts`

**What to test:**
- Snap-to-route correctly identifies the nearest edge within threshold
- Off-route detection triggers when GPS point is beyond tolerance
- Step advancement fires at the right moment (correct distance threshold)
- Distance remaining decrements correctly as the driver progresses
- Arrival detection triggers at the final stop
- Voice prompt generation produces correct instruction text for each turn type

---

### 5. `useRouteOptimization` Hook (High Priority)

**Why:** This is the main orchestration hook that wires together weather analysis, turn penalties, cost correction, backend calls, and progress callbacks. It has complex branching logic and is called on every "Optimize" action.

**File:** `hooks/useRouteOptimization.ts`

**What to test:**
- Calls the backend optimizer with correct parameters
- Weather analysis results are incorporated into penalty calculations
- Cost correction adjustments are applied before returning results
- Progress callbacks fire at correct milestones
- Errors from the backend surface correctly (no silent failures)
- Re-optimization (reroute from breakdown) produces a valid partial result

---

### 6. Cost Prediction Service (Medium Priority)

**Why:** Inaccurate cost predictions affect operational decisions (dispatching, budgeting, route selection).

**Files:**
- `services/costPredictionService.ts` — Budget constraint checking, optimization preferences, risk assessment.
- `lib/cost-correction-model.ts` — Fuel/labor/maintenance/overhead cost correction factors.
- `lib/incremental-model-trainer.ts` — Incremental ML updates without full retraining.

**What to test:**
- Predictions for known input configurations are within expected ranges
- Budget constraint enforcement (routes exceeding budget are flagged/rejected)
- Risk assessment correctly identifies high-cost-overrun scenarios
- Incremental model updates converge toward lower error over multiple training batches
- Cost model validation catches invalid parameters before they corrupt predictions

---

### 7. Server Database Layer (Medium Priority)

**Why:** The DB layer is the persistence backbone. Connection errors, retry logic bugs, or ORM misconfiguration cause data loss or corruption.

**Files:**
- `server/db.ts` — Drizzle ORM + Postgres. User/org upsert, lazy connection with retry, graceful degradation.
- `server/mongodb.ts` — MongoDB lazy initialization and connection management.

**What to test:**
- Upsert creates a new record when none exists
- Upsert updates an existing record without duplication
- Lazy connection initializes on first use, not on import
- Retry logic retries the configured number of times before giving up
- Graceful degradation returns a safe fallback when DB is unavailable
- Organization scoping prevents cross-org data access

---

### 8. Python Backend — Analytics & GPX Export (Medium Priority)

**Why:** Analytics power the route efficiency dashboard. GPX export is a user-facing feature for external nav apps and compliance records.

**Files:**
- `backend/app/analytics.py` — Route metrics: distance, turn breakdown, complexity, energy, fuel burn. No tests at all despite complex calculation logic.
- `backend/app/cpp_gpx.py` — CPP solution to GPX conversion.
- `backend/app/cvrp_gpx.py` — CVRP solution to GPX with 2-Opt improvement.
- `backend/app/gpx_export.py` — GPX file generation.

**What to test:**
- Analytics produces correct distance for known routes (compare with haversine ground truth)
- Turn breakdown counts match manually counted turns in a simple test graph
- Fuel burn increases with grade and decreases with tailwind
- GPX output is valid XML parseable by standard tools
- GPX waypoints match the optimized route sequence
- 2-Opt improvement in `cvrp_gpx.py` never increases total distance

---

### 9. Error Handling & Resilience (Medium Priority, Cross-Cutting)

Almost no existing tests cover failure scenarios. The following are systematically missing:

- **Network failures:** optimizer backend unavailable, OSRM unreachable, Overture API timeout
- **Malformed input:** invalid GeoJSON (null coordinates, self-intersecting polygons, empty features), negative capacity in VRP, impossible time windows
- **Disconnected graphs:** what happens when the road network has islands? (Python optimizer, Hierholzer, turnAwareCPP all need this)
- **Resource exhaustion:** very large GeoJSON (10k+ edges), VRP with 500+ stops, concurrent optimization requests

---

### 10. External Service Integrations (Lower Priority)

These are harder to unit test but warrant at least contract/mock tests:

- `services/weatherService.ts` & `services/weatherAiRouteAnalysis.ts` — Verify the correct API fields are read, caching TTL is respected, and API failures surface gracefully.
- `services/googleElevationService.ts` — Elevation sampling for a known coordinate returns expected range.
- `services/elevenLabsTtsService.ts` — TTS request is formed correctly (voice ID, text, format).
- `server/aiProxy.ts`, `server/osrmProxy.ts`, `server/mapsProxy.ts` — Proxy routes forward requests to the correct upstream and return errors transparently.

---

## Recommended Testing Approach

Given the scale of untested code, a pragmatic rollout:

1. **Immediate (next sprint):** Add tests for `routeOptimizer.ts` circuit correctness and `lib/_core/auth.ts` token logic — these are the highest risk areas.
2. **Short term:** Test `circuitStore` state transitions and `useRouteOptimization` hook with mocked backend.
3. **Medium term:** Cover `NavigationEngine`, `costPredictionService`, and `server/db.ts`.
4. **Ongoing:** Add error-path tests alongside any new feature work. Require tests for new `lib/` modules before merge.

For React hooks and stores, use `@testing-library/react-hooks` (or the Vitest equivalent) with Zustand's `create` mock pattern. For the Python backend, `pytest` with `httpx.AsyncClient` against the FastAPI app works well (already established in the existing test files).
