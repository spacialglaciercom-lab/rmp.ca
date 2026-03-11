/**
 * AI Proxy — chat and stream via AI Gateway.
 *
 * We use AI SDK 6, which supports both v2 and v3 model specs from the gateway.
 * Default model is openai/gpt-4o-mini. No model picker in the app; server uses this default.
 */
import type { Express, Request, Response } from "express";
import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ENV } from "./_core/env";
import { createLogger } from "./logger";

const log = createLogger("ai-proxy");

/** Default model when client does not send a model. Works with AI SDK 6 (v2 and v3). */
const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** Fallbacks if the default or requested model fails (e.g. rate limit, timeout). */
const FALLBACK_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "openai/gpt-4.1-mini",
] as const;

function isAnthropicModel(modelId: string): boolean {
  const id = modelId?.toLowerCase() ?? "";
  return id.startsWith("anthropic/") || id.includes("claude");
}

const VERCEL_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

/** Build gateway client. Prefer explicit key (e.g. from client); then server AI_GATEWAY_API_KEY; then OPENROUTER_API_KEY. */
function getGateway(
  overrideApiKey?: string,
): ReturnType<typeof createOpenAICompatible> | null {
  const apiKey =
    overrideApiKey?.trim() || ENV.aiGatewayApiKey || ENV.openRouterApiKey;
  if (!apiKey) return null;
  const baseURL = overrideApiKey?.trim()
    ? OPENROUTER_API_URL
    : ENV.aiGatewayApiKey
      ? VERCEL_GATEWAY_URL
      : OPENROUTER_API_URL;
  return createOpenAICompatible({
    name: "openai",
    apiKey,
    baseURL,
  });
}

const GATEWAY_TIMEOUT_MS = 35_000;

/** Shared sync chat via AI Gateway for voice.chat / CoPilot. Returns reply text or throws. */
export async function chatWithAiGateway(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  systemPrompt?: string,
  options?: { maxOutputTokens?: number; temperature?: number; apiKey?: string },
): Promise<string> {
  const gateway = getGateway(options?.apiKey);
  if (!gateway)
    throw new Error(
      "AI Gateway not configured (set AI_GATEWAY_API_KEY or OPENROUTER_API_KEY)",
    );

  const usingClientKey = Boolean(options?.apiKey?.trim());
  log.info("CoPilot gateway request", {
    usingClientKey,
    hasServerGatewayKey: Boolean(ENV.aiGatewayApiKey),
    hasServerOpenRouterKey: Boolean(ENV.openRouterApiKey),
  });

  const finalMessages = systemPrompt
    ? messages.filter((m) => m.role !== "system")
    : messages;
  if (finalMessages.length === 0) throw new Error("messages required");

  const opts = {
    messages: finalMessages,
    system: systemPrompt ?? undefined,
    maxOutputTokens: options?.maxOutputTokens ?? 256,
    temperature: options?.temperature ?? 0.9,
  };

  let result: Awaited<ReturnType<typeof streamText>> | undefined;
  let lastErr: unknown = null;
  for (const model of FALLBACK_MODELS) {
    try {
      result = streamText({ model: gateway(model), ...opts });
      break;
    } catch (err) {
      lastErr = err;
      log.warn("gateway model failed", {
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (!result) throw lastErr ?? new Error("AI Gateway request failed");

  const textPromise = Promise.resolve(result.text).then((t) =>
    typeof t === "string" ? t : "",
  );
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error("AI gateway timed out. Try again or check your API key."),
        ),
      GATEWAY_TIMEOUT_MS,
    );
  });
  const fullText = await Promise.race([textPromise, timeoutPromise]);
  return fullText.trim();
}

function getAiSdkVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("ai/package.json") as { version?: string };
    return pkg?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function registerAiProxyRoutes(app: Express) {
  const sdkVersion = getAiSdkVersion();
  const hasKey = Boolean(ENV.aiGatewayApiKey || ENV.openRouterApiKey);
  log.warn("AI SDK version", {
    version: sdkVersion,
    apiKey: hasKey ? "set" : "not set",
  });
  if (sdkVersion.startsWith("5.")) {
    log.error(
      "AI SDK 5 does not support gateway v3 models; deploy must use ai@6 (see package.json). Clear build cache and redeploy.",
    );
  }
  /** GET so you can verify the route is deployed (e.g. curl http://localhost:3000/api/ai/chat) */
  app.get("/api/ai/chat", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      message:
        "AI chat endpoint. Use POST with body: { messages, systemPrompt?, model?, max_tokens?, temperature? }",
      configured: Boolean(ENV.aiGatewayApiKey || ENV.openRouterApiKey),
      aiSdkVersion: getAiSdkVersion(),
    });
  });

  /**
   * POST /api/ai/chat
   * Body: { messages, model?, systemPrompt?, max_tokens?, temperature? }
   * Uses streamText under the hood; consumes the full stream and returns { reply } for compatibility.
   */
  app.post("/api/ai/chat", async (req: Request, res: Response) => {
    const gateway = getGateway();
    if (!gateway) {
      res.status(503).json({
        error:
          "AI Gateway API key not configured on server. Set AI_GATEWAY_API_KEY or OPENROUTER_API_KEY.",
      });
      return;
    }

    try {
      const { messages, model, systemPrompt, max_tokens, temperature } =
        req.body as {
          messages: Array<{
            role: "system" | "user" | "assistant";
            content: string;
          }>;
          model?: string;
          systemPrompt?: string;
          max_tokens?: number;
          temperature?: number;
        };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const finalMessages = systemPrompt
        ? [...messages.filter((m) => m.role !== "system")]
        : messages;

      // Replace Anthropic/Claude with default; then build list: requested first, then fallbacks (deduped)
      const requestedModel = model ?? DEFAULT_MODEL;
      const firstModel = isAnthropicModel(requestedModel)
        ? DEFAULT_MODEL
        : requestedModel;
      if (requestedModel !== firstModel) {
        log.debug("Anthropic/Claude not used; trying", { model: firstModel });
      }
      const seen = new Set<string>();
      const modelsToTry: string[] = [];
      if (firstModel && !seen.has(firstModel)) {
        seen.add(firstModel);
        modelsToTry.push(firstModel);
      }
      for (const m of FALLBACK_MODELS) {
        if (!seen.has(m)) {
          seen.add(m);
          modelsToTry.push(m);
        }
      }

      const opts = {
        messages: finalMessages,
        system: systemPrompt ?? undefined,
        maxOutputTokens: max_tokens ?? 400,
        temperature: temperature ?? 0.8,
      };

      let result: Awaited<ReturnType<typeof streamText>> | undefined;
      let lastErr: unknown = null;
      for (const tryModel of modelsToTry) {
        try {
          result = streamText({ model: gateway(tryModel), ...opts });
          if (tryModel !== firstModel) {
            log.debug("using model", { model: tryModel });
          }
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          log.warn("model failed", { model: tryModel, error: msg });
        }
      }
      if (!result) {
        throw lastErr ?? new Error("AI proxy: no model succeeded.");
      }

      // Consume the full stream and return as a single reply (keeps existing client contract)
      const { text } = result;
      let fullText: string;
      try {
        fullText = await text;
      } catch (streamErr) {
        const msg =
          streamErr instanceof Error ? streamErr.message : String(streamErr);
        const cause =
          streamErr instanceof Error && streamErr.cause
            ? String(streamErr.cause)
            : "";
        log.error("AI Gateway stream error", {
          message: msg,
          cause: cause || undefined,
        });
        const status =
          typeof (streamErr as { status?: number })?.status === "number"
            ? (streamErr as { status: number }).status
            : 500;
        const gatewayMessage = msg || cause || "AI Gateway request failed";
        res.status(status >= 400 && status < 600 ? status : 500).json({
          error:
            gatewayMessage.includes("API key") || gatewayMessage.includes("401")
              ? "Invalid or missing AI Gateway API key. Check AI_GATEWAY_API_KEY or OPENROUTER_API_KEY."
              : gatewayMessage,
        });
        return;
      }
      const reply = (typeof fullText === "string" ? fullText : "").trim();

      if (reply) {
        res.json({ reply });
      } else {
        res
          .status(502)
          .json({ error: "Empty or invalid response from AI Gateway" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause ? String(err.cause) : "";
      log.error("chat error", { message, cause: cause || undefined });
      const hint =
        message.includes("API key") || message.includes("401")
          ? "Invalid or missing AI_GATEWAY_API_KEY or OPENROUTER_API_KEY."
          : message.includes("429") || message.includes("rate")
            ? "AI Gateway rate limit. Try again shortly."
            : message || "AI proxy request failed";
      res.status(500).json({ error: hint });
    }
  });
}
