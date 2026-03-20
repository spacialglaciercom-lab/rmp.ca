/**
 * React hook: returns the registered plugin for a given id, or undefined.
 * Re-renders when the plugin store's enabledPlugins changes (i.e. when a
 * plugin is toggled). Use this to reactively consume plugin features in components.
 *
 * Example:
 *   const features = usePlugin("weather")?.getFeatures();
 */
import { usePluginStore } from "@/stores/pluginStore";
import { getPlugin } from "./registry";
import type { Plugin } from "./types";

export function usePlugin(id: string): Plugin | undefined {
  // Subscribe to enabledPlugins so the hook re-renders when the user toggles
  // a plugin, which causes loadAndRegisterPlugins to re-run and the registry
  // to update.
  usePluginStore((s) => s.enabledPlugins);
  return getPlugin(id);
}
