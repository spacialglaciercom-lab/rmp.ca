# RouteMasterPro Codebase Audit Report

**Date**: 2026-04-16
**Scope**: Core geographic routing logic, optimization algorithms, formal verification, test coverage
**Branch**: `claude/audit-codebase-structure-gM6VJ`

---

## Part 1: Lean 4 Formal Specifications (New)

Four new Lean 4 verification modules have been added under `Verification/`, targeting the gaps identified in the existing proof suite. The existing proofs only covered Hierholzer termination and the `visited_states` dead-code bug. The new modules extend formal guarantees to the entire routing pipeline.

### 1.1 `Verification/MakeEulerian.lean` — Degree Balancing Termination

**Covers**: `lib/turnAwareGraph.ts:makeEulerian()` (lines 605–784)

| Theorem | Property |
|---------|----------|
| `augmentation_decreases_surplus` | Each Dijkstra-augmentation step strictly reduces the total degree imbalance |
| `surplus_bounded_below` | Surplus sum is a natural number (bounded below by 0) |
| `max_augmentation_rounds` | At most `initialSurplus` augmentation rounds |
| `balanced_implies_eulerian` | Post-condition: surplus = 0 implies in-deg = out-deg everywhere |
| `deadhead_bound` | Deadhead edge count bounded by `rounds × maxPathLen` |
| `surplus_at_most_double_edges` | Initial surplus ≤ 2·|E| |
| `dijkstra_step_decreases` | Dijkstra within augmentation: unvisited-set shrinks monotonically |
| `dijkstra_terminates` | Dijkstra terminates in ≤ |V| steps |
| `safety_cap_guarantees_termination` | TypeScript `MAX_BALANCE_ITERATIONS` cap ensures halt |
| `partial_balance_residual` | Residual surplus after early termination is bounded |

### 1.2 `Verification/BridgeSCC.lean` — SCC Bridging Termination

**Covers**: `lib/turnAwareGraph.ts:computeSCCs()` (lines 257–349) and `bridgeAllSCCs()` (lines 391–598)

| Theorem | Property |
|---------|----------|
| `kosaraju_forward_step_decreases` | Forward DFS: visited-set grows → measure decreases |
| `kosaraju_forward_terminates` | Forward DFS completes in exactly |V| steps |
| `kosaraju_reverse_step_decreases` | Reverse DFS: assigned-set grows → measure decreases |
| `scc_count_lower_bound` / `scc_count_upper_bound` | 1 ≤ |SCCs| ≤ |V| |
| `bridge_step_decreases` | Each SCC bridged reduces remaining count by 1 |
| `bridge_loop_terminates` | At most |SCCs| − 1 Dijkstra calls |
| `bridge_count_correct` | bridge count + 1 = non-dropped SCC count |
| `pipeline_terminates` | Full pipeline (SCC → Bridge → Euler → CPP) terminates |

### 1.3 `Verification/CircuitCompleteness.lean` — Edge Conservation

**Covers**: `lib/turnAwareCpp.ts:solveTurnAwareCPP()` (lines 30–283)

| Theorem | Property |
|---------|----------|
| `advance_consumes_one` | Each advance step consumes exactly one edge |
| `conservation_on_advance` / `conservation_on_pop` | consumed + remaining = E (invariant) |
| `complete_circuit_iff_all_consumed` | Circuit complete ↔ remaining = 0 |
| `circuit_has_E_edges` | Final circuit has exactly E edges |
| `pointer_monotone` | Adjacency pointer is monotone → no edge duplication |
| `edge_consumed_at_most_once` | Each edge appears exactly once in circuit |
| `eulerian_after_balance` | makeEulerian ensures in-deg = out-deg |
| `turn_stats_sum` | Turn stats sum = circuit length |

### 1.4 `Verification/TwoOptTermination.lean` — TSP Heuristic Termination

**Covers**: `lib/routeSolverLocal.ts:twoOptImprove()` (lines 104–135) and `orOptImprove()` (lines 145–174)

