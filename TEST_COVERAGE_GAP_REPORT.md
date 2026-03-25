# Test Coverage Gap Report

**Project:** RouteMaster Pro (rmp.ca / TrashRoute)
**Date:** 2026-03-25
**Analyst:** Automated Gap Analysis

---

## Project Overview

| Attribute | Value |
|-----------|-------|
| **Language / Framework** | TypeScript / React Native (Expo 54) + Node.js (Express/tRPC) |
| **Total source files (.ts/.tsx)** | 599 |
| **Total test files** | 43 |
| **Test framework** | Vitest (unit/integration), Jest+Detox (E2E) |
| **Estimated current test coverage** | ~12-15% (43 test files covering ~60 of 599 source files) |
| **Test-to-source ratio** | 1 : 14 |

### Architecture Layers

| Layer | Source Files | Test Files | Coverage |
|-------|-------------|------------|----------|
| Server (API/tRPC) | ~45 | 8 | ~18% |
| Route Optimization (lib/) | ~65 | 14 | ~22% |
| Plugins (lib/plugins/) | ~15 | 8 | ~53% |
| Stores (Zustand) | ~18 | 3 | ~17% |
| Services (external APIs) | ~20 | 0 | **0%** |
| Hooks | ~20 | 1 | ~5% |
| Components (UI) | ~100+ | 0 | **0%** |
| Database/Sync | ~15 | 3 | ~20% |
| VRP Solvers | ~10 | 1 | ~10% |
| MapLibre Performance | ~6 | 0 | **0%** |

---

## Critical Gaps (Must Fix First)

### 1. `services/costPredictionService.ts` (716 lines)
- **Missing:** Entire `CostPredictionService` class -- singleton lifecycle, `predictCosts()`, `optimizeRoute()`, `recordActualCosts()`, learning queue batch processing
- **Risk:** Critical
- **Why:** ML cost prediction drives route optimization decisions and budget constraints. Singleton with mutable learning queue and async batch processing is highly bug-prone. Zero tests exist.
- **Recommended tests:**
  - `test_predictCosts_returns_valid_cost_breakdown()` (unit)
  - `test_predictCosts_handles_missing_weather_data()` (unit)
  - `test_learning_queue_batches_correctly()` (unit)
  - `test_recordActualCosts_updates_correction_model()` (unit)
  - `test_singleton_getInstance_returns_same_instance()` (unit)
  - `test_optimizeRoute_applies_budget_constraints()` (integration)
  - `test_concurrent_predictions_dont_corrupt_state()` (unit)
- **Test type:** Unit + Integration
- **File:** `services/__tests__/costPredictionService.test.ts`

### 2. `lib/database/sync/syncEngine.ts` (393 lines)
- **Missing:** `SyncEngine` class -- `startSync()`, `stopSync()`, `push()`, `pull()`, conflict handling, retry logic, timer management, network state subscription
- **Risk:** Critical
- **Why:** Offline-first sync is a core product feature for rural waste collection. Data loss or corruption during sync could mean lost collection records. The bidirectional sync with retry logic and timer management is complex and untested.
- **Recommended tests:**
  - `test_push_sends_pending_changes_to_server()` (unit)
  - `test_pull_applies_server_changes_locally()` (unit)
  - `test_sync_retries_on_network_failure()` (unit)
  - `test_sync_stops_when_offline()` (unit)
  - `test_sync_resumes_when_back_online()` (integration)
  - `test_concurrent_sync_calls_are_serialized()` (unit)
  - `test_sync_handles_server_error_gracefully()` (unit)
  - `test_timer_cleanup_on_stopSync()` (unit)
- **Test type:** Unit + Integration
- **File:** `lib/database/sync/__tests__/syncEngine.test.ts`

### 3. `lib/database/sync/conflictResolver.ts` (164 lines)
- **Missing:** `resolveConflict()`, `detectConflicts()`, strategy management, field-level merge logic
- **Risk:** Critical
- **Why:** Incorrect conflict resolution silently corrupts user data. Merge logic for timestamps and counters has subtle edge cases.
- **Recommended tests:**
  - `test_last_write_wins_selects_newer_record()` (unit)
  - `test_field_level_merge_combines_non_conflicting_fields()` (unit)
  - `test_conflict_detection_identifies_concurrent_changes()` (unit)
  - `test_strategy_per_table_overrides_default()` (unit)
  - `test_merge_handles_deleted_vs_updated_conflict()` (unit)
  - `test_timestamp_tie_breaking_is_deterministic()` (unit)
