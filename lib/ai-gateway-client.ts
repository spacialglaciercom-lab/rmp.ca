/**
 * AI Chat client — AI Gateway via server proxy.
 * Server uses AI SDK 6 (supports v2 and v3 models). No model picker in the app; default below is used.
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("AiGateway");

export const DEFAULT_AI_CHAT_MODEL = "openai/gpt-4o-mini";

function isAnthropicModel(modelId: string): boolean {
  const id = (modelId ?? "").toLowerCase();
  return id.startsWith("anthropic/") || id.includes("claude");
}

function getApiBaseUrl(): string {
  try {
    const { getApiBaseUrl: get } = require("@/shared/oauth");
    return get();
  } catch {
    return "";
  }
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatOptions {
  model?: string;
  systemPrompt?: string;
  max_tokens?: number;
  temperature?: number;
}

/**
 * Get a user-facing hint when AI chat fails (for Expo Go / native).
 * Caller can show this in the "can't connect" fallback message.
 */
export function getAiGatewayConnectionHint(): string {
  const base = getApiBaseUrl();
  if (!base) {
    return "Set EXPO_PUBLIC_API_BASE_URL in .env and restart the app.";
  }
  // On device, localhost is the device — use your computer's LAN IP (e.g. http://192.168.1.x:3000)
  if (base.includes("localhost") || base.includes("127.0.0.1")) {
    return "On Expo Go (phone), use your PC's IP instead of localhost, e.g. http://192.168.1.x:3000";
  }
  return "Check the server is running and AI_GATEWAY_API_KEY is set.";
}

/** Result of sendAiProxyChat: reply text or null and optional server error message. */
export interface SendAiProxyChatResult {
  reply: string | null;
  error?: string;
}

/**
 * Send a chat completion request via our server's AI proxy.
 * Returns the reply text or null on failure; error is set when the server returns an error message.
 */
export async function sendAiProxyChat(
  messages: AiChatMessage[],
  options?: AiChatOptions,
): Promise<string | null> {
  const result = await sendAiProxyChatWithError(messages, options);
  return result.reply;
}

/**
 * Same as sendAiProxyChat but returns { reply, error? } so callers can show the server error (e.g. invalid API key).
 */
export async function sendAiProxyChatWithError(
  messages: AiChatMessage[],
  options?: AiChatOptions,
): Promise<SendAiProxyChatResult> {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { reply: null, error: "Invalid messages array" };
  }
  for (const msg of messages) {
    if (!msg.role || typeof msg.content !== "string") {
      return { reply: null, error: "Invalid message format" };
    }
  }

  const base = getApiBaseUrl();
  if (!base) {
    log.warn("No API base URL — set EXPO_PUBLIC_API_BASE_URL");
    return { reply: null, error: "No API base URL. Set EXPO_PUBLIC_API_BASE_URL." };
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: options?.model ?? DEFAULT_AI_CHAT_MODEL,
        systemPrompt: options?.systemPrompt,
        max_tokens: options?.max_tokens ?? 400,
        temperature: options?.temperature ?? 0.8,
      }),
    });

    const text = await response.text();
    let data: { reply?: string; error?: string } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      log.warn("Server returned non-JSON; is /api/ai/chat deployed?", { status: response.status, body: text.slice(0, 80) });
      return { reply: null, error: "Server returned invalid response. Is the API server running?" };
    }

    if (!response.ok) {
      const serverError = data?.error && typeof data.error === "string" ? data.error : undefined;
      log.warn("Proxy error", { status: response.status, error: serverError });
      return { reply: null, error: serverError ?? `Request failed (${response.status})` };
    }

    const reply = data?.reply;
    return { reply: reply && typeof reply === "string" ? reply : null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("Request failed", { error: message });
    return { reply: null, error: message };
  }
}
