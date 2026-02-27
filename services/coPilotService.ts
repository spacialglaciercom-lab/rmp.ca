/**
 * Co-Pilot AI Service — Single-tier: AI Gateway only.
 *
 * Uses the server proxy (/api/ai/chat) which forwards to AI Gateway.
 * One API key on server (AI_GATEWAY_API_KEY). No user API keys.
 *
 * Builds a route-aware prompt from navigation context (GPS, weather, route info).
 */
import { Platform } from "react-native";
import type { NavContext, ChatMessage } from "@/server/genkit/coPilot";
import { createLogger } from "@/lib/logger";

const log = createLogger("CoPilot");

// ── GPS position helper ─────────────────────────────────────────────────────

interface GpsPosition {
  lat: number;
  lon: number;
  heading: number | null;
  speed: number | null; // m/s
}

/** Cache position briefly so parallel calls don't spam the GPS. */
let _posCache: { pos: GpsPosition; ts: number } | null = null;
const POS_CACHE_TTL = 10_000; // 10 seconds

/**
 * Get current GPS position with heading + speed.
 * Works on both web (navigator.geolocation) and native (expo-location).
 */
async function _getPosition(): Promise<GpsPosition | null> {
  if (_posCache && Date.now() - _posCache.ts < POS_CACHE_TTL) {
    return _posCache.pos;
  }

  try {
    const pos = await new Promise<GpsPosition>((resolve, reject) => {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            heading: p.coords.heading,
            speed: p.coords.speed,
          }),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
        );
      } else {
        import("expo-location").then(async (Location) => {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== "granted") return reject(new Error("Location denied"));
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          resolve({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            heading: loc.coords.heading ?? null,
            speed: loc.coords.speed ?? null,
          });
        }).catch(reject);
      }
    });

    _posCache = { pos, ts: Date.now() };
    return pos;
  } catch (err) {
    log.warn("GPS position fetch failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── Weather for stationary mode ─────────────────────────────────────────────

/** Cache so we don't spam the weather API every message. */
let _weatherCache: { text: string; ts: number } | null = null;
const WEATHER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch current weather using cached GPS position.
 * Used when the driver is parked (no navContext with weather).
 */
async function getStationaryWeather(): Promise<string | null> {
  if (_weatherCache && Date.now() - _weatherCache.ts < WEATHER_CACHE_TTL) {
    return _weatherCache.text;
  }

  try {
    const pos = await _getPosition();
    if (!pos) return null;

    const { getCurrentWeather } = await import("@/services/weatherService");
    const w = await getCurrentWeather(pos.lat, pos.lon);
    if (!w) return null;

    const text = `${w.condition.main} (${w.condition.description}), ${Math.round(w.temp)}°C, feels like ${Math.round(w.feelsLike)}°C, wind ${w.windSpeed.toFixed(1)} m/s, humidity ${w.humidity}%${w.rain1h ? `, rain ${w.rain1h} mm/h` : ""}${w.snow1h ? `, snow ${w.snow1h} mm/h` : ""}`;
    _weatherCache = { text, ts: Date.now() };
    return text;
  } catch (err) {
    log.warn("Stationary weather fetch failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── Prompt builder ──────────────────────────────────────────────────────────

/** Convert compass degrees to human-readable direction. */
function headingToDirection(deg: number): string {
  const dirs = ["North", "NE", "East", "SE", "South", "SW", "West", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function buildCoPilotPrompt(navContext: NavContext | null, userMessage: string, ragContext?: string | null): string {
  const personality = `You are a friendly AI co-pilot named Copilot, riding along with a trash collection driver. You have access to their real-time GPS location, compass heading, and speed. Be warm, encouraging, and keep responses to 1-3 short sentences since they will be spoken aloud. No emojis, no markdown — plain spoken English only.`;

  // Build location line (shared between navigating and stationary)
  const locationParts: string[] = [];
  if (navContext?.lat != null && navContext?.lon != null) {
    locationParts.push(`GPS: ${navContext.lat.toFixed(5)}, ${navContext.lon.toFixed(5)}`);
  }
  if (navContext?.heading != null) {
    locationParts.push(`Heading: ${headingToDirection(navContext.heading)} (${navContext.heading}°)`);
  }
  if (navContext?.speedMph != null) {
    locationParts.push(`Speed: ${navContext.speedMph} mph`);
  }
  const locationLine = locationParts.length > 0 ? `\nLocation: ${locationParts.join(" | ")}` : "";

  const ragBlock = ragContext
    ? `\n\nRelevant knowledge base context:\n${ragContext}\n\nUse this context to answer domain-specific questions about trash collection, routes, policies, or vehicle operations. If the question is casual conversation, ignore this context.`
    : "";

  if (!navContext || !navContext.isNavigating) {
    const weatherLine = navContext?.weather ? `\nWeather: ${navContext.weather}` : "";
    return `${personality}\n\nThe driver is currently parked or between routes.${locationLine}${weatherLine}${ragBlock}\n\nThey said: "${userMessage}"\n\nReply naturally as a friendly coworker would. You can reference their location, speed, or direction if relevant to the conversation. If weather is notable (extreme heat, rain, cold), feel free to mention it.`;
  }

  const parts = [personality, "\nCurrent route info:"];
  if (navContext.streetName) parts.push(`- Street: ${navContext.streetName}`);
  if (navContext.nextManeuver && navContext.distanceToNext != null) {
    const dist = navContext.distanceToNext >= 1000
      ? `${(navContext.distanceToNext / 1000).toFixed(1)} km`
      : `${Math.round(navContext.distanceToNext)} m`;
    parts.push(`- Next: ${navContext.nextManeuver} in ${dist}`);
  }
  if (navContext.distanceRemaining != null) {
    const rem = navContext.distanceRemaining >= 1000
      ? `${(navContext.distanceRemaining / 1000).toFixed(1)} km`
      : `${Math.round(navContext.distanceRemaining)} m`;
    parts.push(`- Remaining: ${rem}`);
  }
  if (navContext.eta) parts.push(`- ETA: ${navContext.eta}`);
  if (navContext.currentStep != null && navContext.totalSteps != null) {
    parts.push(`- Progress: step ${navContext.currentStep + 1} of ${navContext.totalSteps}`);
  }
  if (locationLine) parts.push(locationLine.trim());
  if (navContext.weather) parts.push(`- Weather: ${navContext.weather}`);

  if (ragBlock) parts.push(ragBlock);
  parts.push(`\nThe driver said: "${userMessage}"`);
  parts.push("\nReply in 1-3 short sentences. You can reference their speed, heading, or location if relevant.");
  return parts.join("\n");
}

// ── RAG context fetch (optional enrichment) ────────────────────────────────────

/**
 * Fetch relevant knowledge base context from the server's RAG pipeline.
 * Returns formatted text to inject into the system prompt, or null on failure.
 * Non-fatal — CoPilot works without RAG context.
 */
async function fetchRagContext(message: string): Promise<string | null> {
  try {
    const { getApiBaseUrl } = await import("@/shared/oauth");
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const input = JSON.stringify({ json: { query: message, topK: 3 } });
    const resp = await fetch(
      `${baseUrl}/api/trpc/rag.query?input=${encodeURIComponent(input)}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: Platform.OS === "web" ? "include" : undefined as any,
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);
    if (!resp.ok) return null;

    const data = await resp.json();
    const results = data?.result?.data?.json?.results;
    if (!Array.isArray(results) || results.length === 0) return null;

    return results
      .map((r: { filename: string; content: string }) => `[${r.filename}]: ${r.content}`)
      .join("\n\n");
  } catch {
    return null;
  }
}

// ── AI Gateway (single tier) ────────────────────────────────────────────────

let lastGatewayError: string | null = null;

async function tryAIGateway(
  message: string,
  history: ChatMessage[],
  navContext: NavContext | null,
  ragContext?: string | null,
): Promise<string | null> {
  lastGatewayError = null;
  try {
    const { sendAiProxyChatWithError } = await import("@/lib/ai-gateway-client");
    const systemPrompt = buildCoPilotPrompt(navContext, message, ragContext);
    const messages = [
      ...history.slice(-10).map((msg) => ({
        role: (msg.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user" as const, content: message },
    ];
    const { reply, error } = await sendAiProxyChatWithError(messages, {
      systemPrompt,
      max_tokens: 200,
      temperature: 0.9,
    });
    if (reply) {
      log.debug("AI Gateway succeeded");
      return reply;
    }
    if (error) lastGatewayError = error;
  } catch (err) {
    lastGatewayError = err instanceof Error ? err.message : String(err);
    log.warn("AI Gateway failed", { error: lastGatewayError });
  }
  return null;
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Send a message to the co-pilot via AI Gateway (server proxy).
 * Returns the AI response text, or a fallback error message.
 */
export async function sendCoPilotMessage(
  message: string,
  history: ChatMessage[],
  navContext: NavContext | null,
): Promise<{ reply: string; tier: "aigateway" | "fallback" }> {
  // Enrich with GPS + weather if not already present (stationary / parked mode)
  if (!navContext?.lat) {
    try {
      const pos = await _getPosition();
      if (pos) {
        navContext = {
          ...(navContext ?? { isNavigating: false }),
          lat: pos.lat,
          lon: pos.lon,
          heading: pos.heading != null ? Math.round(pos.heading) : undefined,
          speedMph: pos.speed != null && pos.speed >= 0
            ? Math.round(pos.speed * 2.237 * 10) / 10
            : undefined,
        } as NavContext;
      }
    } catch {
      // GPS is best-effort
    }
  }

  if (!navContext?.weather) {
    try {
      const weather = await getStationaryWeather();
      if (weather) {
        navContext = { ...(navContext ?? { isNavigating: false }), weather } as NavContext;
      }
    } catch {
      // Weather is best-effort
    }
  }

  // Optional RAG context (best-effort)
  const ragContext = await fetchRagContext(message);

  const reply = await tryAIGateway(message, history, navContext, ragContext);

  if (reply) {
    return { reply, tier: "aigateway" };
  }

  log.error("AI Gateway failed", { error: lastGatewayError ?? undefined });
  const hint =
    lastGatewayError && (lastGatewayError.includes("API key") || lastGatewayError.includes("EXPO_PUBLIC_API"))
      ? lastGatewayError
      : lastGatewayError && lastGatewayError.length < 120
        ? lastGatewayError
        : "Sorry, I can't connect right now. Make sure AI_GATEWAY_API_KEY is set on your server and EXPO_PUBLIC_API_BASE_URL points to it.";
  return {
    reply: hint,
    tier: "fallback",
  };
}
