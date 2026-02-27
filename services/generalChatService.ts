/**
 * General Chat Service — AI Gateway (no user API keys).
 *
 * A general-purpose AI chat with real-time GPS awareness.
 * Not route-aware, but knows the driver's location, heading, and speed.
 *
 * Uses AI Gateway via server proxy (AI_GATEWAY_API_KEY on server).
 */
import { Platform } from "react-native";
import { createLogger } from "@/lib/logger";

const log = createLogger("GeneralChat");

export interface GeneralChatMessage {
  role: "user" | "assistant";
  content: string;
}

const BASE_PROMPT = `You are a friendly, helpful AI assistant inside a mobile app used by trash collection drivers. You have access to their real-time GPS location, heading, and speed. You can chat about anything — work, life, trivia, jokes, advice, whatever the user wants to talk about. Keep responses concise (2-4 sentences) and conversational. No emojis, no markdown — plain text only since responses may be read aloud. You can reference the driver's location or speed if relevant to the conversation.`;

/** Get current position for the general chat system prompt. */
async function _getLocationContext(): Promise<string> {
  try {
    const pos = await new Promise<{ lat: number; lon: number; heading: number | null; speed: number | null }>((resolve, reject) => {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            heading: p.coords.heading,
            speed: p.coords.speed,
          }),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 3000, maximumAge: 15000 },
        );
      } else {
        import("expo-location").then(async (Location) => {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") return reject(new Error("denied"));
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          resolve({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            heading: loc.coords.heading ?? null,
            speed: loc.coords.speed ?? null,
          });
        }).catch(reject);
      }
    });

    const dirs = ["North", "NE", "East", "SE", "South", "SW", "West", "NW"];
    const parts = [`GPS: ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`];
    if (pos.heading != null) parts.push(`Heading: ${dirs[Math.round(pos.heading / 45) % 8]} (${Math.round(pos.heading)}°)`);
    if (pos.speed != null && pos.speed >= 0) parts.push(`Speed: ${(pos.speed * 2.237).toFixed(1)} mph`);
    return `\n\nDriver's current location: ${parts.join(" | ")}`;
  } catch {
    return "";
  }
}

/** Build the system prompt with optional location context. */
async function buildSystemPrompt(): Promise<string> {
  const locationCtx = await _getLocationContext();
  return BASE_PROMPT + locationCtx;
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Send a message using AI Gateway via server proxy.
 */
const MAX_MESSAGE_LENGTH = 2000;

export async function sendGeneralChatMessage(
  message: string,
  history: GeneralChatMessage[],
): Promise<{ reply: string; provider: "aigateway" | "fallback" }> {
  if (!message || !message.trim()) {
    return { reply: "Please enter a message.", provider: "fallback" };
  }
  const sanitized = message.trim().slice(0, MAX_MESSAGE_LENGTH);
  const systemPrompt = await buildSystemPrompt();

  const { sendAiProxyChat } = await import("@/lib/ai-gateway-client");
  const messages = [
    ...history.slice(-20).map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
    { role: "user" as const, content: sanitized },
  ];
  const reply = await sendAiProxyChat(messages, {
    systemPrompt,
    max_tokens: 400,
    temperature: 0.8,
  });

  if (reply) {
    log.debug("AI Gateway succeeded");
    return { reply, provider: "aigateway" };
  }

  log.error("AI Gateway failed");
  return {
    reply: "I can't connect right now. Set AI_GATEWAY_API_KEY on your server (Railway).",
    provider: "fallback",
  };
}
