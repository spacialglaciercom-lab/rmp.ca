/**
 * OpenWeatherMap API integration for weather-enhanced route optimization.
 * Caching: AsyncStorage + in-memory, 30-min TTL, 5km spatial clustering.
 * Error handling: retry with exponential backoff; offline uses last cached data.
 */

import {
  getWeatherCached,
  setWeatherCached,
  getLastCachedWeather,
  invalidateWeatherCache as invalidateCache,
} from "@/lib/weatherCache";

const BASE_URL = "https://api.openweathermap.org/data/2.5";
const MAX_CALLS_PER_DAY = 1000;
const BATCH_DELAY_MS = 150;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

function getApiKey(): string {
  const key =
    (typeof process !== "undefined" &&
      process.env?.EXPO_PUBLIC_OPENWEATHERMAP_API_KEY) ||
    "";
  return key.trim();
}

export interface WeatherCondition {
  id: number;
  main: string;
  description: string;
  icon: string;
}

export interface CurrentWeather {
  lat: number;
  lon: number;
  timestamp: number;
  temp: number;
  feelsLike: number;
  pressure: number;
  humidity: number;
  visibility: number;
  windSpeed: number;
  windDeg: number;
  clouds: number;
  condition: WeatherCondition;
  rain1h?: number;
  snow1h?: number;
}

export interface HourlyForecastItem {
  timestamp: number;
  temp: number;
  feelsLike: number;
  pop: number;
  visibility: number;
  windSpeed: number;
  windDeg: number;
  condition: WeatherCondition;
  rain?: number;
  snow?: number;
}

export type WeatherFetchSource = "api" | "cache" | "offline";

const RATE_LIMIT_STORAGE_KEY = "trashroute_weather_rate";

let callsToday = 0;
let lastResetDay = "";
let rateLimitLoaded = false;

function getTodayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function loadRateLimitState(): Promise<void> {
  if (rateLimitLoaded) return;
  try {
    const { default: AsyncStorage } =
      await import("@react-native-async-storage/async-storage");
    const raw = await AsyncStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { day: string; count: number };
      if (parsed.day && typeof parsed.count === "number") {
        lastResetDay = parsed.day;
        callsToday = parsed.count;
      }
    }
  } catch {
    /* first launch or storage unavailable */
  }
  rateLimitLoaded = true;
}

async function persistRateLimitState(): Promise<void> {
  try {
    const { default: AsyncStorage } =
      await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem(
      RATE_LIMIT_STORAGE_KEY,
      JSON.stringify({ day: lastResetDay, count: callsToday }),
    );
  } catch {
    /* best-effort */
  }
}

function ensureRateLimit(): boolean {
  const today = getTodayKey();
  if (today !== lastResetDay) {
    lastResetDay = today;
    callsToday = 0;
  }
  return callsToday < MAX_CALLS_PER_DAY;
}

function recordCall(): void {
  callsToday += 1;
  persistRateLimitState();
}

function parseCurrentWeather(
  raw: Record<string, unknown>,
  lat: number,
  lon: number,
): CurrentWeather {
  const w = raw.weather as Array<{
    id: number;
    main: string;
    description: string;
    icon: string;
  }>;
  const main = raw.main as Record<string, number>;
  const wind = (raw.wind as Record<string, number>) ?? {};
  const rain = raw.rain as Record<string, number> | undefined;
  const snow = raw.snow as Record<string, number> | undefined;
  return {
    lat,
    lon,
    timestamp: (raw.dt as number) ?? 0,
    temp: main?.temp ?? 0,
    feelsLike: main?.feels_like ?? main?.temp ?? 0,
    pressure: main?.pressure ?? 0,
    humidity: main?.humidity ?? 0,
    visibility: (raw.visibility as number) ?? 10000,
    windSpeed: wind?.speed ?? 0,
    windDeg: wind?.deg ?? 0,
    clouds: (raw.clouds as Record<string, number>)?.all ?? 0,
    condition: w?.[0]
      ? {
          id: w[0].id,
          main: w[0].main,
          description: w[0].description,
          icon: w[0].icon,
        }
      : { id: 0, main: "Unknown", description: "", icon: "" },
    rain1h: rain?.["1h"],
    snow1h: snow?.["1h"],
  };
}

function parseForecastItem(raw: Record<string, unknown>): HourlyForecastItem {
  const w = raw.weather as Array<{
    id: number;
    main: string;
    description: string;
    icon: string;
  }>;
  const rain = raw.rain as Record<string, number> | undefined;
  const snow = raw.snow as Record<string, number> | undefined;
  return {
    timestamp: (raw.dt as number) ?? 0,
    temp: (raw.main as Record<string, number>)?.temp ?? 0,
    feelsLike: (raw.main as Record<string, number>)?.feels_like ?? 0,
    pop: (raw.pop as number) ?? 0,
    visibility: (raw.visibility as number) ?? 10000,
    windSpeed: (raw.wind as Record<string, number>)?.speed ?? 0,
    windDeg: (raw.wind as Record<string, number>)?.deg ?? 0,
    condition: w?.[0]
      ? {
          id: w[0].id,
          main: w[0].main,
          description: w[0].description,
          icon: w[0].icon,
        }
      : { id: 0, main: "Unknown", description: "", icon: "" },
    rain: rain?.["3h"],
    snow: snow?.["3h"],
  };
}

