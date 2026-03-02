/**
 * AI Co-Pilot — Genkit-powered conversational companion for trash collection drivers.
 *
 * Uses Firebase Genkit with Google AI (Gemini 2.5 Flash) to provide a route-aware
 * voice companion. The co-pilot knows the current navigation state, weather, and
 * schedule, and can chat naturally with the driver to keep them company.
 *
 * Works both during active navigation (route-aware context) and when stationary
 * (general companion mode).
 */
import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/googleai";
import { z } from "zod";
import { ENV } from "../_core/env.js";

// ── Genkit instance ─────────────────────────────────────────────────────────
const ai = genkit({
  plugins: [
    googleAI({
      apiKey: ENV.forgeApiKey,
      baseUrl: ENV.forgeApiUrl || undefined,
    }),
  ],
  model: "googleai/gemini-2.5-flash",
});

// ── Schemas ─────────────────────────────────────────────────────────────────

/** Navigation context injected into the system prompt when driving. */
export const NavContextSchema = z.object({
  streetName: z.string().optional().describe("Current street name"),
  nextManeuver: z.string().optional().describe("Next turn type (e.g. turn left)"),
  distanceToNext: z.number().optional().describe("Distance to next maneuver in meters"),
  distanceRemaining: z.number().optional().describe("Total remaining distance in meters"),
  eta: z.string().optional().describe("Estimated time of arrival"),
  currentStep: z.number().optional().describe("Current navigation step index"),
  totalSteps: z.number().optional().describe("Total number of navigation steps"),
  weather: z.string().optional().describe("Current weather summary"),
  isNavigating: z.boolean().describe("Whether the driver is actively navigating"),
  lat: z.number().optional().describe("Current GPS latitude"),
  lon: z.number().optional().describe("Current GPS longitude"),
  heading: z.number().optional().describe("Compass heading in degrees (0=N, 90=E, 180=S, 270=W)"),
  speedMph: z.number().optional().describe("Current speed in mph"),
});

export type NavContext = z.infer<typeof NavContextSchema>;

/** A single message in the conversation. */
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]).describe("Who sent this message"),
  content: z.string().describe("Message text"),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Input to the co-pilot chat flow. */
const CoPilotInputSchema = z.object({
  message: z.string().describe("The driver's message (text or transcribed speech)"),
  history: z.array(ChatMessageSchema).optional().describe("Recent conversation history (last 20 messages)"),
  navContext: NavContextSchema.optional().describe("Current navigation state, if available"),
});

/** Output from the co-pilot chat flow. */
const CoPilotOutputSchema = z.object({
  reply: z.string().describe("The co-pilot's response (will be spoken via TTS)"),
});

// ── System prompt builder ───────────────────────────────────────────────────