- **Test type:** Unit (pure logic -- easy to test)
- **File:** `lib/database/sync/__tests__/conflictResolver.test.ts`

### 4. `server/_core/context.ts` (59 lines) + `server/_core/trpc.ts`
- **Missing:** `createContext()` auth flow, `protectedProcedure` middleware, `adminProcedure` authorization, `orgProcedure` membership check
- **Risk:** Critical
- **Why:** Security-sensitive: every API request flows through this. Broken auth context = unauthorized access to all protected endpoints.
- **Recommended tests:**
  - `test_createContext_extracts_user_from_valid_token()` (unit)
  - `test_createContext_returns_null_user_for_no_token()` (unit)
  - `test_protectedProcedure_rejects_unauthenticated()` (unit)
  - `test_adminProcedure_rejects_non_admin_users()` (unit)
  - `test_orgProcedure_validates_org_membership()` (unit)
  - `test_permissionProcedure_checks_specific_permission()` (unit)
- **Test type:** Unit
- **File:** `server/tests/context.test.ts`

### 5. `server/rbac/rbacRouter.ts` (324 lines) -- Partially Tested
- **Missing:** `createRole`, `setRolePermissions`, `assignRole`, `removeRole`, `listRoles`, `myPermissions` -- only `requestAccess` and `resolveAccessRequest` are tested
- **Risk:** Critical
- **Why:** RBAC is the authorization backbone. Untested permission assignment and role management could allow privilege escalation.
- **Recommended tests:**
  - `test_createRole_with_valid_permissions()` (unit)
  - `test_createRole_rejects_duplicate_role_name()` (unit)
  - `test_assignRole_grants_permissions_to_user()` (unit)
  - `test_removeRole_revokes_user_permissions()` (unit)
  - `test_setRolePermissions_updates_existing_role()` (unit)
  - `test_myPermissions_aggregates_all_role_permissions()` (unit)
  - `test_non_admin_cannot_create_roles()` (unit)
- **Test type:** Unit + Integration
- **File:** `server/tests/rbac.roles.test.ts`

---

## High-Priority Gaps

### 6. `services/weatherService.ts` (343 lines)
- **Missing:** All 6 exported functions -- `getCurrentWeather()`, `getWeatherForRoutePoints()`, rate limiting, caching with TTL, spatial clustering
- **Risk:** High
- **Why:** Weather data drives route cost analysis and safety decisions. Module-level mutable state (`callsToday`, `rateLimitLoaded`) with race conditions.
- **Recommended tests:**
  - `test_getCurrentWeather_returns_cached_result_within_TTL()` (unit)
  - `test_getCurrentWeather_fetches_fresh_data_after_TTL()` (unit)
  - `test_rate_limiter_blocks_after_daily_limit()` (unit)
  - `test_getWeatherForRoutePoints_clusters_nearby_points()` (unit)
  - `test_getRemainingCallsEstimate_calculates_correctly()` (unit)
  - `test_invalidateWeatherCache_clears_all_cached_data()` (unit)
  - `test_API_failure_returns_graceful_fallback()` (unit)
- **Test type:** Unit (mock fetch + AsyncStorage)
- **File:** `services/__tests__/weatherService.test.ts`

### 7. `lib/onlineReopt/breakdownRerouter.ts` (80 lines)
- **Missing:** `rerouteAfterBreakdown()` -- Eulerian circuit slicing and re-optimization
- **Risk:** High
- **Why:** Vehicle breakdowns during collection require immediate rerouting. Algorithmic correctness is essential for operational continuity.
- **Recommended tests:**
  - `test_reroute_covers_remaining_unvisited_edges()` (unit)
  - `test_reroute_starts_from_current_position()` (unit)
  - `test_reroute_with_no_remaining_edges_returns_empty()` (unit)
  - `test_reroute_handles_disconnected_remaining_graph()` (unit)
- **Test type:** Unit (pure algorithmic)
- **File:** `lib/onlineReopt/__tests__/breakdownRerouter.test.ts`

