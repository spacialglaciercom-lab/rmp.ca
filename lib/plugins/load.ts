import type { Plugin, PluginContext, PluginMapLayer } from "./types";
import { registerPlugin, unloadPlugin, getAllPlugins } from "./registry";
import { loadPluginConfig } from "./config";
import { usePluginStore } from "@/stores/pluginStore";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { weatherPlugin } from "./weather";
import { routeOptimizationPlugin } from "./route-optimization";
import { overturePlugin } from "./overture";
import { overtureExtractionPlugin } from "./overture-extraction";
import { zonesPlugin } from "./zones";
import { aiChatPlugin } from "./ai-chat";
import { drivePreviewPlugin } from "./drive-preview";
import { collectionRoutePlugin } from "./collection-route";
import { navigationPlugin } from "./navigation";
import { devPlugin } from "./dev";

const BUILTIN_PLUGINS: Record<string, Plugin> = {
  weather: weatherPlugin,
  routeOptimization: routeOptimizationPlugin,
  overture: overturePlugin,
  "overture-extraction": overtureExtractionPlugin,
  zones: zonesPlugin,
  "ai-chat": aiChatPlugin,
  "drive-preview": drivePreviewPlugin,
  "collection-route": collectionRoutePlugin,
  navigation: navigationPlugin,
  ...(typeof __DEV__ !== "undefined" && __DEV__ ? { dev: devPlugin } : {}),
};

/** Plugin id, name, description for settings UI. */
export function getBuiltinPluginDescriptors(): Array<{
  id: string;
  name: string;
  description: string;
}> {
  return Object.values(BUILTIN_PLUGINS).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
}

/**
 * Build plugin context from app globals. Call from the app after tRPC client and stores are ready.
 */
export function createPluginContext(api: unknown): PluginContext {
  const mapLayerState = useMapLayerStore.getState();
  return {
    api,
    stores: {
      mapLayer: {
        addLayer: (layer: PluginMapLayer) =>
          mapLayerState.addLayer({ ...layer } as Parameters<typeof mapLayerState.addLayer>[0]),
        removeLayer: (id: string) => mapLayerState.removeLayer(id),
      },
    },
  };
}

/**
 * Unload all currently registered plugins (e.g. before re-registering after toggle).
 */
export function unloadAllPlugins(): void {
  for (const p of getAllPlugins()) {
    unloadPlugin(p.id);
  }
}

/**
 * Load config, merge with plugin store, and register all enabled plugins.
 * Call after createPluginContext when the app starts and when user toggles plugins.
 */
export async function loadAndRegisterPlugins(context: PluginContext): Promise<void> {
  unloadAllPlugins();
  const config = await loadPluginConfig();
  const store = usePluginStore.getState();
  const enabledIds = new Set<string>();
  for (const [id, entry] of Object.entries(config.plugins)) {
    if (store.isPluginEnabled(id, entry.enabled)) enabledIds.add(id);
  }
  for (const id of enabledIds) {
    const plugin = BUILTIN_PLUGINS[id];
    if (!plugin) continue;
    plugin.dependencies?.forEach((dep) => {
      if (!enabledIds.has(dep)) {
        console.warn(`[Plugin:${id}] dependency "${dep}" is not enabled`);
      }
    });
    registerPlugin(plugin, context);
  }
}
