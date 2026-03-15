import defaultConfig from "./default-config.json";

/** Per-plugin config (OsmAnd-style). Loaded from plugins/[id]/config.json when present. */
import weatherPluginConfig from "./weather/config.json";
import overtureExtractionPluginConfig from "./overture-extraction/config.json";
import vrpSolversPluginConfig from "./vrp-solvers/config.json";
import fuelAwareRoutingPluginConfig from "./fuel-aware-routing/config.json";

export interface PluginEntryConfig {
  enabled: boolean;
  apiKey?: string;
  /** Optional API endpoints (e.g. extractUrl, wsBase) — see plugin config.json. */
  endpoint?: string;
  extractUrl?: string;
  wsBase?: string;
  [key: string]: unknown;
}

export interface PluginConfig {
  plugins: Record<string, PluginEntryConfig>;
}

const PLUGIN_CONFIG_MAP: Record<string, PluginEntryConfig> = {
  weather: weatherPluginConfig as PluginEntryConfig,
  "overture-extraction": overtureExtractionPluginConfig as PluginEntryConfig,
  "vrp-solvers": vrpSolversPluginConfig as PluginEntryConfig,
  "fuel-aware-routing": fuelAwareRoutingPluginConfig as PluginEntryConfig,
};

/**
 * Load plugin config. Merges default-config.json with per-plugin config.json
 * (plugins/[id]/config.json) for apiKeys, endpoints, etc. Can be overridden
 * later by Firebase Remote Config or a backend endpoint.
 */
export async function loadPluginConfig(): Promise<PluginConfig> {
  const base = defaultConfig as PluginConfig;
  const plugins: Record<string, PluginEntryConfig> = { ...base.plugins };
  for (const [id, entry] of Object.entries(PLUGIN_CONFIG_MAP)) {
    const existing = plugins[id];
    plugins[id] = { ...existing, ...entry };
  }
  if (typeof __DEV__ !== "undefined" && __DEV__ && plugins.dev) {
    plugins.dev = { ...plugins.dev, enabled: true };
  }
  return { plugins };
}