function redactUrl(url: string): string {
  return url.replace(/([?&]appid=)[^&]*/gi, "$1[REDACTED]");
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500) break; // no retry for client errors
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = new Error(redactUrl(msg));
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastError ?? new Error("Request failed");
}

/**
 * Fetch current weather for a single location.
 * Uses persistent + in-memory cache (30-min TTL, 5km clustering).
 * On API failure: returns last cached if available (offline support); otherwise null.
 */
export async function getCurrentWeather(
  lat: number,
  lon: number,
): Promise<CurrentWeather | null> {
  await loadRateLimitState();
  const cached = await getWeatherCached(lat, lon);
  if (cached) return cached as CurrentWeather;

  const key = getApiKey();
  if (!key) return getLastCachedWeather() as Promise<CurrentWeather | null>;

  if (!ensureRateLimit()) {
    const last = await getLastCachedWeather();
    return last as CurrentWeather | null;
  }

  try {
    const url = `${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${key}&units=metric`;
    const res = await fetchWithRetry(url);
    recordCall();
    const raw = (await res.json()) as Record<string, unknown>;
    const data = parseCurrentWeather(raw, lat, lon);
    await setWeatherCached(lat, lon, data);
    return data;
  } catch {
    const last = await getLastCachedWeather();
    return last as CurrentWeather | null;
  }
}

/**
 * Fetch current weather for multiple route points.
 * Uses cache (and 5km clustering) per point; batches with delay. Graceful degradation on failure.
 */
export async function getWeatherForRoutePoints(
  points: Array<{ lat: number; lon: number }>,
): Promise<Map<string, CurrentWeather | null>> {
  const result = new Map<string, CurrentWeather | null>();
  const key = getApiKey();
  if (!key && points.length > 0) {
    const last = await getLastCachedWeather();
    const v = last as CurrentWeather | null;
    for (const p of points) {
      result.set(`${p.lat.toFixed(4)}_${p.lon.toFixed(4)}`, v);
    }
    return result;
  }

  const uniq = new Map<string, { lat: number; lon: number }>();
  for (const p of points) {
    const k = `${p.lat.toFixed(4)}_${p.lon.toFixed(4)}`;
    if (!uniq.has(k)) uniq.set(k, p);
  }

  const keys = [...uniq.keys()];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const p = uniq.get(k)!;
    const w = await getCurrentWeather(p.lat, p.lon);
    result.set(k, w);
    if (i < keys.length - 1) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
  return result;
}

/** In-memory forecast cache (30-min); no AsyncStorage for forecast to keep size down. */
const forecastMemory = new Map<
  string,
  { data: HourlyForecastItem[]; fetchedAt: number }
>();
const FORECAST_TTL_MS = 30 * 60 * 1000;

function forecastCacheKey(lat: number, lon: number): string {
  return `fc_${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

/**
 * Get hourly forecast. Uses in-memory cache only. On failure returns [] (graceful degradation).
 */
export async function getHourlyForecast(
  lat: number,
  lon: number,
  hoursCount: number = 24,
): Promise<HourlyForecastItem[]> {
  await loadRateLimitState();
  const ck = forecastCacheKey(lat, lon);
  const cached = forecastMemory.get(ck);
  if (cached && Date.now() - cached.fetchedAt < FORECAST_TTL_MS) {
    return cached.data.slice(0, Math.min(hoursCount, cached.data.length));
  }

  const apiKey = getApiKey();
  if (!apiKey) return [];

  if (!ensureRateLimit()) return [];

  try {
    const url = `${BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const res = await fetchWithRetry(url);
    recordCall();
    if (!res.ok) return [];
    const raw = (await res.json()) as { list?: Record<string, unknown>[] };
    const list = (raw.list ?? []).map(parseForecastItem);
    forecastMemory.set(ck, { data: list, fetchedAt: Date.now() });
    return list.slice(0, Math.min(hoursCount, list.length));
  } catch {
    return [];
  }
}

export function isWeatherConfigured(): boolean {
  return getApiKey().length > 0;
}

export function getRemainingCallsEstimate(): number {
  ensureRateLimit();
  return Math.max(0, MAX_CALLS_PER_DAY - callsToday);
}

export function invalidateWeatherCache(): void {
  invalidateCache();
  forecastMemory.clear();
}
