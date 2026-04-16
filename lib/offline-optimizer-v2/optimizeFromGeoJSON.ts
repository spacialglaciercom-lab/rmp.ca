/**
 * Run the offline v2 optimizer from GeoJSON input (LineString / MultiLineString features).
 * Converts GeoJSON → nodes/ways via geojsonToOsmData, then runs RouteOptimizerSimpleV2.
 * When plugins are provided, uses directed edges with compounded cost and transition costs.
 */

import type { OptimizationResult } from "@/lib/route-optimizer-v2/types";
import type { RoutingCostPlugin } from "@/lib/routing_plugins";
import { geojsonToOsmData } from "@/lib/geojsonToOsmData";
import type {
  GeoJSONFeatureCollection,
  GeoJSONConvertOptions,
} from "@/lib/geojsonToOsmData";
import { RouteOptimizerSimpleV2 } from "./routeOptimizerSimple";

export type { GeoJSONFeatureCollection, GeoJSONConvertOptions };

export interface OptimizeFromGeoJSONOptions extends GeoJSONConvertOptions {
  /** Custom start latitude */
  customLat?: number;
  /** Custom start longitude */
  customLon?: number;
  /** Optional routing cost plugins (e.g. FuelAwarePlugin, TurnPenaltyPlugin). Use when GeoJSON has [lon, lat, z]. */
  plugins?: RoutingCostPlugin[];
}

export interface OptimizeFromGeoJSONResult extends OptimizationResult {
  /** Raw OSM nodes and ways used by the optimizer */
  nodes?: Map<string, Node>;
  ways?: Way[];
}

/**
 * Optimize a route from a GeoJSON FeatureCollection of road LineStrings/MultiLineStrings.
 * Supports the same GeoJSON format as the backend optimizer (e.g. from Overture or OSM export).
 * When options.plugins is provided, builds a directed graph with edge and transition costs.
 *
 * Returns the optimization result along with the raw nodes/ways for generating proper road geometry.
 */
export function optimizeFromGeoJSON(
  geojson: GeoJSONFeatureCollection,
  options: OptimizeFromGeoJSONOptions = {},
): OptimizeFromGeoJSONResult {
  const { customLat, customLon, plugins, ...convertOpts } = options;
  const { nodes, ways } = geojsonToOsmData(geojson, convertOpts);
  const optimizer = new RouteOptimizerSimpleV2(nodes, ways, plugins);
  const result = optimizer.optimize(customLat, customLon);
  return { ...result, nodes, ways };
}
