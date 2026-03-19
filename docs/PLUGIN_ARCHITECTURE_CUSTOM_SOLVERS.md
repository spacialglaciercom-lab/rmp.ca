# Plugin Architecture for Custom Solvers — Plan

This document outlines a plan to introduce a **plugin architecture for custom VRP/route solvers** so that new solvers can be added without editing core solver code, and so plugins (or external config) can contribute and order solvers.

---

## Current State

- **Frontend (`lib/vrp-solvers/`)**
  - Solver list is **hardcoded** in `index.ts`: `VRP_SOLVER_LIST` is a static array of built-in solvers (Clarke-Wright, Sweep, Or-Opt, 2-Opt, KMP, OR-Tools).
  - Adding a new solver requires editing `index.ts` and adding a new import and entry in the list.
  - The **vrp-solvers plugin** (`lib/plugins/vrp-solvers/`) only *exposes* this list via `getFeatures().solverList` and `getFeatures().getSolver`; it does not allow other plugins or config to *register* solvers.

- **UI (`components/VRPPlanner.tsx`)**
  - Imports `ALGORITHM_OPTIONS` and `getSolver` directly from `@/lib/vrp-solvers`. The dropdown and solve path are tied to this single registry.

- **Backend (`backend/app/vrp.py`)**
  - Single implementation: OR-Tools. No abstraction or registry for multiple server-side solvers; adding another backend (e.g. different heuristic, commercial solver) would require editing `vrp.py` or adding new routes by hand.

---

## Goals

1. **Frontend**
   - Allow **dynamic registration** of solvers (e.g. `registerSolver(solver)` / `unregisterSolver(id)`).
   - Allow **plugins** to contribute solvers via a standard contract (e.g. `getFeatures().vrpSolvers`).
   - Keep built-in solvers as the default set; merge with plugin-contributed solvers and optional config (order/allowlist).

2. **Backend (optional but recommended)**
   - Define a **solver protocol** and **registry** so multiple server-side solvers can be registered; `/api/vrp/solve` dispatches by solver id or config.

3. **Config**
   - Optional: allow config to **order** or **allowlist** solver ids so deployments can reorder or hide built-ins without code changes.

4. **Documentation**
   - Document how to add a **custom solver** (frontend and/or backend).

---

## Implementation Plan

### Phase 1: Frontend — Solver registry API

**Owner:** Frontend  
**Files:** `lib/vrp-solvers/index.ts`, `lib/vrp-solvers/types.ts` (no change to types needed)

1. **Add a mutable registry** alongside the built-in list:
   - Keep `VRP_SOLVER_LIST` as the **built-in** solvers (exported for reference).
   - Introduce an internal **dynamic registry**: a `Map<string, VRPSolver>` that starts with built-ins and can be updated.

2. **Add public API:**
   - `registerSolver(solver: VRPSolver): void` — add or replace a solver by `solver.id`. If the same id exists, replace (e.g. allow plugins to override built-ins if desired).
   - `unregisterSolver(id: string): void` — remove a solver by id. Optionally prevent removal of built-ins (e.g. only allow removal of dynamically added ones).
   - `getSolverList(): VRPSolver[]` — return ordered list: built-ins first (in defined order), then dynamically registered (in registration order), optionally filtered/ordered by config (Phase 3).

3. **Refactor existing exports to use the registry:**
   - `getSolver(id: string)` — resolve from the combined registry (built-ins + dynamic); fallback to `defaultSolver` when id is missing.
   - `ALGORITHM_OPTIONS` — derive from `getSolverList()` so the UI stays in sync. Because this is used at module load time in components, either:
     - Make it a **function** `getAlgorithmOptions(): { value: string; label: string }[]` that components call (e.g. in render or in a hook), or
     - Keep a **reactive** source: e.g. a small store or event so that when solvers are registered/unregistered, consumers can re-read the list. Simplest is to derive from `getSolverList()` and have the vrp-solvers plugin call `registerSolver` during init so that by the time the planner mounts, the list is final unless we add hot-reload later.

4. **Solver id conflicts:**
   - Document that built-in ids are reserved unless explicitly overridable. First implementation: allow override (later register wins) so plugins can replace a built-in if needed.

**Deliverables:**
- `registerSolver` / `unregisterSolver` / `getSolverList` in `lib/vrp-solvers/index.ts`.
- `getSolver` and algorithm options derived from `getSolverList()`.
- No change to `VRPSolver` interface.

---

### Phase 2: Frontend — Plugin contract for contributing solvers

**Owner:** Frontend  
**Files:** `lib/plugins/types.ts`, `lib/plugins/vrp-solvers/index.ts`, `lib/plugins/load.ts` or registry