### 8. `lib/onlineReopt/stopInsertion.ts` (170 lines)
- **Missing:** `insertEmergencyStop()` -- cheapest-insertion heuristic, detour cost calculation
- **Risk:** High
- **Why:** Emergency stop insertion (e.g., waste spill, blocked road) must produce valid, cost-efficient detours. Incorrect insertion corrupts the active circuit.
- **Recommended tests:**
  - `test_insertEmergencyStop_finds_cheapest_position()` (unit)
  - `test_detourSeconds_calculates_haversine_correctly()` (unit)
  - `test_insertion_preserves_circuit_validity()` (unit)
  - `test_insertion_with_single_edge_circuit()` (unit)
  - `test_insertion_at_circuit_boundaries()` (unit)
  - `test_buildDetourEdge_creates_valid_synthetic_edge()` (unit)
- **Test type:** Unit (pure algorithmic)
- **File:** `lib/onlineReopt/__tests__/stopInsertion.test.ts`

### 9. `lib/onlineReopt/trafficFeed.ts` (198 lines)
- **Missing:** `fetchTrafficMultipliers()`, `applyTrafficToEdges()`, `mergeTrafficPenalties()`, `edgesToBBox()`
- **Risk:** High
- **Why:** Traffic multipliers affect real-time route costs. Incorrect multipliers lead to suboptimal collection routes in congested areas.
- **Recommended tests:**
  - `test_applyTrafficToEdges_multiplies_edge_costs()` (unit)
  - `test_mergeTrafficPenalties_combines_multiple_sources()` (unit)
  - `test_edgesToBBox_computes_correct_bounds()` (unit)
  - `test_fetchTrafficMultipliers_falls_back_to_freeflow()` (unit)
  - `test_speed_ratio_below_threshold_increases_penalty()` (unit)
- **Test type:** Unit
- **File:** `lib/onlineReopt/__tests__/trafficFeed.test.ts`

### 10. `services/speechToTextService.ts` (263 lines)
- **Missing:** `transcribe()`, `isMoonshineAvailable()`, `startMoonshineStream()`, `transcribeFileMoonshine()`, `transcribeServerSide()`, platform-specific branching
- **Risk:** High
- **Why:** Voice command input is a key feature for hands-free collection. Platform branching (native Moonshine vs. server Whisper) has multiple failure paths.
- **Recommended tests:**
  - `test_transcribe_uses_moonshine_when_available()` (unit)
  - `test_transcribe_falls_back_to_server_when_moonshine_unavailable()` (unit)
  - `test_isMoonshineAvailable_returns_false_on_web()` (unit)
  - `test_transcribeServerSide_sends_audio_to_tRPC()` (unit)
  - `test_transcribe_handles_empty_audio_buffer()` (unit)
  - `test_streaming_subscription_cleanup_on_cancel()` (unit)
- **Test type:** Unit (mock native modules + tRPC client)
- **File:** `services/__tests__/speechToTextService.test.ts`

### 11. VRP Solvers -- Individual Algorithms (6 files, ~830 lines total)
- **Missing:** `clarke-wright.ts`, `sweep.ts`, `two-opt.ts`, `or-opt.ts`, `kmp.ts`, `utils.ts` -- only the registry (`index.ts`) is tested
- **Risk:** High
- **Why:** Each solver produces vehicle routes for fleet dispatching. Algorithmic bugs cause inefficient routes or missed stops.
- **Recommended tests (per solver):**
  - `test_clarke_wright_merges_routes_by_savings()` (unit)
  - `test_sweep_creates_angular_partitions()` (unit)
  - `test_two_opt_improves_route_length()` (unit)
  - `test_or_opt_relocates_segments_correctly()` (unit)
  - `test_solver_handles_single_vehicle()` (unit)
  - `test_solver_respects_capacity_constraints()` (unit)
  - `test_solver_handles_empty_jobs()` (unit)
  - `test_utils_buildDistanceMatrix_correct_haversine()` (unit)
- **Test type:** Unit (pure algorithmic -- property-based tests ideal)
- **File:** `lib/vrp-solvers/__tests__/<solver-name>.test.ts`

