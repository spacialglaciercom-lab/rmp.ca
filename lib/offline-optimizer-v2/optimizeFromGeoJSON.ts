/**
 * Run the offline v2 optimizer from GeoJSON input (LineString / MultiLineString features).
 * Converts GeoJSON → nodes/ways via geojsonToOsmData, then runs RouteOptimizerSimpleV2.
 */

import type { OptimizationResult } from "@/lib/route-optimizer-v2/types";
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
}

/**
 * Optimize a route from a GeoJSON FeatureCollection of road LineStrings/MultiLineStrings.
 * Supports the same GeoJSON format as the backend optimizer (e.g. from Overture or OSM export).
 */
export function optimizeFromGeoJSON(
  geojson: GeoJSONFeatureCollection,
  options: OptimizeFromGeoJSONOptions = {},
): OptimizationResult {
  const { customLat, customLon, ...convertOpts } = options;
  const { nodes, ways } = geojsonToOsmData(geojson, convertOpts);
  const optimizer = new RouteOptimizerSimpleV2(nodes, ways);
  return optimizer.optimize(customLat, customLon);
}
