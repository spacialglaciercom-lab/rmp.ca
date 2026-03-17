/**
 * Circuit Store
 *
 * Persists the active TurnEdge[] circuit and the StreetEdge[] graph used to
 * produce it. Written once by useRouteOptimization after solveTurnAwareCPP
 * succeeds, then read by the online re-optimization actions
 * (rerouteFromBreakdown, insertEmergencyStopAt) in collectionNavigationStore.
 *
 * Kept as a plain Zustand store (no persistence middleware) so it resets on
 * app reload — the driver must re-optimize to re-populate it.
 */

import { create } from "zustand";
import type { TurnEdge, StreetEdge } from "@/types/turnAware";

interface CircuitState {
  circuit: TurnEdge[];
  streetEdges: StreetEdge[];
}

interface CircuitActions {
  setCircuit: (circuit: TurnEdge[], streetEdges: StreetEdge[]) => void;
  clearCircuit: () => void;
}

type CircuitStore = CircuitState & CircuitActions;

export const useCircuitStore = create<CircuitStore>()((set) => ({
  circuit: [],
  streetEdges: [],

  setCircuit: (circuit, streetEdges) => set({ circuit, streetEdges }),
  clearCircuit: () => set({ circuit: [], streetEdges: [] }),
}));
