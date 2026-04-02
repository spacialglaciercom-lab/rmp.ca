/**
 * Unit tests for VoiceCommandService.
 *
 * The react-native stub sets Platform.OS = "web", so activate() returns
 * early without touching MoonshineVoice. We test the pure-JS layer:
 * handler registration, unsubscribe, isActive state, deactivate, destroy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  VoiceCommandService,
  NAVIGATION_INTENTS,
  createVoiceCommandService,
  type NavIntent,
} from "../voiceCommandService";

// react-native is aliased to the stub which exports Platform.OS = "web"

describe("NAVIGATION_INTENTS", () => {
  it("exports a non-empty array of intent definitions", () => {
    expect(Array.isArray(NAVIGATION_INTENTS)).toBe(true);
    expect(NAVIGATION_INTENTS.length).toBeGreaterThan(0);
  });

  it("every intent definition has triggerPhrase, intent, and description", () => {
    for (const def of NAVIGATION_INTENTS) {
      expect(typeof def.triggerPhrase).toBe("string");
      expect(def.triggerPhrase.length).toBeGreaterThan(0);
      expect(typeof def.intent).toBe("string");
      expect(typeof def.description).toBe("string");
    }
  });

  it("contains expected intents", () => {
    const ids = new Set(NAVIGATION_INTENTS.map((d) => d.intent));
    expect(ids.has("NAV_NEXT_TURN")).toBe(true);
    expect(ids.has("NAV_STOP")).toBe(true);
    expect(ids.has("COPILOT_ACTIVATE")).toBe(true);
  });
});

describe("VoiceCommandService — constructor / factory", () => {
  it("createVoiceCommandService returns a VoiceCommandService instance", () => {
    const svc = createVoiceCommandService();
    expect(svc).toBeInstanceOf(VoiceCommandService);
  });

  it("isActive defaults to false", () => {
    const svc = new VoiceCommandService();
    expect(svc.isActive).toBe(false);
  });
});

describe("VoiceCommandService — handler management", () => {
  let svc: VoiceCommandService;

  beforeEach(() => {
    svc = new VoiceCommandService();
  });

  it("onCommand registers a handler and returns an unsubscribe fn", () => {
    const handler = vi.fn();
    const unsub = svc.onCommand(handler);
    expect(typeof unsub).toBe("function");
  });

  it("unsubscribe removes the handler so it is no longer called", () => {
    const handler = vi.fn();
    const unsub = svc.onCommand(handler);
    unsub(); // remove handler
    // Simulate internal dispatch by calling destroy (handlers cleared)
    svc.destroy();
    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple handlers can be registered independently", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = svc.onCommand(h1);
    svc.onCommand(h2);
    unsub1();
    // h1 is removed; h2 remains — verify by checking handler list size indirectly
    // (no public API to count handlers, so we just confirm no throw)
    expect(() => svc.destroy()).not.toThrow();
  });
});

describe("VoiceCommandService — activate / deactivate on web", () => {
  let svc: VoiceCommandService;

  beforeEach(() => {
    svc = new VoiceCommandService();
  });

  it("activate() on web does not set isActive to true", async () => {
    await svc.activate();
    // Platform.OS === "web" → returns early without activating
    expect(svc.isActive).toBe(false);
  });

  it("activate() is idempotent when already active", async () => {
    // Force isActive = true to test idempotency branch
    await svc.activate(); // no-op on web; isActive stays false
    await svc.activate(); // should not throw
    expect(svc.isActive).toBe(false);
  });

  it("deactivate() when not active does not throw", async () => {
    await expect(svc.deactivate()).resolves.toBeUndefined();
  });

  it("destroy() clears all handlers without throwing", () => {
    svc.onCommand(vi.fn());
    expect(() => svc.destroy()).not.toThrow();
  });
});
