/**
 * VRP solver plugin registry.
 *
 * Built-in solvers are always available. Custom solvers can be registered via
 * registerSolver() (e.g. from plugins that expose getFeatures().vrpSolvers).
 * Use getSolverList() for the ordered list (built-ins + dynamic, optionally
 * filtered/ordered by config). Use getAlgorithmOptions() for UI dropdown data.
 */

export type { VRPSolver, VRPSolverInput, VRPSolverOutput, VRPSolverStop, VRPSolverRouteStats, DistMatrix } from "./types";
export { buildHaversineMatrix, getValhallaMatrix } from "./utils";

import type { VRPSolver } from "./types";
import { clarkeWrightSolver } from "./clarke-wright";
import { sweepSolver } from "./sweep";
import { twoOptSolver } from "./two-opt";
import { orOptSolver } from "./or-opt";
import { ortoolsSolver } from "./ortools";
import { kmpSolver } from "./kmp";
import { defaultSolver } from "./default";

/** Built-in solvers (read-only). Order is the default display order. */
export const VRP_SOLVER_LIST: readonly VRPSolver[] = [
  clarkeWrightSolver,
  sweepSolver,
  orOptSolver,
  twoOptSolver,
  kmpSolver,
  ortoolsSolver,
] as const;

/** Set of built-in solver ids; unregisterSolver will not remove these. */
const BUILTIN_IDS = new Set(VRP_SOLVER_LIST.map((s) => s.id));

/** Optional config for ordering/filtering the solver list (set by plugin loader). */
let solverListConfig: { solverOrder?: string[]; allowlistOnly?: boolean } | null = null;

/**
 * Set config for getSolverList() (order and allowlist). Called by plugin load
 * when the vrp-solvers plugin is registered. Pass null to clear.
 */
export function setSolverListConfig(config: { solverOrder?: string[]; allowlistOnly?: boolean } | null): void {
  solverListConfig = config;
}

/** Mutable registry: built-ins first, then dynamically registered (id -> solver). */
const REGISTRY = new Map<string, VRPSolver>(
  VRP_SOLVER_LIST.map((s) => [s.id, s]),
);

/** Order of dynamically added solver ids (registration order). */
const DYNAMIC_ORDER: string[] = [];

/**
 * Register a custom solver. If the id already exists (built-in or dynamic), it is replaced.
 * Use this from plugins or app init to add custom solvers.
 */
export function registerSolver(solver: VRPSolver): void {
  const had = REGISTRY.has(solver.id);
  REGISTRY.set(solver.id, solver);
  if (!had && !BUILTIN_IDS.has(solver.id)) {
    DYNAMIC_ORDER.push(solver.id);
  }
}

/**
 * Unregister a solver by id. Built-in solver ids are ignored (not removed).
 * Returns true if a dynamic solver was removed.
 */
export function unregisterSolver(id: string): boolean {
  if (BUILTIN_IDS.has(id)) return false;
  const removed = REGISTRY.delete(id);
  if (removed) {
    const idx = DYNAMIC_ORDER.indexOf(id);
    if (idx >= 0) DYNAMIC_ORDER.splice(idx, 1);
  }
  return removed;
}

/**
 * Return the ordered list of solvers: built-ins first (in VRP_SOLVER_LIST order),
 * then dynamically registered (in registration order). If setSolverListConfig was
 * called with solverOrder/allowlistOnly, the list is reordered and optionally
 * filtered to only include ids in solverOrder.
 */
export function getSolverList(): VRPSolver[] {
  const builtinOrder = VRP_SOLVER_LIST.map((s) => s.id);
  const dynamicIds = DYNAMIC_ORDER.filter((id) => REGISTRY.has(id));
  let orderedIds = [...builtinOrder, ...dynamicIds];

  const config = solverListConfig;
  if (config?.solverOrder && config.solverOrder.length > 0) {
    const orderSet = new Set(config.solverOrder);
    const inOrder: string[] = [];
    const notInOrder: string[] = [];
    for (const id of config.solverOrder) {
      if (REGISTRY.has(id)) inOrder.push(id);
    }
    if (!config.allowlistOnly) {
      for (const id of orderedIds) {
        if (!orderSet.has(id)) notInOrder.push(id);
      }
    }
    orderedIds = config.allowlistOnly ? inOrder : [...inOrder, ...notInOrder];
  }

  return orderedIds.map((id) => REGISTRY.get(id)!).filter(Boolean);
}

/** Look up a solver by id. Falls back to the default zone-cluster solver. */
export function getSolver(id: string): VRPSolver {
  return REGISTRY.get(id) ?? defaultSolver;
}

/** Algorithm options for UI dropdowns, derived from getSolverList(). */
export function getAlgorithmOptions(): { value: string; label: string }[] {
  return getSolverList().map((s) => ({ value: s.id, label: s.label }));
}
