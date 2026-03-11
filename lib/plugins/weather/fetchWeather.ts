/**
 * Unified weather data provider for the weather plugin.
 * Prefers Google Weather API (same key as Maps); falls back to OpenWeatherMap.
 * Uses existing cache (AsyncStorage + in-memory) via weatherService / googleWeatherService.
 */

import {
  getGoogleCurrentConditions,
  isGoogleWeatherConfigured,
} from "@/services/googleWeatherService";
import { getCurrentWeather } from "@/services/weatherService";
import type { GoogleCurrentConditions } from "@/services/googleWeatherService";
import type { CurrentWeather } from "@/services/weatherService";

export type WeatherDataResult =
  | { source: "google"; data: GoogleCurrentConditions }
  | { source: "openweather"; data: CurrentWeather }
  | null;

/**
 * Fetch current weather for (lat, lon). Uses Google first, then OpenWeather.
 * Caching and offline behavior are handled by the underlying services.
 */
export async function fetchWeather(
  lat: number,
  lon: number,
): Promise<WeatherDataResult> {
  try {
    const useGoogle = await isGoogleWeatherConfigured();
    if (useGoogle) {
      const data = await getGoogleCurrentConditions(lat, lon);
      if (data) return { source: "google", data };
    }
    const openWeather = await getCurrentWeather(lat, lon);
    if (openWeather) return { source: "openweather", data: openWeather };
  } catch {
    // Offline or API error; underlying services may return cached data
  }
  return null;
}
