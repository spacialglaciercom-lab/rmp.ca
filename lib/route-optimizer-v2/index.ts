/**
 * Route Optimizer v2 (same as route-optimizer-mobile-v2)
 * OSM parse → edge doubling → Hierholzer with turn optimization
 *
 * Debug: In dev, [RouteOptimizer] logs appear in console.
 * To enable in production: set window.__DEBUG_ROUTE_OPTIMIZER = true
 */

export { RouteOptimizer } from "./routeOptimizer";
export { OSMParser } from "./osmParser";
export { GeoJSONParser } from "./geojsonParser";
export { debug, warn } from "./debug";
export type {
  Node,
  Way,
  RoutePoint,
  RouteStats,
  OptimizationResult,
  TurnRestriction,
  TurnPenaltyWeights,
  UturnRestrictionSet,
} from "./types";
export { buildUturnRestrictions, isUturnForbidden } from "./uturn-restrictions";