| Theorem | Property |
|---------|----------|
| `two_opt_swap_decreases` | Each 2-opt swap strictly reduces tour distance |
| `or_opt_move_decreases` | Each Or-opt move strictly reduces tour distance |
| `finite_tours_implies_termination` | Finite distinct tours → algorithm terminates |
| `nn_terminates` | Nearest-neighbor visits n cities in n steps |
| `solver_pipeline_terminates` | NN + 2-opt + Or-opt composition terminates |
| `two_opt_with_cap_terminates` / `or_opt_with_cap_terminates` | Safety caps guarantee halt |

---

## Part 2: Coverage Analysis — Identified Gaps

### 2.1 Untested Modules (Critical)

| Module | File | Lines | Gap |
|--------|------|-------|-----|
| Turn-expanded graph construction | `lib/turnAwareGraph.ts` | 794 | **No unit tests at all.** `buildTurnExpandedGraph`, `computeSCCs`, `restrictToLargestSCC`, `bridgeAllSCCs`, `makeEulerian` are entirely unverified by TypeScript tests. |
| Hierholzer navigation instructions | `lib/hierholzerInstructions.ts` | 351 | No tests for `generateHierholzerInstructions`, `instructionsToMatchedSteps`, `buildMatchedRouteFromHierholzer`. |
| Route loop pruner | `lib/route-loop-pruner.ts` | 178 | No tests for `pruneRouteLoops`. |
| Local TSP solver | `lib/routeSolverLocal.ts` | 298 | No dedicated unit tests for `nearestNeighbor`, `twoOptImprove`, `orOptImprove`, `solveLocal`, `estimateRouteStats`. (Only tested indirectly via `TESTS/server/tsp-solver.test.ts`.) |

### 2.2 Untested Edge Cases in Tested Modules

**`solveTurnAwareCPP` (lib/turnAwareCpp.ts)**:
- Disconnected graph passed directly (without bridging)
- Non-Eulerian graph (unbalanced degrees, no `makeEulerian` pre-processing)
- Graph hitting the `maxIterations` safety cap (`turnEdges.length * 10`)
- Empty edge array
- Single-edge graph
- Graph with only deadhead edges
- `turnCircuitToRoutePoints` with bridge edges being skipped

**`CycleDetector` (lib/cycleDetector.ts)**:
- SCC revisit detection (`scc-revisit` loop type) — only indirectly tested
- Tabu expiry after `recentWindowSize * 2` iterations
- `addTabu` public API with `extraWindowMultiplier`
- Concurrent oscillation + zero-progress detection
- `updateLowlink` with various edge types (tree vs back edge)

**`makeEulerian` (lib/turnAwareGraph.ts)**:
- Already-Eulerian graph (early return path)
- Graph where Dijkstra fails to find any path (disconnected excess nodes)
- Hitting `MAX_BALANCE_ITERATIONS` (500) or `MAX_DEADHEAD_EDGES` (4×|E|)
- Single-node graph with self-loops

**`bridgeAllSCCs` (lib/turnAwareGraph.ts)**:
- Graph with only one SCC (early return)
- All small SCCs unreachable (all dropped)
- Dijkstra hitting `MAX_DIJKSTRA_STEPS` (50000)

### 2.3 Formal Verification Gaps (Pre-Existing, Now Partially Addressed)

| Gap | Status |
|-----|--------|
| Hierholzer termination (basic measure) | **Existing** — `Verification/Basic.lean` |
| `visited_states` dead code | **Existing** — `Verification/Basic.lean` |
| O(E) vs O(E²) complexity | **Existing** — `Verification/Mathlib.lean` |
| `makeEulerian` termination | **NEW** — `Verification/MakeEulerian.lean` |
| `bridgeAllSCCs` / Kosaraju termination | **NEW** — `Verification/BridgeSCC.lean` |
| Circuit completeness & edge conservation | **NEW** — `Verification/CircuitCompleteness.lean` |
| 2-opt / Or-opt termination | **NEW** — `Verification/TwoOptTermination.lean` |
| Graph connectivity after bridging | Partially covered (bridge count theorem) |
| Turn penalty correctness (bearing math) | Not formally verified (trigonometric — difficult to express in Lean without real analysis) |
| Haversine distance correctness | Not formally verified (same reason) |

---

## Part 3: Maintainability Assessment

### 3.1 Critical Issues (Priority: High)

#### **P1: Three Duplicated Hierholzer Implementations**

