/**
 * Online Re-optimization modules
 *
 * Three independent capabilities for municipal route supervisors:
 *   - rerouteAfterBreakdown  — re-solve remaining circuit when a truck goes out of service
 *   - insertEmergencyStop    — cheapest-insertion of unscheduled pickups into active circuit
 *   - fetchTrafficMultipliers / applyTrafficToEdges / mergeTrafficPenalties
 *                            — live traffic speed adjustments before CPP solve
 */

export { rerouteAfterBreakdown } from "./breakdownRerouter";
export type { BreakdownRerouteResult } from "./breakdownRerouter";

export { insertEmergencyStop } from "./stopInsertion";
export type { StopInsertionResult } from "./stopInsertion";

export {
  fetchTrafficMultipliers,
  applyTrafficToEdges,
  mergeTrafficPenalties,
  edgesToBBox,
} from "./trafficFeed";
export type { BBox, TrafficMultipliers } from "./trafficFeed";
