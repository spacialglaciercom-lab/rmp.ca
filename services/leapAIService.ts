/**
 * Leap AI SDK integration for weather-enhanced route optimization.
 * Builds input schema: route, weatherConditions, constraints.
 * Used by weatherAnalysis when useLeap is true.
 *
 * The original on-device Leap SDK is unavailable; recommendations are now
 * generated via Gemini 2.0 Flash (same Firebase AI setup used for constraint
 * parsing) so the feature works on iOS, Android, and web.
 */

import type {
  RouteData,
  WeatherData,
  WeatherConstraints,
} from "@/types/weather";
import { DEFAULT_WEATHER_CONSTRAINTS } from "@/types/weather";
import { createLazyGeminiModel } from "@/lib/firebase/ai";

const LEAP_SCHEMA_HINT = `You are a route and weather analyst. Input is a JSON object with:
- route: { points, totalDistanceKm, estimatedTotalMinutes, segmentCount }
- weatherConditions: array of { lat, lon, temp, visibility, windSpeed, condition.main, rain1h, snow1h }
- constraints: { maxWindSpeed (m/s), minVisibility (m), maxPrecipitationRate (mm/h) }

Return a JSON object with exactly: "recommendations" (array of strings).
Each string is one short, actionable recommendation for the driver.
Consider: segments exceeding wind/visibility/precip limits, reordering stops to avoid bad weather, delaying start.
Examples: "Delay start by 2 hours to avoid morning rain.", "Reorder stops 5-8 due to incoming rain.", "Segment 3 exceeds max wind; allow extra time."
Return only valid JSON, no markdown. If no action needed: {"recommendations": []}.`;

export interface LeapWeatherInput {
  route: RouteData;
  weatherConditions: WeatherData[];
  constraints: WeatherConstraints;
}

// ── Lazy-loaded Gemini model using shared factory ──────────────────────────

const leapModel = createLazyGeminiModel({
  systemInstruction: LEAP_SCHEMA_HINT,
  maxOutputTokens: 512,
});

const getModel = leapModel.getModel;

/** Reset the cached model (e.g. to recover from transient initialization failures). */
export const resetLeapAIModel = leapModel.resetModel;

/**
 * Call Gemini with route + weather + constraints. Returns recommendations array.
 * Falls back to empty array on error so rule-based fallback in weatherAnalysis kicks in.
 */
export async function getLeapWeatherRecommendations(
  input: LeapWeatherInput,
): Promise<string[]> {
  try {
    const model = await getModel();
    const result = await model.generateContent(JSON.stringify(input));
    const text = result.response.text();
    const parsed = JSON.parse(text) as { recommendations?: unknown };
    if (Array.isArray(parsed.recommendations)) {
      return parsed.recommendations.filter((r): r is string => typeof r === "string");
    }
    return [];
  } catch (e) {
    if (__DEV__) {
      console.warn("[LeapAI] Gemini weather recommendations failed:", e);
    }
    return [];
  }
}

/**
 * Build Leap input from route points and weather map.
 */
export function buildLeapWeatherInput(
  points: Array<{ lat: number; lon: number }>,
  estimatedTotalMinutes: number,
  totalDistanceKm: number,
  weatherByPoint: Map<string, WeatherData | null>,
  constraints: Partial<WeatherConstraints> = {},
): LeapWeatherInput {
  const weatherConditions: WeatherData[] = [];
  for (const p of points) {
    const k = `${p.lat.toFixed(4)}_${p.lon.toFixed(4)}`;
    const w = weatherByPoint.get(k) ?? null;
    if (w) weatherConditions.push(w);
  }
  const segCount = Math.max(0, points.length - 1);
  const route: RouteData = {
    points: points.map((p, i) => ({
      lat: p.lat,
      lon: p.lon,
      estimatedMinutes:
        segCount > 0 ? (estimatedTotalMinutes / segCount) * i : 0,
    })),
    totalDistanceKm,
    estimatedTotalMinutes,
    segmentCount: segCount,
  };
  return {
    route,
    weatherConditions,
    constraints: { ...DEFAULT_WEATHER_CONSTRAINTS, ...constraints },
  };
}
