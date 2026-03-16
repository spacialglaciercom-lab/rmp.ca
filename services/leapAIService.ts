/**
 * Leap AI SDK integration for weather-enhanced route optimization.
 * Builds input schema: route, weatherConditions, constraints.
 * Used by weatherAnalysis when useLeap is true.
 *
 * The original on-device Leap SDK is unavailable; recommendations are now
 * generated via Gemini 2.0 Flash (same Firebase AI setup used for constraint
 * parsing) so the feature works on iOS, Android, and web.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";
import type {
  RouteData,
  WeatherData,
  WeatherConstraints,
} from "@/types/weather";
import { DEFAULT_WEATHER_CONSTRAINTS } from "@/types/weather";

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

// ── Lazy-loaded Gemini model (same pattern as lib/firebase/ai.ts) ──────────

let _modelPromise: Promise<{
  generateContent: (
    prompt: string,
  ) => Promise<{ response: { text: () => string } }>;
}> | null = null;

function getModel() {
  if (_modelPromise) return _modelPromise;

  _modelPromise = (async () => {
    const isExpoGo = Constants.appOwnership === "expo";

    if (Platform.OS !== "web" && !isExpoGo) {
      try {
        const {
          getAI,
          getGenerativeModel,
          GoogleAIBackend,
        } = require("@react-native-firebase/ai");
        const ai = getAI(undefined, { backend: new GoogleAIBackend() });
        return getGenerativeModel(ai, {
          model: "gemini-2.0-flash",
          systemInstruction: LEAP_SCHEMA_HINT,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
          },
        });
      } catch (e) {
        console.warn(
          "[LeapAI] Native firebase/ai not available, trying JS SDK:",
          (e as Error).message,
        );
      }
    }

    // Web / Expo Go fallback: use firebase JS SDK
    const {
      initializeApp,
      getApps,
    } = require("firebase/app");
    const {
      getAI: getAIWeb,
      getGenerativeModel: getGenModelWeb,
      GoogleAIBackend: GoogleAIBackendWeb,
    } = require("firebase/ai");

    let app;
    const existingApps = getApps();
    const aiApp = existingApps.find(
      (a: { name: string }) => a.name === "trashroute-ai",
    );
    if (aiApp) {
      app = aiApp;
    } else {
      app = initializeApp(
        {
          apiKey: process.env.EXPO_PUBLIC_FIREBASE_AI_API_KEY || "",
          projectId: "trashroutemobile",
          appId: "1:970176642480:web:placeholder",
        },
        "trashroute-ai",
      );
    }

    const ai = getAIWeb(app, { backend: new GoogleAIBackendWeb() });
    return getGenModelWeb(ai, {
      model: "gemini-2.0-flash",
      systemInstruction: LEAP_SCHEMA_HINT,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    });
  })();

  return _modelPromise;
}

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
