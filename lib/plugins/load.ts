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
import { vrpSolversPlugin } from "./vrp-solvers";
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
  "vrp-solvers": vrpSolversPlugin,
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
          mapLayerState.addLayer({ ...layer } as Parameters<
            typeof mapLayerState.addLayer
          >[0]),
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
 *
 * Pass an AbortSignal to cancel stale calls: all plugin mutations (unload +
 * register) are deferred until after the async config load, so an aborted
 * signal causes an early return with no side effects.
 *
 * Only unloads plugins that are being disabled and only registers plugins
 * that are being enabled, to avoid unnecessary side effects on unchanged plugins.
 */
export async function loadAndRegisterPlugins(
  context: PluginContext,
  signal?: AbortSignal,
): Promise<void> {
  const config = await loadPluginConfig();
  if (signal?.aborted) return;

  const store = usePluginStore.getState();
  const enabledIds = new Set<string>();
  for (const [id, entry] of Object.entries(config.plugins)) {
    if (store.isPluginEnabled(id, entry.enabled)) enabledIds.add(id);
  }

  const currentlyRegistered = new Set(getAllPlugins().map((p) => p.id));

  const toUnload = [...currentlyRegistered].filter((id) => !enabledIds.has(id));
  for (const id of toUnload) {
    if (signal?.aborted) return;
    unloadPlugin(id);
  }

  const toRegister = [...enabledIds].filter(
    (id) => !currentlyRegistered.has(id),
  );
  for (const id of toRegister) {
    if (signal?.aborted) return;
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