### 12. Stores Without Tests (15 stores)
- **Missing:** `wastePointsStore`, `markersStore`, `syncStatusStore`, `mapLayerStore`, `collectionNavigationStore`, `helpStore`, `mapStateStore`, `routesStore`, `zonesStore`, `favoritesStore`, `displayModeStore`, `mapWebPluginsStore`, `recordingSettingsStore`, `pluginStore`, `mapSidebarStore`, `enhancedQuickDestinationsStore`
- **Risk:** High (collectively)
- **Why:** Zustand stores hold all app state. 15 of 18 stores are untested. State corruption leads to UI bugs and data loss.
- **Recommended tests (priority order):**
  - `test_routesStore_add_and_remove_route()` (unit)
  - `test_collectionNavigationStore_advances_to_next_stop()` (unit)
  - `test_syncStatusStore_transitions_isSyncing_correctly()` (unit)
  - `test_zonesStore_updates_zone_geometry()` (unit)
  - `test_favoritesStore_persists_to_async_storage()` (unit)
- **Test type:** Unit
- **File:** `stores/__tests__/<store-name>.test.ts`

---

## Medium-Priority Gaps

### 13. `services/voiceCommandService.ts` (217 lines)
- **Missing:** `VoiceCommandService` class -- intent matching, native module lifecycle, event listeners
- **Risk:** Medium
- **Why:** Voice commands are a convenience feature. Intent matching bugs degrade UX but don't cause data loss.
- **Recommended tests:**
  - `test_matchIntent_identifies_navigation_commands()` (unit)
  - `test_matchIntent_returns_null_for_unknown_input()` (unit)
  - `test_service_cleanup_removes_event_listeners()` (unit)
- **Test type:** Unit
- **File:** `services/__tests__/voiceCommandService.test.ts`

### 14. `lib/maplibre-performance/optimized-tile-cache.ts` (85 lines)
- **Missing:** `OptimizedTileCache` class -- LRU eviction, hit rate tracking, memory limit enforcement
- **Risk:** Medium
- **Why:** Cache bugs cause memory leaks or unnecessary network requests. Simple to test.
- **Recommended tests:**
  - `test_cache_evicts_LRU_entry_when_full()` (unit)
  - `test_cache_get_updates_access_order()` (unit)
  - `test_cache_hitRate_calculates_correctly()` (unit)
  - `test_cache_respects_memory_limit()` (unit)
- **Test type:** Unit (pure data structure)
- **File:** `lib/maplibre-performance/__tests__/optimized-tile-cache.test.ts`

### 15. `lib/maplibre-performance/worker-pool.ts` (169 lines)
- **Missing:** `WorkerPool` class -- task queuing, worker lifecycle, Blob URL management, transferable optimization
- **Risk:** Medium
- **Why:** Worker pool bugs cause memory leaks or tile decoding hangs. Hard to debug in production.
- **Recommended tests:**
  - `test_pool_distributes_tasks_across_workers()` (unit)
  - `test_pool_queues_tasks_when_all_workers_busy()` (unit)
  - `test_pool_terminate_cleans_up_blob_urls()` (unit)
  - `test_pool_handles_worker_error_gracefully()` (unit)
- **Test type:** Unit (mock Web Worker API)
- **File:** `lib/maplibre-performance/__tests__/worker-pool.test.ts`

### 16. `hooks/useBackgroundSync.ts` (115 lines)
- **Missing:** `useBackgroundSync()` hook -- sync lifecycle, network state binding, cleanup
- **Risk:** Medium
- **Why:** Background sync bugs cause stale data or battery drain. Complex lifecycle management.
- **Recommended tests:**
  - `test_hook_starts_sync_when_online()` (unit)
  - `test_hook_stops_sync_when_offline()` (unit)
  - `test_hook_cleanup_on_unmount()` (unit)
  - `test_getBackgroundSyncStatus_returns_current_state()` (unit)
- **Test type:** Unit (React Testing Library + mock dependencies)
- **File:** `hooks/__tests__/useBackgroundSync.test.ts`

### 17. `hooks/useCollectionNavigation.ts` (178 lines)
- **Missing:** `useCollectionNavigation()` -- segment handling, street name deduplication, voice announcement timing
- **Risk:** Medium
- **Why:** Navigation UX feature. Bugs cause wrong street names or missed announcements.
- **Recommended tests:**
  - `test_navigation_advances_to_next_segment()` (unit)
  - `test_voice_announces_upcoming_turn()` (unit)
  - `test_deduplicates_consecutive_same_street()` (unit)
  - `test_handles_route_with_single_segment()` (unit)
- **Test type:** Unit
- **File:** `hooks/__tests__/useCollectionNavigation.test.ts`

