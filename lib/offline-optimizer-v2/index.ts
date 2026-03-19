/**
 * Offline optimizer from route-optimizer-mobile-v2 (Videos app).
 * Use via "Use offline optimizer (v2)" on the Planner page.
 *
 * Supports both OSM (nodes + ways) and GeoJSON input.
 * Optional routing plugins (FuelAwarePlugin, TurnPenaltyPlugin) when GeoJSON has [lon, lat, z].
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