1. **Extend plugin feature contract:**
   - In `lib/plugins/types.ts`, document (and optionally type) that `getFeatures()` may return `vrpSolvers?: VRPSolver[]`.
   - Any plugin that provides `vrpSolvers` is a **solver provider**; those solvers will be registered when the plugin is loaded and unregistered when the plugin is unloaded.

2. **Orchestration in vrp-solvers plugin:**
   - On **initialize**:  
     - Register all built-in solvers with the solver registry (so the registry is the single source of truth).  
     - Iterate over `getAllPlugins()` and for each plugin that returns `getFeatures().vrpSolvers`, call `registerSolver` for each solver in that array.  
   - On **destroy**:  
     - Unregister only the solvers that were registered by this plugin (built-ins) and by other plugins that are still loaded. So: either track “solver id → plugin id” and on plugin destroy unregister those ids, or on destroy of vrp-solvers plugin unregister all and re-register built-ins only (simpler but requires vrp-solvers to run init after other plugins so other plugins’ solvers are registered after vrp-solvers init).  
   - Simpler approach: **vrp-solvers plugin** does not register built-ins in init; built-ins are always in the registry at module load. Other plugins, when they initialize, call `registerSolver` themselves from their `initialize(context)`. So the contract is: “if your plugin exposes `getFeatures().vrpSolvers`, you must call `registerSolver` for each in `initialize` and `unregisterSolver` in `destroy`.” The vrp-solvers plugin then only provides the built-in list and getSolver; it doesn’t iterate other plugins.  
   - Even simpler: **central loader** in `load.ts`: after registering all plugins, for each registered plugin, if `getFeatures().vrpSolvers` exists, call `registerSolver` for each. On unload of a plugin, call `unregisterSolver` for each id that plugin contributed (need to store a map pluginId → solver ids). That way the vrp-solvers plugin stays minimal and the “solver contribution” is handled in one place.

3. **Recommended: central registration in load.ts**
   - After `registerPlugin(plugin, context)` in `loadAndRegisterPlugins`, get `plugin.getFeatures()?.vrpSolvers` and if present, call `registerSolver(s)` for each and keep a `Map<pluginId, string[]>` of solver ids added.
   - In `unloadPlugin` (or in the unload loop in `loadAndRegisterPlugins`), for that plugin id, call `unregisterSolver(id)` for each id in the map, then delete the map entry.
   - This requires `load.ts` to import from `@/lib/vrp-solvers` (registerSolver, unregisterSolver). No circular dependency if vrp-solvers doesn’t import from plugins.

4. **vrp-solvers plugin**  
   - Keep exposing `getFeatures().solverList` and `getFeatures().getSolver` but derive them from `getSolverList()` and `getSolver` so the list is always current.

**Deliverables:**
- Plugin type/docs: `getFeatures().vrpSolvers?: VRPSolver[]`.
- In `load.ts`: after register plugin, register its `vrpSolvers`; on unload, unregister those solver ids. Store pluginId → solver ids for teardown.
- vrp-solvers plugin: `solverList` and `getSolver` read from registry (getSolverList / getSolver).

---

### Phase 3: Frontend — VRPPlanner uses dynamic list

**Owner:** Frontend  
**Files:** `components/VRPPlanner.tsx`

1. **Algorithm options source:**
   - If `ALGORITHM_OPTIONS` is changed to a function `getAlgorithmOptions()`, replace usages in VRPPlanner with that function (e.g. call once in state or memo, or on each render). Alternatively, use a hook that subscribes to the solver list so that when plugins add/remove solvers the dropdown updates (only needed if we support hot toggle of plugins that add solvers).

2. **Default algorithm:**
   - Keep default algorithm as first solver in the list or a configured value so new solvers can become the default if ordered first (optional, can be Phase 3 or config).

**Deliverables:**
- VRPPlanner uses the dynamic solver list (via getAlgorithmOptions() or getSolverList()) so that plugin-contributed solvers appear in the dropdown and are usable.

---

### Phase 4 (Optional): Config-driven order / allowlist

**Owner:** Frontend  
**Files:** Plugin config or app config, `lib/vrp-solvers/index.ts`

1. **Config shape:**
   - e.g. in plugin config or a small `vrp-solvers.config.json`: `{ "solverOrder": ["clarke-wright", "sweep", "my-custom-solver"], "allowlistOnly": false }`.
   - If `solverOrder` is present, `getSolverList()` returns solvers in that order (missing ids appended at end). If `allowlistOnly` is true, only ids in `solverOrder` are returned.