### 18. `hooks/useBackgroundTracking.ts` (106 lines)
- **Missing:** `startBackgroundTracking()`, `stopBackgroundTracking()` -- permission handling, task manager registration
- **Risk:** Medium
- **Why:** GPS tracking in background is platform-sensitive. Permission flow bugs break the entire tracking feature.
- **Recommended tests:**
  - `test_startTracking_requests_background_permission()` (unit)
  - `test_startTracking_registers_task_manager()` (unit)
  - `test_stopTracking_unregisters_task()` (unit)
  - `test_tracking_skips_if_permission_denied()` (unit)
- **Test type:** Unit (mock expo-task-manager + expo-location)
- **File:** `hooks/__tests__/useBackgroundTracking.test.ts`

### 19. Server Routers Without Tests
- **Missing:** `navigationRouter.ts`, `voiceRouter.ts`, `rag/ragRouter.ts`, `syncRouter.ts`, `aiProxy.ts`, `osrmProxy.ts`
- **Risk:** Medium
- **Why:** API endpoints serving critical features with no tests. Integration surface with external services.
- **Recommended tests:**
  - `test_navigationRouter_generates_turn_by_turn_steps()` (unit)
  - `test_voiceRouter_transcribe_returns_text()` (unit)
  - `test_ragRouter_ingest_stores_document()` (unit)
  - `test_ragRouter_query_returns_relevant_results()` (unit)
  - `test_syncRouter_push_applies_changes()` (unit)
  - `test_osrmProxy_forwards_requests_correctly()` (unit)
- **Test type:** Unit + Integration
- **File:** `server/tests/<router-name>.test.ts`

### 20. `lib/turnAwareGraph.ts` (793 lines) -- Partially Tested
- **Missing:** `buildTurnExpandedGraph()` edge cases, `bridgeAllSCCs()`, `makeEulerian()`, bearing/angle calculations, progress callbacks
- **Risk:** Medium-High
- **Why:** Core graph construction for the CPP solver. Partial coverage via `turnAwareCpp.test.ts` but many edge cases untested.
- **Recommended tests:**
  - `test_buildTurnExpandedGraph_handles_dead_end_streets()` (unit)
  - `test_bridgeAllSCCs_connects_disconnected_components()` (unit)
  - `test_makeEulerian_balances_odd_degree_nodes()` (unit)
  - `test_bearing_calculation_wraps_at_360()` (unit)
  - `test_progress_callback_reports_correctly()` (unit)
  - `test_handles_graph_with_single_node()` (boundary)
- **Test type:** Unit
- **File:** `lib/__tests__/turnAwareGraph.test.ts`

---

## Low-Priority / Nice-to-Have Gaps

### 21. UI Components (~100+ files, 0% coverage)
- **Missing:** All React components in `components/` -- rendering, interactions, state changes
- **Risk:** Low (individually) / Medium (collectively)
- **Why:** UI components are mostly presentational wrappers. Visual regressions are better caught with snapshot/E2E tests.
- **Recommended approach:**
  - Snapshot tests for layout-critical components (`mapTab/`, `zones/`, `route/`)
  - Interaction tests for form components (`TurnPenaltyConfig`, `settings/`, `navigation/`)
  - `test_TurnPenaltyConfig_updates_penalty_values()` (unit)
  - `test_NavigationPanel_displays_next_turn()` (unit)
  - `test_WeatherIndicator_shows_warning_for_bad_weather()` (unit)
- **Test type:** Component tests (React Testing Library) + Snapshot

### 22. `services/elevenLabsTtsService.ts`
- **Missing:** TTS client logic, voice selection, audio playback
- **Risk:** Low
- **Why:** Server proxy is tested; client-side is thin wrapper.
- **Recommended tests:**
  - `test_synthesize_sends_correct_params()` (unit)
  - `test_handles_missing_api_key()` (unit)

### 23. `lib/firebase/` (multiple files)
- **Missing:** Firebase AI integration, GPX storage, auth helpers
- **Risk:** Low
- **Why:** Thin wrappers around Firebase SDK. SDK is well-tested.
- **Recommended tests:**
  - `test_uploadGpx_stores_file_to_storage()` (integration)
  - `test_auth_helpers_format_tokens_correctly()` (unit)

### 24. `lib/themes/` and `shared/theme.ts`
- **Missing:** Theme configuration and color utilities
- **Risk:** Low
- **Why:** Static configuration. Visual issues caught in review.

