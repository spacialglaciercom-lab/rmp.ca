import type { Plugin, PluginContext } from "./types";

const plugins = new Map<string, Plugin>();

/**
 * Register a plugin and initialize it with the given context.
 * Call this from the app (e.g. PluginProvider) after building context.
 */
export function registerPlugin(plugin: Plugin, context: PluginContext): void {
  if (plugins.has(plugin.id)) {
    const existing = plugins.get(plugin.id)!;
    try {
      existing.destroy();
    } catch (e) {
      console.error(`[Plugin:${existing.id}] destroy error on replace:`, e);
    }
    plugins.delete(plugin.id);
  }
  plugins.set(plugin.id, plugin);
  try {
    plugin.initialize(context);
  } catch (e) {
    console.error(`[Plugin:${plugin.id}] initialize error:`, e);
    plugins.delete(plugin.id);
  }
}

export function getPlugin(id: string): Plugin | undefined {
  return plugins.get(id);
}

export function unloadPlugin(id: string): void {
  const plugin = plugins.get(id);
  if (plugin) {
    try {
      plugin.destroy();
    } catch (e) {
      console.error(`[Plugin:${id}] destroy error:`, e);
    }
    plugins.delete(id);
  }
}

export function getAllPlugins(): Plugin[] {
  return Array.from(plugins.values());
}
