import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerPlugin,
  getPlugin,
  unloadPlugin,
  getAllPlugins,
} from "../registry";
import type { Plugin, PluginContext } from "../types";

const mockContext: PluginContext = {
  api: null,
  stores: {},
};

function createMockPlugin(overrides?: Partial<Plugin>): Plugin {
  const destroy = vi.fn();
  const initialize = vi.fn();
  return {
    id: "test-plugin",
    name: "Test Plugin",
    description: "A test plugin",
    version: "1.0.0",
    initialize,
    destroy,
    getFeatures: () => ({}),
    ...overrides,
  };
}

describe("plugin registry", () => {
  beforeEach(() => {
    unloadPlugin("test-plugin");
    unloadPlugin("other-plugin");
  });

  it("registers a plugin and returns it via getPlugin", () => {
    const plugin = createMockPlugin();
    registerPlugin(plugin, mockContext);
    expect(getPlugin("test-plugin")).toBe(plugin);
    expect(plugin.initialize).toHaveBeenCalledWith(mockContext);
  });

  it("unloadPlugin calls destroy and removes plugin", () => {
    const plugin = createMockPlugin();
    registerPlugin(plugin, mockContext);
    expect(getPlugin("test-plugin")).toBe(plugin);
    unloadPlugin("test-plugin");
    expect(plugin.destroy).toHaveBeenCalledTimes(1);
    expect(getPlugin("test-plugin")).toBeUndefined();
  });

  it("getAllPlugins returns all registered plugins", () => {
    const a = createMockPlugin({ id: "a" });
    const b = createMockPlugin({ id: "b" });
    registerPlugin(a, mockContext);
    registerPlugin(b, mockContext);
    const all = getAllPlugins();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.id).sort()).toEqual(["a", "b"]);
    unloadPlugin("a");
    unloadPlugin("b");
  });

  it("re-registering same id destroys previous and replaces", () => {
    const first = createMockPlugin();
    const second = createMockPlugin({ id: "test-plugin" });
    registerPlugin(first, mockContext);
    registerPlugin(second, mockContext);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(getPlugin("test-plugin")).toBe(second);
    unloadPlugin("test-plugin");
  });

  it("when initialize throws, plugin is not registered", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugin = createMockPlugin({
      initialize: vi.fn().mockImplementation(() => {
        throw new Error("init failed");
      }),
    });
    registerPlugin(plugin, mockContext);
    expect(getPlugin("test-plugin")).toBeUndefined();
    consoleSpy.mockRestore();
  });
});
