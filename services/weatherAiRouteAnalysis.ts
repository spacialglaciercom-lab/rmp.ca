/**
 * Weather-aware AI route analysis using Liquid Leap AI SDK (LFM2 model).
 * Provides intelligent route optimization recommendations based on weather conditions
 * and route statistics with caching to avoid redundant AI calls.
 */

import { Platform } from "react-native";
import type { CurrentWeather } from "@/services/weatherService";
import { analyzeRouteWithMistral } from "@/services/mistralAiService";

export interface RouteStats {
  totalDistanceMiles: number;
  segmentCount: number;
  turnBreakdown: {
    left: number;
    right: number;
    uTurn: number;
  };
  vehicleType: string;
  estimatedStops: number;
}

export interface AIRouteAnalysis {
  averageSpeedMph: number;
  totalEstimatedTimeMinutes: number;
  confidenceScore: number;
  weatherImpactSeverity: "none" | "low" | "moderate" | "high";
  reasoning: string;
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
function generateCacheKey(routeStats: RouteStats, weatherData: CurrentWeather): string {
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
 * Weather-aware AI route analysis method
 * Calls Liquid Leap AI SDK with LFM2 model for intelligent route optimization
 */
export async function analyzeRouteWithWeather(
  weatherData: CurrentWeather,
  routeStats: RouteStats
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

    // Try Leap SDK first (iOS only), then fall back to Mistral API
    let parsedResponse: AIRouteAnalysis | null = null;

    if (Platform.OS === "ios") {
      parsedResponse = await tryLeapAnalysis(weatherData, routeStats);
    }

    // Fallback to Mistral API when Leap is unavailable (non-iOS) or fails
    if (!parsedResponse) {
      parsedResponse = await analyzeRouteWithMistral(weatherData, routeStats);
    }

    if (!parsedResponse) {
      return null;
    }

    // Store result in cache
    analysisCache.set(cacheKey, {
      result: parsedResponse,
      timestamp: Date.now()
    });

    return parsedResponse;

  } catch (error) {
    console.error("AI route analysis failed:", error);
    return null;
  } finally {
    isAnalyzing = false;
  }
}

/**
 * Try Leap SDK for AI analysis.
 * NOTE: Leap SDK removed - returns null to use Mistral fallback.
 */
async function tryLeapAnalysis(
  weatherData: CurrentWeather,
  routeStats: RouteStats
): Promise<AIRouteAnalysis | null> {
  // Leap SDK removed - return null to use Mistral fallback
  return null;
}

/**
 * Clear the analysis cache (useful for testing or memory management)
 */
export function clearAnalysisCache(): void {
  analysisCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
  const now = Date.now();
  const entries = Array.from(analysisCache.entries()).map(([key, entry]) => ({
    key,
    age: now - entry.timestamp
  }));
  
  return {
    size: analysisCache.size,
    entries
  };
}