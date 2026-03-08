/**
 * Overture Maps Extraction plugin.
 * Exposes a pluggable extractor for polygon → road GeoJSON (WebSocket backend + DuckDB-WASM/PMTiles).
 * Use getPlugin('overture-extraction')?.getFeatures().extractor in Map/Planner for polygon-to-GeoJSON.
 */

import type { Plugin, PluginContext, ExtractResult, ExtractServiceFeature } from "../types";
import { extractOverture } from "@/lib/overtureExtractService";

export const overtureExtractionPlugin: Plugin = {
  id: "overture-extraction",
  name: "Overture Maps Extraction",
  description: "Extracts road networks from polygons (WebSocket + Overture/PMTiles)",
  version: "1.0.0",
  initialize(_context: PluginContext) {
    // WebSocket is created on-demand in extractOverture; no persistent connection.
  },
  destroy() {
    // No persistent WebSocket; extraction is on-demand.
  },
  getFeatures(): Record<string, unknown> & { extractService: ExtractServiceFeature; extractor: ExtractServiceFeature["extractor"] } {
    const extractor: ExtractServiceFeature["extractor"] = async (
      polygon: GeoJSON.Feature<GeoJSON.Polygon>,
      theme: string = "roads",
    ): Promise<ExtractResult> => {
      const result = await extractOverture(polygon, theme);
      return {
        geojson: result.geojson,
        stats: result.stats,
        warnings: result.warnings,
      };
    };
    return {
      extractService: { extractor },
      extractor,
    };
  },
};
