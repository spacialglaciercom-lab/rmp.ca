/**
 * AI Chat plugin: floating chat bubble on the map for AI assistant.
 * When enabled, the AI chat bubble is shown; when disabled, it is hidden.
 */
import type { Plugin } from "../types";

export const aiChatPlugin: Plugin = {
  id: "ai-chat",
  name: "AI Chat",
  description: "Floating AI chat bubble on map — tap to type, hold to talk",
  version: "1.0.0",
  initialize() {},
  destroy() {},
  getFeatures() {
    return {};
  },
};
