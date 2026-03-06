/**
 * Offline optimizer from route-optimizer-mobile-v2 (Videos app).
 * Use via "Use offline optimizer (v2)" on the Planner page.
 *
 * Supports both OSM (nodes + ways) and GeoJSON input.
 */

export { RouteOptimizerSimpleV2 } from "./routeOptimizerSimple";
export {
  optimizeFromGeoJSON,
  type GeoJSONFeatureCollection,
  type GeoJSONConvertOptions,
  type OptimizeFromGeoJSONOptions,
} from "./optimizeFromGeoJSON";
