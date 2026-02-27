import React from "react";
import { ApiKeySection } from "./ApiKeySection";
import { getOpenRouterApiKey, setOpenRouterApiKey } from "@/lib/openrouter-api-key";

export function OpenRouterApiKeySection() {
  return (
    <ApiKeySection
      label="OpenRouter API key"
      description="Powers general chat & Co-Pilot fallback. Get a key at openrouter.ai"
      placeholder="sk-or-…"
      getKey={getOpenRouterApiKey}
      setKey={setOpenRouterApiKey}
      savedMessage="OpenRouter API key saved."
      clearedMessage="OpenRouter API key cleared."
    />
  );
}
