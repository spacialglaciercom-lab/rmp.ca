/**
 * Vehicle Breakdown Rerouter
 *
 * When a truck goes out of service mid-route, this module takes the active
 * Eulerian circuit and the index of the last completed edge, then re-solves
 * the remaining uncompleted edges as a minimal new sub-circuit. The result
 * can be handed off to a relief truck or deferred to the next shift.
 *
 * Algorithm:
 *   1. Slice the circuit at breakdownEdgeIndex → "remaining" edges
 *   2. Re-balance the remaining subgraph with makeEulerian (minimal deadheads)
 *   3. Re-solve with solveTurnAwareCPP starting from the breakdown node
 *
 * All deadhead and bridge edges from the original circuit are preserved so
 * the subgraph stays connected; only the traversal order changes.
 */

import type { TurnEdge } from "@/types/turnAware";
import { makeEulerian } from "@/lib/turnAwareGraph";
import { solveTurnAwareCPP } from "@/lib/turnAwareCpp";
import { createLogger } from "@/lib/logger";

const log = createLogger("BreakdownRerouter");

export interface BreakdownRerouteResult {
  /** Re-optimized circuit covering the remaining uncompleted edges. */
  circuit: TurnEdge[];
  totalCost: number;
  /** Number of edges that were already completed before the breakdown. */
  completedEdgeCount: number;
  /** Number of edges remaining in the new sub-circuit. */
  remainingEdgeCount: number;
}

/**
 * Re-route after a vehicle breakdown.
 *
 * @param circuit       The full Eulerian circuit produced by solveTurnAwareCPP.
 * @param breakdownIdx  Index into `circuit` of the last edge the truck completed
 *                      (i.e. the truck is stranded at circuit[breakdownIdx].to).
 *                      Pass -1 if the truck broke down before starting.
 * @returns             A re-optimized circuit covering all unvisited edges,
 *                      starting from the breakdown node.
 */
export async function rerouteAfterBreakdown(
  circuit: TurnEdge[],
  breakdownIdx: number,
): Promise<BreakdownRerouteResult> {
  const completedCount = Math.max(0, breakdownIdx + 1);
  const remaining = circuit.slice(completedCount);

  if (remaining.length === 0) {
    log.debug("No remaining edges after breakdown — route already complete");
    return {
      circuit: [],
      totalCost: 0,
      completedEdgeCount: completedCount,
      remainingEdgeCount: 0,
    };
  }

  log.debug(`Breakdown at edge ${breakdownIdx}; re-solving ${remaining.length} remaining edges`);

  // Re-balance: the sliced subgraph may no longer be Eulerian because we
  // cut mid-circuit. makeEulerian adds the minimal deadhead edges to fix it.
  const balanced = await makeEulerian(remaining, (progress) => {
    log.debug(`makeEulerian progress: ${Math.round(progress * 100)}%`);
  });

  const result = solveTurnAwareCPP(balanced);

  log.debug(`Re-route complete — ${result.circuit.length} edges, cost ${result.totalCost.toFixed(0)}s`);

  return {
    circuit: result.circuit,
    totalCost: result.totalCost,
    completedEdgeCount: completedCount,
    remainingEdgeCount: result.circuit.length,
  };
}
