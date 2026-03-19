/**
 * Tests for gate plugins: zones, ai-chat, navigation, drive-preview, collection-route.
 * These plugins have no functional features; they exist solely to gate UI elements.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registerPlugin, getPlugin, unloadPlugin } from "../registry";
import { zonesPlugin } from "../zones";
import { aiChatPlugin } from "../ai-chat";
import { navigationPlugin } from "../navigation";
import { drivePreviewPlugin } from "../drive-preview";
import { collectionRoutePlugin } from "../collection-route";
import type { Plugin, PluginContext } from "../types";

const mockContext: PluginContext = { api: null, stores: {} };

const GATE_PLUGINS: Plugin[] = [
  zonesPlugin,
  aiChatPlugin,
  navigationPlugin,
  drivePreviewPlugin,
  collectionRoutePlugin,
];

describe("gate plugins", () => {
  beforeEach(() => {
    for (const p of GATE_PLUGINS) unloadPlugin(p.id);
  });

  it.each(GATE_PLUGINS.map((p) => [p.id, p] as [string, Plugin]))(
    "%s: registers and is retrievable from registry",
    (id, plugin) => {
      registerPlugin(plugin, mockContext);
      expect(getPlugin(id)).toBe(plugin);
      unloadPlugin(id);
      expect(getPlugin(id)).toBeUndefined();
    },
  );

  it.each(GATE_PLUGINS.map((p) => [p.id, p] as [string, Plugin]))(
    "%s: getFeatures returns an object",
    (_id, plugin) => {
      registerPlugin(plugin, mockContext);
      expect(typeof plugin.getFeatures()).toBe("object");
    },
  );

  it.each(GATE_PLUGINS.map((p) => [p.id, p] as [string, Plugin]))(
    "%s: has required metadata fields",
    (_id, plugin) => {
      expect(typeof plugin.id).toBe("string");
      expect(plugin.id.length).toBeGreaterThan(0);
      expect(typeof plugin.name).toBe("string");
      expect(typeof plugin.description).toBe("string");
      expect(typeof plugin.version).toBe("string");
    },
  );
});
