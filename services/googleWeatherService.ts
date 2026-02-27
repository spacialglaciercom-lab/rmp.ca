/**
 * Google Weather API (v1) — same API key as Google Maps (getGoogleMapsApiKey).
 * Endpoints queried by latitude/longitude:
 * - Current Conditions, Hourly Forecast (up to 240h), Daily Forecast (up to 10 days),
 *   Hourly History (up to 24h), Weather Alerts (publicAlerts).
 * Enable "Weather API" in Google Cloud Console for the project that has the Maps key.
 */

import { getGoogleMapsApiKey } from "@/lib/google-maps-config";

const BASE = "https://weather.googleapis.com/v1";

function buildParams(lat: number, lon: number, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    "location.latitude": String(lat),
    "location.longitude": String(lon),
    ...extra,
  });
  return params.toString();
}

async function fetchWithKey(path: string, params: string): Promise<Response> {
  const key = await getGoogleMapsApiKey();
  if (!key) throw new Error("Google API key not configured");
  const url = `${BASE}${path}?key=${key}&${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Weather API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

// ─── Response types (minimal for UI) ───────────────────────────────────────

export interface GoogleWeatherCondition {
  description?: { text?: string };
  type?: string;
  iconBaseUri?: string;
}

export interface GoogleTemperature {
  degrees?: number;
  unit?: string;
}

export interface GoogleWind {
  speed?: { value?: number; unit?: string };
  gust?: { value?: number; unit?: string };
  direction?: { degrees?: number; cardinal?: string };
}

export interface GoogleCurrentConditions {
  currentTime?: string;
  timeZone?: { id?: string };
  isDaytime?: boolean;
  weatherCondition?: GoogleWeatherCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  relativeHumidity?: number;
  uvIndex?: number;
  precipitation?: {
    probability?: { percent?: number; type?: string };
    qpf?: { quantity?: number; unit?: string };
  };
  airPressure?: { meanSeaLevelMillibars?: number };
  wind?: GoogleWind;
  visibility?: { distance?: number; unit?: string };
  cloudCover?: number;
  currentConditionsHistory?: {
    maxTemperature?: GoogleTemperature;
    minTemperature?: GoogleTemperature;
    temperatureChange?: GoogleTemperature;
    qpf?: { quantity?: number; unit?: string };
  };
}

export interface GoogleForecastHour {
  interval?: { startTime?: string; endTime?: string };
  displayDateTime?: { year?: number; month?: number; day?: number; hours?: number; utcOffset?: string };
  weatherCondition?: GoogleWeatherCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  relativeHumidity?: number;
  precipitation?: { probability?: { percent?: number; type?: string }; qpf?: { quantity?: number; unit?: string } };
  wind?: GoogleWind;
  isDaytime?: boolean;
  cloudCover?: number;
}

export interface GoogleForecastDay {
  interval?: { startTime?: string; endTime?: string };
  displayDate?: { year?: number; month?: number; day?: number };
  daytimeForecast?: { weatherCondition?: GoogleWeatherCondition; precipitation?: { probability?: { percent?: number }; qpf?: { quantity?: number } }; wind?: GoogleWind; cloudCover?: number };
  nighttimeForecast?: { weatherCondition?: GoogleWeatherCondition; precipitation?: { probability?: { percent?: number }; qpf?: { quantity?: number } }; wind?: GoogleWind; cloudCover?: number };
  maxTemperature?: GoogleTemperature;
  minTemperature?: GoogleTemperature;
  feelsLikeMaxTemperature?: GoogleTemperature;
  feelsLikeMinTemperature?: GoogleTemperature;
  sunEvents?: { sunriseTime?: string; sunsetTime?: string };
  moonEvents?: { moonPhase?: string };
}

export interface GoogleHistoryHour {
  interval?: { startTime?: string; endTime?: string };
  displayDateTime?: { year?: number; month?: number; day?: number; hours?: number };
  weatherCondition?: GoogleWeatherCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  precipitation?: { probability?: { percent?: number }; qpf?: { quantity?: number } };
  wind?: GoogleWind;
  isDaytime?: boolean;
  cloudCover?: number;
}

export interface GoogleWeatherAlert {
  alertId?: string;
  title?: string;
  eventType?: string;
  severity?: string;
  certainty?: string;
  urgency?: string;
  onsetTime?: string;
  expirationTime?: string;
  summary?: string;
  instruction?: string;
  source?: string;
  affectedAreas?: Array<{ name?: string }>;
}

// ─── API calls ─────────────────────────────────────────────────────────────

/** Current conditions — real-time weather for a location. */
export async function getGoogleCurrentConditions(lat: number, lon: number): Promise<GoogleCurrentConditions | null> {
  try {
    const params = buildParams(lat, lon);
    const res = await fetchWithKey("/currentConditions:lookup", params);
    return (await res.json()) as GoogleCurrentConditions;
  } catch {
    return null;
  }
}

/** Hourly forecast — up to 240 hours (10 days). Default 48 hours for home UI. */
export async function getGoogleHourlyForecast(
  lat: number,
  lon: number,
  hours: number = 48
): Promise<{ forecastHours?: GoogleForecastHour[]; timeZone?: { id?: string } } | null> {
  try {
    const params = buildParams(lat, lon, { hours: String(Math.min(240, Math.max(1, hours))) });
    const res = await fetchWithKey("/forecast/hours:lookup", params);
    return (await res.json()) as { forecastHours?: GoogleForecastHour[]; timeZone?: { id?: string } };
  } catch {
    return null;
  }
}

/** Daily forecast — up to 10 days (daytime + nighttime breakdowns). */
export async function getGoogleDailyForecast(
  lat: number,
  lon: number,
  days: number = 10
): Promise<{ forecastDays?: GoogleForecastDay[]; timeZone?: { id?: string } } | null> {
  try {
    const params = buildParams(lat, lon, { days: String(Math.min(10, Math.max(1, days))) });
    const res = await fetchWithKey("/forecast/days:lookup", params);
    return (await res.json()) as { forecastDays?: GoogleForecastDay[]; timeZone?: { id?: string } };
  } catch {
    return null;
  }
}

/** Hourly history — up to 24 hours of historical data. */
export async function getGoogleHourlyHistory(
  lat: number,
  lon: number,
  hours: number = 24
): Promise<{ historyHours?: GoogleHistoryHour[]; timeZone?: { id?: string } } | null> {
  try {
    const params = buildParams(lat, lon, { hours: String(Math.min(24, Math.max(1, hours))) });
    const res = await fetchWithKey("/history/hours:lookup", params);
    return (await res.json()) as { historyHours?: GoogleHistoryHour[]; timeZone?: { id?: string } };
  } catch {
    return null;
  }
}

/** Weather alerts — real-time severe weather events (publicAlerts). */
export async function getGoogleWeatherAlerts(lat: number, lon: number): Promise<GoogleWeatherAlert[]> {
  try {
    const params = buildParams(lat, lon, { languageCode: "en" });
    const res = await fetchWithKey("/publicAlerts:lookup", params);
    const data = (await res.json()) as { publicAlerts?: GoogleWeatherAlert[] };
    return data?.publicAlerts ?? [];
  } catch {
    return [];
  }
}

/** Whether Google Weather can be used (same key as Maps). */
export async function isGoogleWeatherConfigured(): Promise<boolean> {
  const key = await getGoogleMapsApiKey();
  return (key?.trim().length ?? 0) > 0;
}