| Implementation | File | Lines |
|---------------|------|-------|
| Turn-aware CPP | `lib/turnAwareCpp.ts` | 295 |
| Route Optimizer v2 | `lib/route-optimizer-v2/routeOptimizer.ts` | ~800 (Hierholzer portion) |
| Offline Optimizer v2 | `lib/offline-optimizer-v2/routeOptimizerSimple.ts` | ~400 (Hierholzer portion) |

**Problem**: Three separate Hierholzer implementations with different cycle-detection, turn-penalty, and edge-selection heuristics. Bug fixes in one are not propagated to others. The `routeOptimizer.ts` has its own `CycleDetector` integration that differs from `turnAwareCpp.ts`.

**Recommendation**: Extract a single `hierholzer(adjacencyGraph, options)` function into a shared module (`lib/_core/hierholzer.ts`). Parameterize it with:
- Edge selection strategy (turn-cost-aware vs. simple)
- Cycle detection configuration (on/off, thresholds)
- Progress callback

Route-specific concerns (turn penalties, deadhead preference) become injected strategies rather than inline code.

#### **P2: `turnAwareGraph.ts` is a 794-Line Monolith**

This file contains five distinct responsibilities:
1. Bearing computation and turn classification (lines 11–36)
2. Adjacency list construction (lines 48–69)
3. Turn-expanded graph construction (lines 78–236)
4. SCC computation — Kosaraju's algorithm (lines 257–349)
5. SCC bridging with Dijkstra (lines 391–598)
6. Eulerian degree balancing (lines 605–784)

**Recommendation**: Split into:
- `lib/_core/bearing.ts` — `calculateBearing()`, `classifyTurn()` (reusable by navigation too)
- `lib/_core/scc.ts` — `computeSCCs()`, `restrictToLargestSCC()`
- `lib/turnExpandedGraph.ts` — `buildTurnExpandedGraph()` (the graph construction)
- `lib/eulerianBalance.ts` — `makeEulerian()`, `bridgeAllSCCs()`

#### **P3: Five Duplicate Haversine Implementations**

| File | Function |
|------|----------|
| `lib/hierholzerInstructions.ts:49` | `haversine(p1, p2)` |
| `lib/routeSolverLocal.ts:42` | `haversineDistance(lat1, lon1, lat2, lon2)` |
| `lib/route-loop-pruner.ts:59` | `haversineKm(a, b)` |
| `lib/routing_plugins.ts` | `haversineMeters(a, b)` |
| `lib/coord-utils.ts` | (likely another variant) |

**Recommendation**: Consolidate into `lib/_core/geo.ts` with a single `haversineMeters(lat1, lon1, lat2, lon2): number` function. Re-export convenience wrappers if needed.

### 3.2 Moderate Issues (Priority: Medium)

#### **P4: Priority Queue Uses Linear Scan (O(n) per operation)**

Both `bridgeAllSCCs` (line 500–508) and `makeEulerian` (line 695–704) implement priority queues as sorted arrays with `pq.shift()` and `pq.splice(ins, 0, ...)`. This is O(n) per enqueue/dequeue.

**Impact**: For large graphs (10K+ turn edges), Dijkstra degrades from O((V+E) log V) to O(V²).

**Recommendation**: Use a binary min-heap. A lightweight implementation (~40 lines) or `@datastructures-js/priority-queue` would bring this to O(log V) per operation.

#### **P5: Mathematical Logic Bleeds into Spatial Data Layer**

`turnAwareGraph.ts` mixes:
- Pure graph theory: SCC computation, Eulerian balancing (math)
- Geographic computation: bearing calculation, coordinate trigonometry (spatial)
- Graph construction: adjacency list building, edge iteration (structural)

These concerns have different change frequencies and different testing strategies. Bearing math rarely changes; SCC algorithms are stable; graph construction changes with new feature flags.

**Recommendation**: Apply the decomposition from P2. Each module can be independently tested and has a single reason to change.

#### **P6: `CycleDetector` Mixes Tarjan SCC with Heuristic Escape Logic**

`lib/cycleDetector.ts` combines:
- Tarjan-style SCC membership tracking (algorithmic)
- Tabu list with time-based expiry (heuristic)
- Oscillation detection via sliding window (heuristic)
- Zero-progress stagnation detection (heuristic)

