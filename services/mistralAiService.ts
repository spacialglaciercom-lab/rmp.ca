/**
 * Mistral AI Service - integrates with Mistral API for advanced route analysis
 * Uses Mistral's state-of-the-art language models for intelligent route optimization
 */

import { getMistralApiKey } from "@/lib/mistral-api-key";
import type { CurrentWeather } from "@/services/weatherService";
import type {
  RouteStats,
  AIRouteAnalysis,
} from "@/services/weatherAiRouteAnalysis";

interface MistralApiResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface CacheEntry {
  result: AIRouteAnalysis;
  timestamp: number;
}

// In-memory cache with 10-minute TTL
const CACHE_TTL_MS = 10 * 60 * 1000;
const analysisCache = new Map<string, CacheEntry>();
let isAnalyzing = false;

/**
 * Generate a cache key by combining route signature and weather hash
 */
function generateCacheKey(
  routeStats: RouteStats,
  weatherData: CurrentWeather,
): string {
  // Route signature: hash of segment count + total distance + vehicle type
  const routeSignature = `${routeStats.segmentCount}-${routeStats.totalDistanceMiles.toFixed(1)}-${routeStats.vehicleType}`;

  // Weather hash: rounded values to avoid unnecessary cache misses
  const tempRounded = Math.round(weatherData.temp / 5) * 5; // Nearest 5°F equivalent
  const windRounded = Math.round(weatherData.windSpeed * 2.237 * 5) / 5; // Convert m/s to mph, round to nearest 5
  const precipRounded = Math.round((weatherData.rain1h ?? 0) * 10) / 10; // Nearest 0.1"

  const weatherHash = `${tempRounded}-${windRounded}-${precipRounded}`;

  return `${routeSignature}|${weatherHash}`;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Call Mistral API with the given prompt
 */
async function callMistralApi(
  prompt: string,
  systemMessage: string,
): Promise<string | null> {
  const apiKey = await getMistralApiKey();

  if (!apiKey) {
    console.warn("Mistral API key not configured");
    return null;
  }

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Mistral API error:", response.status, errorData);
      return null;
    }

    const data: MistralApiResponse = await response.json();
    return data.choices[0]?.message?.content || null;
  } catch (error) {
    console.error("Mistral API call failed:", error);
    return null;
  }
}

/**
 * Mistral AI route analysis method
 * Calls Mistral API for intelligent route optimization recommendations
 */
export async function analyzeRouteWithMistral(
  weatherData: CurrentWeather,
  routeStats: RouteStats,
): Promise<AIRouteAnalysis | null> {
  // Prevent simultaneous analysis calls
  if (isAnalyzing) {
    return null;
  }

  try {
    isAnalyzing = true;

    // Generate cache key and check for existing valid entry
    const cacheKey = generateCacheKey(routeStats, weatherData);
    const cachedEntry = analysisCache.get(cacheKey);

    if (cachedEntry && isCacheValid(cachedEntry)) {
      return cachedEntry.result;
    }

    // System prompt for the AI model
    const systemPrompt = `You are a municipal route optimization analyst for solid waste collection vehicles. Analyze the provided route statistics and current weather conditions. Account for: vehicle physics constraints (wide turning radius, frequent stops, hydraulic arm operation time), per-stop dwell times adjusted for weather (increased dwell in rain/snow/ice), speed reductions due to precipitation/visibility/wind, and cumulative fatigue effects on longer routes. Return ONLY valid JSON, no markdown, no explanation.`;

    // User prompt with weather and route data
    const userPrompt = JSON.stringify(
      {
        weatherData: {
          temperature: weatherData.temp,
          precipitation: weatherData.rain1h ?? 0,
          snow: weatherData.snow1h ?? 0,
          windSpeed: weatherData.windSpeed,
          windDirection: weatherData.windDeg,
          visibility: weatherData.visibility,
          condition: weatherData.condition.main,
          roadConditions: weatherData.condition.description,
        },
        routeStats: {
          totalDistanceMiles: routeStats.totalDistanceMiles,
          segmentCount: routeStats.segmentCount,
          turnBreakdown: routeStats.turnBreakdown,
          vehicleType: routeStats.vehicleType,
          estimatedStops: routeStats.estimatedStops,
        },
      },
      null,
      2,
    );

    // Expected response schema instruction
    const schemaHint = `Return JSON with exactly these fields: averageSpeedMph (number), totalEstimatedTimeMinutes (number), confidenceScore (number 0.0-1.0), weatherImpactSeverity ("none" | "low" | "moderate" | "high"), reasoning (string 1-2 sentences max).`;

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}\n\n${schemaHint}`;

    // Call Mistral API with 15-second timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Mistral AI analysis timeout")), 15000),
    );

    const aiResponsePromise = callMistralApi(userPrompt, systemPrompt);

    const rawResponse = await Promise.race([aiResponsePromise, timeoutPromise]);

    if (!rawResponse) {
      return null;
    }

    // Parse and validate response
    let parsedResponse: AIRouteAnalysis;
    try {
      parsedResponse = JSON.parse(rawResponse) as AIRouteAnalysis;

      // Validate required fields and types
      if (
        typeof parsedResponse.averageSpeedMph !== "number" ||
        typeof parsedResponse.totalEstimatedTimeMinutes !== "number" ||
        typeof parsedResponse.confidenceScore !== "number" ||
        !["none", "low", "moderate", "high"].includes(
          parsedResponse.weatherImpactSeverity,
        ) ||
        typeof parsedResponse.reasoning !== "string"
      ) {
        throw new Error("Invalid response schema");
      }

      // Validate confidence score range
      if (
        parsedResponse.confidenceScore < 0 ||
        parsedResponse.confidenceScore > 1
      ) {
        throw new Error("Invalid confidence score range");
      }
    } catch (parseError) {
      console.error("Failed to parse Mistral AI response:", parseError);
      console.error("Raw response:", rawResponse);
      return null;
    }

    // Store result in cache
    analysisCache.set(cacheKey, {
      result: parsedResponse,
      timestamp: Date.now(),
    });

    return parsedResponse;
  } catch (error) {
    console.error("Mistral AI route analysis failed:", error);
    return null;
  } finally {
    isAnalyzing = false;
  }
}

/**
 * Clear the analysis cache (useful for testing or memory management)
 */
export function clearMistralAnalysisCache(): void {
  analysisCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getMistralCacheStats(): {
  size: number;
  entries: Array<{ key: string; age: number }>;
} {
  const now = Date.now();
  const entries = Array.from(analysisCache.entries()).map(([key, entry]) => ({
    key,
    age: now - entry.timestamp,
  }));

  return {
    size: analysisCache.size,
    entries,
  };
}

/**
 * Check if Mistral API is available (key configured)
 */
export async function isMistralAvailable(): Promise<boolean> {
  const apiKey = await getMistralApiKey();
  return !!apiKey;
}
