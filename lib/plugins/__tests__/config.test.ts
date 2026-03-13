import { describe, it, expect, vi } from "vitest";
import { loadPluginConfig } from "../config";

describe("loadPluginConfig", () => {
  it("returns config with plugins object", async () => {
    const config = await loadPluginConfig();
    expect(config).toHaveProperty("plugins");
    expect(typeof config.plugins).toBe("object");
  });

  it("includes weather, routeOptimization, overture, overture-extraction with enabled and optional apiKey", async () => {
    const config = await loadPluginConfig();
    expect(config.plugins.weather).toBeDefined();
    expect(config.plugins.weather).toHaveProperty("apiKey");
    expect(config.plugins.routeOptimization).toBeDefined();
    expect(config.plugins.routeOptimization.enabled).toBe(true);
    expect(config.plugins.overture).toBeDefined();
    expect(config.plugins["overture-extraction"]).toBeDefined();
    expect(config.plugins.dev).toBeDefined();
  });

  it("includes gate plugins (zones, ai-chat, navigation, drive-preview, collection-route) in config", async () => {
    const config = await loadPluginConfig();
    const gatePlugins = [
      "zones",
      "ai-chat",
      "navigation",
      "drive-preview",
      "collection-route",
    ];
    for (const id of gatePlugins) {
      expect(config.plugins[id], `${id} should be in config`).toBeDefined();
      expect(config.plugins[id]).toHaveProperty("enabled");
    }
  });

  it("merges per-plugin config (e.g. weather) with default so plugin has apiKey and endpoint", async () => {
    const config = await loadPluginConfig();
    expect(config.plugins.weather).toBeDefined();
    expect(config.plugins.weather).toHaveProperty("apiKey");
    expect(config.plugins.weather).toHaveProperty("endpoint");
    expect(config.plugins["overture-extraction"]).toHaveProperty("enabled");
  });

  it("sets dev.enabled to true when __DEV__ is true", async () => {
    const originalDev = (globalThis as unknown as { __DEV__?: boolean }).__DEV__;
    vi.stubGlobal("__DEV__", true);
    try {
      const config = await loadPluginConfig();
      expect(config.plugins.dev.enabled).toBe(true);
    } finally {
      if (originalDev === undefined) {
        vi.unstubAllGlobals();
      } else {
        vi.stubGlobal("__DEV__", originalDev);
      }
    }
  });
});
