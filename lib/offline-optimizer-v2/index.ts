/**
 * Offline Eulerian optimizer (Videos-app lineage). May diverge from mobile until changes are ported.
 * Use via "Use offline optimizer (v2)" on the Planner page.
 *
 * Supports both OSM (nodes + ways) and GeoJSON input.
 *
 * Most flows use RouteOptimizerSimpleV2 **without** plugins: built-in turn costs and reciprocal
 * balancing only. Optional RoutingCostPlugin (FuelAware, TurnPenalty, etc.) requires the caller to
 * pass them and appropriate data (e.g. [lon, lat, z] for fuel). See the file header in
 * `./routeOptimizerSimple.ts`.
 */

export { RouteOptimizerSimpleV2 } from "./routeOptimizerSimple";
export {
  optimizeFromGeoJSON,
  type GeoJSONFeatureCollection,
  type GeoJSONConvertOptions,
  type OptimizeFromGeoJSONOptions,
} from "./optimizeFromGeoJSON";
export {
  FuelAwarePlugin,
  TurnPenaltyPlugin,
  createTurnPenaltyPlugin,
  type RoutingCostPlugin,
  type Coord,
} from "@/lib/routing_plugins";