The Tarjan portion is sound graph theory; the tabu/oscillation portions are empirical heuristics. Mixing them makes it hard to reason about correctness.

**Recommendation**: Split into:
- `lib/_core/tarjan.ts` — pure Tarjan SCC tracking
- `lib/traversalEscapeHeuristics.ts` — tabu, oscillation, stagnation detection

### 3.3 Low Priority Issues

#### **P7: `routeSolverLocal.ts` `christofides` Falls Back to 2-opt**

The `christofides` algorithm option (line 209) actually runs `nearestNeighbor + twoOptImprove + orOptImprove` — identical to `2-opt`. This is misleading nomenclature. Either implement a true Christofides approximation or rename the option.

#### **P8: `buildDistanceMatrix` Recomputed Redundantly**

In `routeSolverLocal.ts`, `buildDistanceMatrix` is called once in `nearestNeighbor` (line 81) and again in `solveLocal` (line 198). The matrix from NN is discarded. Pass the matrix through or cache it.

#### **P9: Magic Numbers in Safety Caps**

Several safety caps lack documentation for their values:
- `maxIterations = turnEdges.length * 10` (turnAwareCpp.ts:132)
- `MAX_BALANCE_ITERATIONS = 500` (turnAwareGraph.ts:718)
- `MAX_DEADHEAD_EDGES = turnEdges.length * 4` (turnAwareGraph.ts:718)
- `MAX_DIJKSTRA_STEPS = 50000` (turnAwareGraph.ts:478)
- `maxSteps = 5000` (turnAwareGraph.ts:658)

**Recommendation**: Extract to named constants with JSDoc explaining the rationale.

---

## Part 4: Summary & Prioritized Action Items

### Formal Verification (Completed in This Audit)

| # | Action | Files Created |
|---|--------|--------------|
| 1 | `makeEulerian` termination & correctness proofs | `Verification/MakeEulerian.lean` |
| 2 | Kosaraju SCC & `bridgeAllSCCs` termination proofs | `Verification/BridgeSCC.lean` |
| 3 | Circuit completeness & edge conservation proofs | `Verification/CircuitCompleteness.lean` |
| 4 | 2-opt / Or-opt heuristic termination proofs | `Verification/TwoOptTermination.lean` |
| 5 | Updated `Verification.lean` to import new modules | `Verification.lean` |

### Refactoring Recommendations (Prioritized)

| Priority | # | Recommendation | Effort | Impact |
|----------|---|---------------|--------|--------|
| **High** | P1 | Unify three Hierholzer implementations | Large | Eliminates bug propagation risk |
| **High** | P2 | Split `turnAwareGraph.ts` monolith | Medium | Enables independent testing/reasoning |
| **High** | P3 | Consolidate haversine implementations | Small | Eliminates subtle distance inconsistencies |
| **Medium** | P4 | Replace linear-scan PQ with binary heap | Small | 10-50× Dijkstra speedup on large graphs |
| **Medium** | P5 | Separate math logic from spatial layer | Medium | Cleaner architecture, testable in isolation |
| **Medium** | P6 | Split CycleDetector into Tarjan + heuristics | Medium | Easier to reason about correctness |
| **Low** | P7 | Rename/implement Christofides properly | Small | API honesty |
| **Low** | P8 | Cache distance matrix in solver pipeline | Trivial | Avoids redundant O(n²) computation |
| **Low** | P9 | Name and document magic numbers | Small | Maintainability |

### Missing Test Coverage (Highest Priority)

| Priority | Module | Recommended Tests |
|----------|--------|-------------------|
| **Critical** | `turnAwareGraph.ts` | Unit tests for `buildTurnExpandedGraph`, `computeSCCs`, `restrictToLargestSCC`, `bridgeAllSCCs`, `makeEulerian` |
| **High** | `hierholzerInstructions.ts` | Tests for instruction generation, step conversion, bearing edge cases |
| **High** | `route-loop-pruner.ts` | Tests for loop detection, segment visit counting, edge cases |
| **Medium** | `routeSolverLocal.ts` | Dedicated unit tests for NN, 2-opt, Or-opt, empty/single inputs |
| **Medium** | `turnAwareCpp.ts` edge cases | Disconnected graphs, non-Eulerian input, maxIterations cap, empty input |
