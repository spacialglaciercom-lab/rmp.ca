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

/**
 * Optimize a route from a GeoJSON FeatureCollection of road LineStrings/MultiLineStrings.
 * Supports the same GeoJSON format as the backend optimizer (e.g. from Overture or OSM export).
 * When options.plugins is provided, builds a directed graph with edge and transition costs.
 */
export function optimizeFromGeoJSON(
  geojson: GeoJSONFeatureCollection,
  options: OptimizeFromGeoJSONOptions = {},
): OptimizationResult {
  const { customLat, customLon, plugins, ...convertOpts } = options;
  const { nodes, ways } = geojsonToOsmData(geojson, convertOpts);
  const optimizer = new RouteOptimizerSimpleV2(nodes, ways, plugins);
  return optimizer.optimize(customLat, customLon);
}
