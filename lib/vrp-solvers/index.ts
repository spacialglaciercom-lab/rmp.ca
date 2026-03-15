/**
 * VRP solver plugin registry.
 *
 * Each solver implements the VRPSolver interface. Add new solvers here and
 * they automatically appear in the ALGORITHM_OPTIONS list used by VRPPlanner.
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

/** Ordered list of available solvers. Order determines UI display order. */
export const VRP_SOLVER_LIST: readonly VRPSolver[] = [
  clarkeWrightSolver,
  sweepSolver,
  orOptSolver,
  twoOptSolver,
  kmpSolver,
  ortoolsSolver,
] as const;

/** Registry keyed by solver id for fast lookup. */
const REGISTRY = new Map<string, VRPSolver>(
  VRP_SOLVER_LIST.map((s) => [s.id, s]),
);

/** Look up a solver by id. Falls back to the default zone-cluster solver. */
export function getSolver(id: string): VRPSolver {
  return REGISTRY.get(id) ?? defaultSolver;
}

/** Derive ALGORITHM_OPTIONS from the registry (id + label pairs). */
export const ALGORITHM_OPTIONS = VRP_SOLVER_LIST.map((s) => ({
  value: s.id,
  label: s.label,
})) as { value: string; label: string }[];
