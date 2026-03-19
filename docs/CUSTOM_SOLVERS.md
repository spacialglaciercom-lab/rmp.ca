# Custom VRP Solvers — Plugin Architecture

This document describes how to add **custom solvers** (frontend and backend) using the plugin architecture.

---

## Frontend: Custom solvers in the app

### 1. Implement the solver interface

Implement the `VRPSolver` interface from `@/lib/vrp-solvers`:

- **id** (string): Unique solver id (e.g. `"my-solver"`).
- **label** (string): Display name in the algorithm dropdown.
- **requiresMatrix** (boolean): When `true`, the planner builds a distance/time matrix before calling `solve()` (needed for most local heuristics).
- **solve(input)** (async): Accepts `VRPSolverInput`, returns `Promise<VRPSolverOutput>`.

Types are in `lib/vrp-solvers/types.ts`. Example shape:

- **Input:** `locations` (depot at index 0), `numVehicles`, `vehicleCapacity`, `objective`, optional `matrix` (when `requiresMatrix` is true).
- **Output:** `stops` (ordered), `totalDistanceKm`, `totalTimeMin`, optional `routes`, `routeStats`, `routeMetrics`, `unassigned`.

### 2. Register the solver

**Option A — From a plugin**

In your plugin’s `getFeatures()`, expose an array of solvers:

```ts
getFeatures() {
  return {
    vrpSolvers: [myCustomSolver],
    // ... other features
  };
}
```

When the plugin is loaded, the app will call `registerSolver()` for each entry. When the plugin is unloaded, those solver ids are unregistered.

**Option B — At app init**

Import and register directly:

```ts
import { registerSolver } from "@/lib/vrp-solvers";

registerSolver({
  id: "my-solver",
  label: "My custom heuristic",
  requiresMatrix: true,
  async solve(input) {
    // ... use input.locations, input.matrix, etc.
    return { stops, totalDistanceKm, totalTimeMin };
  },
});
```

The solver then appears in the VRP planner algorithm dropdown and is used when the user selects it.

### 3. Config: order and allowlist (optional)

In `lib/plugins/vrp-solvers/config.json` you can set:

- **solverOrder**: Array of solver ids. The dropdown order follows this list; any id not in the list is appended after (unless `allowlistOnly` is true).
- **allowlistOnly**: If `true`, only ids in `solverOrder` are shown; others are hidden.

Example:

```json
{
  "enabled": true,
  "solverOrder": ["clarke_wright", "my-solver", "ortools"],
  "allowlistOnly": false
}
```

---

## Backend: Custom server-side solvers

### 1. Implement the protocol

Implement the backend protocol used by the registry (see `backend/app/vrp_registry.py`):

- Class with a **solve(self, req: VrpRequest) -> VrpResponse** method.
- `VrpRequest` and `VrpResponse` are Pydantic models in `backend/app/vrp.py` (stops, vehicles, objective, etc.).

### 2. Register the solver

At app startup (e.g. in `backend/app/main.py` or in a dedicated module that is imported from `main.py`):

```python
from app.vrp_registry import register_solver
from app.my_custom_solver import MyCustomVrpSolver

register_solver("my-backend-solver", MyCustomVrpSolver())
```

### 3. Call from the client

The frontend can call the backend with a specific solver by including **solver** in the request body:

```json
{
  "stops": [...],
  "vehicles": [...],
  "solver": "my-backend-solver"
}
```

If `solver` is omitted, the default is `"ortools"`. If the id is unknown, the API returns 404 with a list of available solver ids.

### 4. List registered solvers

Use `get_solver_ids()` from `backend/app/vrp_registry` to get all registered solver ids (e.g. for a discovery endpoint or error messages).

---

## Summary

| Layer    | Add a custom solver |
|----------|----------------------|
| Frontend | Implement `VRPSolver`, then either expose `vrpSolvers` in a plugin’s `getFeatures()` or call `registerSolver(solver)` at init. |
| Backend  | Implement a class with `solve(req) -> VrpResponse`, then call `register_solver("id", instance)` at startup. |
| Config   | Optionally set `solverOrder` and `allowlistOnly` in `lib/plugins/vrp-solvers/config.json` to reorder or restrict the frontend dropdown. |

Existing built-in solvers (Clarke-Wright, Sweep, Or-Opt, 2-Opt, KMP, OR-Tools) remain; custom solvers are merged with them in the registry and in the UI.
