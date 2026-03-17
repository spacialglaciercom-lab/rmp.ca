/**
 * VRP Solvers plugin — exposes the solver registry (Clarke-Wright, Sweep,
 * Or-Opt, 2-Opt, VROOM) as a plugin feature. Toggling this off disables the
 * VRP planner UI and prevents solver calls. The list is dynamic: built-in
 * solvers plus any registered via registerSolver() (e.g. from other plugins).
 */
import type { Plugin } from "../types";
import { getSolverList, getSolver, getAlgorithmOptions } from "@/lib/vrp-solvers";

export const vrpSolversPlugin: Plugin = {
  id: "vrp-solvers",
  name: "VRP Solver",
  description:
    "Route planning algorithms: Clarke-Wright, Sweep, Or-Opt, 2-Opt, and VROOM (CVRP/VRPTW).",
  version: "1.0.0",

  initialize() {},
  destroy() {},

  getFeatures() {
    return {
      /** Ordered list of available solver descriptors (id + label). */
      solverList: getSolverList().map((s) => ({ id: s.id, label: s.label })),
      /** Look up a solver by id. */
      getSolver,
      /** Algorithm options for dropdowns (value + label). */
      getAlgorithmOptions,
    };
  },
};
