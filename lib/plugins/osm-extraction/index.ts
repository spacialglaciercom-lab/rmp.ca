/**
 * OSM Extraction plugin.
 * Exposes a pluggable extractor for polygon → road GeoJSON via the Overpass API.
 * Use getPlugin('osm-extraction')?.getFeatures().extractor in Extract tab.
 */

import type {
  Plugin,
  PluginContext,
  ExtractResult,
  ExtractServiceFeature,
} from "../types";
import { extractOSM } from "./osmExtractionService";

export const osmExtractionPlugin: Plugin = {
  id: "osm-extraction",
  name: "OSM Extraction (Overpass)",
  description:
    "Extracts road networks from polygons using OpenStreetMap / Overpass API",
  version: "1.0.0",
  initialize(_context: PluginContext) {
    // No persistent connection — Overpass requests are on-demand.
  },
  destroy() {
    // Nothing to tear down.
  },
  getFeatures(): Record<string, unknown> & {
    extractService: ExtractServiceFeature;
    extractor: ExtractServiceFeature["extractor"];
  } {
    const extractor: ExtractServiceFeature["extractor"] = async (
      polygon: GeoJSON.Feature<GeoJSON.Polygon>,
      _theme?: string,
    ): Promise<ExtractResult> => {
      return extractOSM(polygon);
    };
    return {
      extractService: { extractor },
      extractor,
    };
  },
};
