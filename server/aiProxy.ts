/**
 * AI Proxy — chat and stream via AI Gateway.
 *
 * We use AI SDK 6, which supports both v2 and v3 model specs from the gateway.
 * Default model is openai/gpt-4o-mini. No model picker in the app; server uses this default.
 */
import type { Express, Request, Response } from "express";
import { streamText, wrapLanguageModel, generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ENV } from "./_core/env";
import { createLogger } from "./logger";
import { routeLoggerMiddleware } from "./middleware/routeLogger";
import { sdk } from "./_core/sdk";

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
export function getGateway(
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

/** Route logger: when ROUTE_LOG_UPLOAD_URL is set, wrap models so we capture input/output and optionally extract entities, then POST JSON in the background. */
function getRouteLoggerMiddleware() {
  if (!ENV.routeLogUploadUrl) return null;
  return routeLoggerMiddleware({
    uploadUrl: ENV.routeLogUploadUrl,
    analyze: ENV.routeLogAnalyze,
    extractEntities: ENV.routeLogAnalyze
      ? async (inputSummary: string, outputText: string) => {
          const gw = getGateway();
          if (!gw) return null;
          try {
            const { text } = await generateText({
              model: gw("openai/gpt-4o-mini"),
              system:
                "Extract from the conversation: gpxCoordinates (array of coordinate pairs or GPX refs), distanceEstimates (array of strings), routeErrors (array of strings). Return a single JSON object only, no markdown.",
              prompt: `Input:\n${inputSummary.slice(0, 5000)}\n\nOutput:\n${outputText.slice(0, 15000)}`,
              maxOutputTokens: 1024,
            });
            const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
            return JSON.parse(cleaned) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      : undefined,
  });
}

/** Returns the gateway model, wrapped with route-logger middleware when ROUTE_LOG_UPLOAD_URL is set. */
function getModelWithOptionalLogging(modelId: string) {
  const gw = getGateway();
  if (!gw) return null;
  const base = gw(modelId);
  const logger = getRouteLoggerMiddleware();
  if (!logger) return base;
  return wrapLanguageModel({ model: base, middleware: logger });
}

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
    const modelWithLogging = getModelWithOptionalLogging(model);
    if (!modelWithLogging) continue;
    try {
      result = streamText({ model: modelWithLogging, ...opts });
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
  /** POST /api/analyze-route — Proxy pattern: mobile sends gpxData + Bearer token; server holds gateway key, returns only { analysis }. */
  const ROUTE_ANALYSIS_SYSTEM =
    "You are a logistics expert. Analyze the efficiency of this collection route. Be concise and actionable.";
  app.post("/api/analyze-route", async (req: Request, res: Response) => {
    try {
      await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = req.body as { gpxData?: unknown };
    const gpxData =
      typeof body?.gpxData === "string" ? body.gpxData.trim() : "";
    if (!gpxData) {
      res.status(400).json({ error: "gpxData is required" });
      return;
    }

    const gateway = getGateway();
    if (!gateway) {
      res.status(503).json({
        error:
          "AI Gateway not configured. Set AI_GATEWAY_API_KEY or OPENROUTER_API_KEY on the server.",
      });
      return;
    }

    try {
      const text = await chatWithAiGateway(
        [{ role: "user", content: `Analyze this GPX data: ${gpxData}` }],
        ROUTE_ANALYSIS_SYSTEM,
        { maxOutputTokens: 512, temperature: 0.3 },
      );
      res.json({ analysis: text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      const isRateLimit =
        lower.includes("429") ||
        lower.includes("rate") ||
        lower.includes("limit");
      const isTimeout =
        lower.includes("timeout") ||
        lower.includes("504") ||
        lower.includes("gateway");
      const userMessage =
        isRateLimit || isTimeout
          ? "Analysis service is busy. Try again in a few minutes."
          : message.includes("API key") || message.includes("401")
            ? "AI Gateway is not configured correctly. Contact support."
            : "Analysis failed. Try again later.";
      log.error("analyze-route gateway error", {
        message,
        userMessage,
      });
      res
        .status(isRateLimit ? 429 : isTimeout ? 504 : 500)
        .json({ error: userMessage });
    }
  });

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
        const modelWithLogging = getModelWithOptionalLogging(tryModel);
        if (!modelWithLogging) continue;
        try {
          result = streamText({ model: modelWithLogging, ...opts });
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
        const rawStatus =
          typeof (streamErr as { status?: number })?.status === "number"
            ? (streamErr as { status: number }).status
            : 500;
        const gatewayMessage = msg || cause || "AI Gateway request failed";
        const lowerMsg = gatewayMessage.toLowerCase();
        const isRateLimit =
          rawStatus === 429 ||
          lowerMsg.includes("429") ||
          lowerMsg.includes("rate") ||
          lowerMsg.includes("limit");
        const isTimeout =
          rawStatus === 504 ||
          lowerMsg.includes("timeout") ||
          lowerMsg.includes("504") ||
          lowerMsg.includes("gateway");
        const userMessage =
          gatewayMessage.includes("API key") || gatewayMessage.includes("401")
            ? "Invalid or missing AI Gateway API key. Check AI_GATEWAY_API_KEY or OPENROUTER_API_KEY."
            : isRateLimit
              ? "AI Gateway rate limit. Try again shortly."
              : isTimeout
                ? "Analysis service is busy. Try again in a few minutes."
                : gatewayMessage;
        const status = isRateLimit ? 429 : isTimeout ? 504 : (rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500);
        res.status(status).json({ error: userMessage });
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
      const lower = message.toLowerCase();
      const isRateLimit =
        lower.includes("429") || lower.includes("rate") || lower.includes("limit");
      const isTimeout =
        lower.includes("timeout") || lower.includes("504") || lower.includes("gateway");
      const hint =
        message.includes("API key") || message.includes("401")
          ? "Invalid or missing AI_GATEWAY_API_KEY or OPENROUTER_API_KEY."
          : isRateLimit
            ? "AI Gateway rate limit. Try again shortly."
            : isTimeout
              ? "Analysis service is busy. Try again in a few minutes."
              : message || "AI proxy request failed";
      const status = isRateLimit ? 429 : isTimeout ? 504 : 500;
      res.status(status).json({ error: hint });
    }
  });
}
