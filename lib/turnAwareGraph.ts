/**
 * Barrel re-export — implementation split into focused modules:
 *   lib/_core/bearing.ts      — bearing / turn classification
 *   lib/_core/scc.ts          — Kosaraju SCC computation
 *   lib/turnExpandedGraph.ts  — turn-expanded graph construction
 *   lib/eulerianBalance.ts    — SCC bridging and Eulerian balancing
 */
export type { PipelineProgressCallback, EdgePenaltyMultipliers } from "./turnExpandedGraph";
export { buildTurnExpandedGraph } from "./turnExpandedGraph";
export { restrictToLargestSCC, precomputeSCCs } from "./_core/scc";
export { bridgeAllSCCs, makeEulerian } from "./eulerianBalance";