### 25. Scripts (`scripts/`)
- **Missing:** Build scripts, patch scripts, utility scripts
- **Risk:** Low
- **Why:** CI/CD scripts run in controlled environments. Failures are immediately visible.

---

## Overall Recommendations

### Coverage Goal
- **Target:** 50% line coverage within 3 months, 70% within 6 months
- **Current estimated:** ~12-15%
- **Quick wins to reach 30%:** Test services, stores, and sync engine (all have clear boundaries)

### Testing Strategy Improvements

1. **Establish test infrastructure for services/**
   - Create shared mock factories for: `AsyncStorage`, `fetch`, `expo-*` modules, `tRPC client`
   - Add a `test-utils/` directory with reusable mocks and fixtures

2. **Add property-based testing for algorithms**
   - VRP solvers, graph algorithms, and cost models are ideal candidates
   - Use `fast-check` library with Vitest for property-based tests
   - Properties: "solver visits all stops", "Eulerian circuit has equal in/out degree", "cost is always non-negative"

3. **Add contract tests for server/client boundary**
   - tRPC procedures should have contract tests ensuring request/response shapes
   - Use `zod` schemas (already in use) as contract definitions

4. **Expand E2E coverage**
   - Current: 1 Detox E2E test file (offline-sync)
   - Add: Route optimization flow, voice command flow, navigation flow
   - Consider Playwright for web E2E tests (currently zero web E2E)

### Missing Test Utilities

| Utility | Purpose | Priority |
|---------|---------|----------|
| `createMockSyncEngine()` | Test sync interactions | High |
| `createMockWeatherService()` | Test weather-dependent code | High |
| `createMockTrpcClient()` | Test server calls from client | High |
| `createMockGraph(edges)` | Test graph algorithms | Medium |
| `createMockGeoJSON(points)` | Test spatial operations | Medium |
| `createMockLocation(lat, lng)` | Test navigation/GPS code | Medium |
| `createMockAsyncStorage()` | Already exists but should be centralized | Low |

### Quick Wins (Biggest Coverage Boost)

| Action | Est. New Coverage | Effort |
|--------|-------------------|--------|
| Test `conflictResolver.ts` (pure logic, 164 lines) | +1% | Low (2 hours) |
| Test `optimized-tile-cache.ts` (pure data structure, 85 lines) | +0.5% | Low (1 hour) |
| Test all VRP solvers (pure algorithms, ~830 lines) | +3% | Medium (1 day) |
| Test `stopInsertion.ts` + `breakdownRerouter.ts` (250 lines) | +1% | Low (3 hours) |
| Test remaining 15 Zustand stores (simple state) | +4% | Medium (1 day) |
| Test `trafficFeed.ts` (pure functions, 198 lines) | +0.5% | Low (2 hours) |
| Test `weatherService.ts` (mock fetch, 343 lines) | +1.5% | Medium (4 hours) |
| **Total quick wins** | **~11.5%** | **~3.5 days** |

### Recommended Libraries/Tools

| Tool | Purpose | Already in Use? |
|------|---------|----------------|
| **Vitest** | Unit + integration tests | Yes |
| **@testing-library/react** | Component testing | Yes (devDep) |
| **fast-check** | Property-based testing for algorithms | No -- add |
| **msw** (Mock Service Worker) | API mocking for integration tests | No -- add |
| **Detox** | Mobile E2E | Yes |
| **Playwright** | Web E2E | No -- add |
| **c8/v8** | Coverage reporting | Yes (Vitest built-in) |

---

## Summary Matrix

| Priority | Files/Areas | Gap Count | Est. Effort |
|----------|-------------|-----------|-------------|
| **Critical** | Auth context, sync engine, conflict resolver, cost prediction, RBAC | 5 | 3-4 days |
| **High** | Weather, speech, VRP solvers, online re-opt, stores | 7 | 5-6 days |
| **Medium** | Hooks, worker pool, tile cache, server routers, graph edge cases | 8 | 4-5 days |
| **Low** | UI components, Firebase wrappers, themes, scripts | 5 | 3-4 days |
| **Total** | | **25** | **~15-19 days** |

---

*Report generated by automated gap analysis. Prioritize Critical and High gaps for immediate action. Quick wins (pure algorithmic functions) can be parallelized across team members.*