2. **Loading:**
   - Load config in the vrp-solvers plugin init or in a small loader used by getSolverList(); if no config, use default order (built-ins then dynamic).

**Deliverables:**
- Optional config to order and/or allowlist solver ids without code changes.

---

### Phase 5 (Optional): Backend solver plugin architecture

**Owner:** Backend  
**Files:** `backend/app/vrp.py`, new `backend/app/vrp_solvers/` or `backend/app/solver_registry.py`

1. **Solver protocol:**
   - Define an abstract interface, e.g. `VrpSolverProtocol`: method `solve(request: VrpRequest) -> VrpResponse`.
   - Move current OR-Tools logic behind a class that implements this protocol (e.g. `OrtoolsVrpSolver`).

2. **Registry:**
   - Maintain a dict or registry: `solver_id -> VrpSolverProtocol`. Register `"ortools"` (or current default id) with the existing implementation.
   - Endpoint `/api/vrp/solve` accepts an optional `solver` query param or body field; look up solver by id and call `solve()`; if not provided, use default.

3. **Discovery/registration:**
   - Option A: Explicit registration in app startup (e.g. `register_solver("ortools", OrtoolsVrpSolver())`). Custom solvers are added by calling `register_solver` from another module.
   - Option B: Entry points or config-based loading (e.g. list of class paths in config) for more dynamic loading. Lower priority.

4. **Frontend alignment:**
   - The existing OR-Tools frontend solver (`ortools.ts`) already sends requests to the backend; it just uses the single endpoint. No change needed unless we add more backend-only solvers; then the frontend would pass `solver: "ortools"` or the new id.

**Deliverables:**
- Backend solver protocol and registry; OR-Tools behind the protocol; endpoint dispatches by solver id.

---

### Phase 6: Documentation

**Owner:** Docs  
**Files:** `docs/CUSTOM_SOLVERS.md` or section in existing docs

1. **How to add a custom solver (frontend):**
   - Implement `VRPSolver` (id, label, requiresMatrix, solve(input)).
   - Option A: In a plugin, expose `getFeatures().vrpSolvers = [mySolver]` and ensure the plugin is loaded.
   - Option B: Call `registerSolver(mySolver)` at app init (e.g. from a custom plugin or main entry).

2. **How to add a custom solver (backend):**
   - Implement the solver protocol; register the solver with the registry at startup; document the solver id and request/response format.

3. **Config (if Phase 4):**
   - Document `solverOrder` and `allowlistOnly` and where to put the config file.

**Deliverables:**
- `docs/CUSTOM_SOLVERS.md` (or equivalent) with the above.

---

## Summary Table

| Phase | Scope        | Description |
|-------|--------------|-------------|
| 1     | Frontend     | Solver registry API: `registerSolver`, `unregisterSolver`, `getSolverList`; derive `getSolver` and algorithm options from registry. |
| 2     | Frontend     | Plugin contract `vrpSolvers` in `getFeatures()`; central registration/unregistration in `load.ts`; vrp-solvers plugin uses registry for solverList/getSolver. |
| 3     | Frontend     | VRPPlanner uses dynamic list (getAlgorithmOptions / getSolverList). |
| 4     | Frontend     | (Optional) Config-driven solver order and allowlist. |
| 5     | Backend      | (Optional) Solver protocol + registry; dispatch by solver id in `/api/vrp/solve`. |
| 6     | Docs         | Document how to add custom solvers (frontend + backend) and config. |

---

## Dependencies and Order

- Phase 1 must be done first (registry API).
- Phase 2 depends on Phase 1 (plugins call registerSolver / unregisterSolver).
- Phase 3 depends on Phase 1 (and 2 if we want plugin solvers to appear).
- Phase 4 depends on Phase 1 (and optionally 2).
- Phase 5 is independent of 1–4 (backend-only).
- Phase 6 can be done after 1–3 and optionally 4–5.

---

## Testing

- **Phase 1:** Unit tests: register a custom solver, getSolverList includes it, getSolver(id) returns it; unregisterSolver removes it; getSolver(unknown) returns defaultSolver.
- **Phase 2:** Integration test: load a plugin that provides `vrpSolvers`, assert solver list includes those solvers; unload plugin, assert they are removed.
- **Phase 3:** Manual or E2E: add a dummy plugin solver, open VRP planner, confirm it appears in dropdown and solve works.
- **Phase 5:** Backend unit test: register a stub solver, POST to `/api/vrp/solve?solver=stub`, assert stub is invoked.

---

## Out of Scope (for this plan)

- Loading solver plugins from external npm packages or URLs (future).
- UI for “manage solvers” (enable/disable/reorder) beyond config file (future).
- Versioning or compatibility checks for solver implementations (future).
