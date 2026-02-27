/**
 * Route algorithm enhancement: ML-augmented heuristics using the Liquid LEAP SDK.
 * Uses the on-device LFM2-1.2B-Extract model (iOS) to score which edges are typically
 * problematic (narrow streets, time-restricted zones, poor surface) and returns
 * penalty multipliers to bias the Chinese Postman / Hierholzer solution.
 *
 * For a Firebase-hosted LSTM (TFLite): Firebase only stores the model; the app must
 * download it and run inference on-device. See docs/LEARNED_PENALTIES_FIREBASE_LSTM.md.
 *
 * @see https://github.com/Liquid4All/cookbook
 * @see LEAP_SDK_SETUP.md
 */

import { Platform } from "react-native";
import type { Way } from "@/lib/route-optimizer-v2/types";
import { getMistralApiKey } from "@/lib/mistral-api-key";

const MAX_WAYS_TO_SEND = 200;
const EXTRACT_SCHEMA_HINT = `Return a JSON object with a single key "scores" whose value is an array of objects: { "wayId": string, "problematic": number }.
problematic must be between 0 and 1: 0 = fine, 1 = avoid (narrow, time-restricted, heavy vehicle restricted, poor surface).
Only include wayIds that have problematic > 0. If none are problematic, return { "scores": [] }.`;

/**
 * Build a compact text summary of way tags for the Extract model.
 * Includes tags that indicate narrow streets, time-restricted zones, and vehicle restrictions.
 */
export function waySummary(way: Way): string {
  const t = way.tags ?? {};
  const parts = [
    way.id,
    t.highway ?? "",
    t.width ?? "",
    t.surface ?? "",
    t.maxweight ?? "",
    t.maxheight ?? "",
    t.maxlength ?? "",
    t.access ?? "",
    t.maxspeed ?? "",
    t.lanes ?? "",
    t["vehicle:conditional"] ?? "",
    t["hgv:conditional"] ?? "",
    t["motor_vehicle:conditional"] ?? "",
    t.destination ?? "",
    t["oneway:bus"] ?? "",
  ].filter(Boolean);
  return parts.join(" ");
}

/** Max penalty multiplier so effective edge length is at most 1.5x. */
const MAX_PENALTY = 0.5;

/**
 * Parse Extract model JSON output into wayId -> penalty map.
 * Exported for tests; used by getEdgePenaltiesFromLeap.
 */
export function parseScoresFromExtractOutput(raw: string): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const parsed = JSON.parse(raw) as {
      scores?: Array<{ wayId: string; problematic?: number }>;
    };
    const scores = parsed?.scores ?? [];
    for (const entry of scores) {
      const wayId = entry?.wayId;
      const problematic = entry?.problematic;
      if (wayId && typeof problematic === "number" && problematic > 0) {
        map.set(wayId, Math.min(MAX_PENALTY, problematic));
      }
    }
  } catch {
    // Malformed JSON: return empty map so optimizer runs without ML bias
  }
  return map;
}

/**
 * Call Mistral API to get per-way "problematic" scores.
 * Used on web/Android where LEAP SDK is not available.
 * Returns empty map if Mistral API key is not configured or call fails.
 */
async function getEdgePenaltiesFromMistral(
  ways: Way[],
  weatherContext?: string | null
): Promise<Map<string, number>> {
  const apiKey = await getMistralApiKey();
  if (!apiKey || ways.length === 0) {
    return new Map();
  }

  const slice = ways.slice(0, MAX_WAYS_TO_SEND);
  let input = slice.map((w) => waySummary(w)).join("\n");
  if (weatherContext && weatherContext.trim()) {
    input = `[Weather context for route area: ${weatherContext.trim()}]\n\n${input}`;
  }

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "system",
            content: `You are a street quality analyzer for waste collection route optimization. Given a list of street segments (wayId, highway type, width, surface, access restrictions, etc.), score how problematic each is for a large collection vehicle. ${EXTRACT_SCHEMA_HINT}`,
          },
          { role: "user", content: input },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn("[route-ml-enhancement] Mistral API error:", response.status);
      }
      return new Map();
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return new Map();

    // Strip markdown code fences if Mistral wraps in ```json ... ```
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return parseScoresFromExtractOutput(cleaned);
  } catch (e) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.warn("[route-ml-enhancement] Mistral fallback failed:", e);
    }
    return new Map();
  }
}

/**
 * Call ML model to get per-way "problematic" scores
 * (narrow streets, time-restricted zones, etc.). Returns a map wayId -> penalty
 * multiplier (0 = no penalty, up to ~0.5 so effective length is at most 1.5x).
 *
 * NOTE: Leap SDK module removed - now uses Mistral API fallback on all platforms.
 * If Mistral fails, returns an empty map so the optimizer runs without ML bias.
 *
 * When weatherContext is provided (e.g. "Current area: rain, visibility 5km"), the model
 * can bias scores for weather-sensitive segments.
 */
export async function getEdgePenaltiesFromLeap(
  ways: Way[],
  weatherContext?: string | null
): Promise<Map<string, number>> {
  if (ways.length === 0) {
    return new Map();
  }

  // Leap SDK removed - use Mistral API fallback on all platforms
  return getEdgePenaltiesFromMistral(ways, weatherContext);
}
