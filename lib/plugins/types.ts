/**
 * Plugin system types (OsmAnd-style). Kept minimal to avoid circular deps;
 * the app supplies the concrete context when registering plugins.
 */

/** Map layer shape used by plugins; mirrors stores/mapLayerStore MapLayer. */
export interface PluginMapLayer {
  id: string;
  name: string;
  url: string;
  attribution: string;
  type: "base" | "overlay";
  category:
    | "standard"
    | "satellite"
    | "terrain"
    | "dark"
    | "traffic"
    | "collection";
}

/** Minimal store surface exposed to plugins (avoids importing full stores here). */
export interface PluginStores {
  mapLayer?: {
    addLayer: (layer: PluginMapLayer) => void;
    removeLayer: (layerId: string) => void;
  };
}

/**
 * Context passed to plugins at init. Built by the app; api is the tRPC client,
 * stores are the minimal store APIs plugins may use.
 */
export interface PluginContext {
  api: unknown;
  stores: PluginStores;
}

/** Feature keys plugins can return from getFeatures(). */
export type PluginFeatureKey =
  | "mapLayer"
  | "dataProvider"
  | "widget"
  | "routeOptimizer"
  | "extractService"
  | "vrpSolvers";

/**
 * Result of polygon-to-GeoJSON extraction (e.g. Overture).
 * CRS: coordinates are in EPSG:4326 (WGS84) unless otherwise documented.
 */
export interface ExtractResult {
  geojson: GeoJSON.FeatureCollection;
  stats?: { points: number; roads: number; nodes: number; edges: number };
  warnings: string[];
}

/** Extract service feature: async extractor for polygon → road GeoJSON. */
export interface ExtractServiceFeature {
  extractor: (
    polygon: GeoJSON.Feature<GeoJSON.Polygon>,
    theme?: string,
  ) => Promise<ExtractResult>;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Optional plugin IDs this plugin relies on. Used by load.ts to warn when dependencies are disabled. */
  dependencies?: readonly string[];
  initialize: (context: PluginContext) => void;
  destroy: () => void;
  getFeatures: () => Record<string, unknown>;
}