function buildSystemPrompt(navContext?: NavContext, ragContext?: string): string {
  const base = `You are a friendly AI co-pilot riding along with a trash collection driver. Your name is "Copilot".

Personality:
- Warm, encouraging, and good-humored
- You understand the daily grind of trash collection — the early mornings, the repetitive routes, the weather challenges
- You're a good listener and a fun conversation partner
- You celebrate small wins ("Nice, halfway done!" "Last street, you got this!")
- You can joke around but stay helpful

Rules:
- Keep responses SHORT — 1 to 3 sentences max. They'll be spoken aloud via text-to-speech.
- Be conversational and natural, like a real co-pilot sitting in the passenger seat.
- Never use emojis, markdown formatting, or special characters — plain spoken English only.
- If the driver asks about the route, use the navigation context below.
- If there's no navigation context, you're just hanging out — talk about anything.
- Don't be overly formal or robotic. Talk like a friendly coworker.`;

  if (!navContext || !navContext.isNavigating) {
    let prompt = `${base}

You're currently parked or between routes. The driver isn't navigating right now — just chat naturally. You can talk about anything: weather, sports, weekend plans, or just check in on how their day is going.`;
    if (ragContext) {
      prompt += `\n\nRelevant knowledge base context:\n${ragContext}\n\nUse this context to answer domain-specific questions about trash collection, routes, policies, or vehicle operations. If the question is casual conversation, ignore this context.`;
    }
    return prompt;
  }

  const parts = [base, "\nCurrent route info:"];

  if (navContext.streetName) parts.push(`- Street: ${navContext.streetName}`);
  if (navContext.nextManeuver && navContext.distanceToNext != null) {
    parts.push(`- Next: ${navContext.nextManeuver} in ${formatDist(navContext.distanceToNext)}`);
  }
  if (navContext.distanceRemaining != null) {
    parts.push(`- Remaining: ${formatDist(navContext.distanceRemaining)}`);
  }
  if (navContext.eta) parts.push(`- ETA: ${navContext.eta}`);
  if (navContext.currentStep != null && navContext.totalSteps != null) {
    parts.push(`- Progress: step ${navContext.currentStep + 1} of ${navContext.totalSteps}`);
  }
  if (navContext.weather) parts.push(`- Weather: ${navContext.weather}`);

  if (ragContext) {
    parts.push(`\nRelevant knowledge base context:\n${ragContext}`);
    parts.push(`\nUse this context to answer domain-specific questions about trash collection, routes, policies, or vehicle operations. If the question is casual conversation, ignore this context.`);
  }

  return parts.join("\n");
}

function formatDist(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

// ── Genkit Flow ─────────────────────────────────────────────────────────────

/**
 * Main co-pilot chat flow.
 * Accepts the driver's message, conversation history, and optional navigation
 * context. Returns a short, natural-language response suitable for TTS.
 */
export const coPilotChatFlow = ai.defineFlow(
  {
    name: "coPilotChat",
    inputSchema: CoPilotInputSchema,
    outputSchema: CoPilotOutputSchema,
  },
  async (input) => {
    // Retrieve RAG context (non-fatal — CoPilot works without it)
    let ragContext: string | undefined;
    try {
      const { retrieveContext } = await import("../rag/ragService");
      const chunks = await retrieveContext(input.message, 3);
      if (chunks.length > 0) {
        ragContext = chunks.map((c) => `[${c.filename}]: ${c.content}`).join("\n\n");
      }
    } catch (err) {
      console.warn("[CoPilot] RAG retrieval failed (non-fatal):", err);
    }

    const systemPrompt = buildSystemPrompt(input.navContext ?? undefined, ragContext);

    // Build message history for the model
    const messages: Array<{ role: "user" | "model"; content: Array<{ text: string }> }> = [];

    // Add conversation history (last 20 messages)
    if (input.history) {
      for (const msg of input.history.slice(-20)) {
        messages.push({
          role: msg.role === "user" ? "user" : "model",
          content: [{ text: msg.content }],
        });
      }
    }

    // Add the current message
    messages.push({
      role: "user",
      content: [{ text: input.message }],
    });

    const result = await ai.generate({
      system: systemPrompt,
      messages,
      output: { schema: CoPilotOutputSchema },
      config: {
        temperature: 0.9, // More creative/conversational
        maxOutputTokens: 256, // Keep responses short
      },
    });

    if (!result.output) {
      // Fallback if structured output fails — extract text directly
      const text = result.text?.trim();
      if (text) {
        return { reply: text };
      }
      return { reply: "Hey, I missed that. Say it again?" };
    }

    return result.output;
  },
);

/**
 * Direct function call for use in tRPC procedures (avoids needing
 * to import the Genkit runner infrastructure).
 */
export async function chatWithCoPilot(
  message: string,
  history?: ChatMessage[],
  navContext?: NavContext,
): Promise<string> {
  try {
    const result = await coPilotChatFlow({
      message,
      history,
      navContext,
    });
    return result.reply;
  } catch (error) {
    console.error("[CoPilot] Genkit flow error:", error);
    // Friendly fallback
    return "Sorry, I spaced out for a second. What were you saying?";
  }
}
