/**
 * Unit tests for weatherService.
 *
 * Mocks:
 *  - @react-native-async-storage/async-storage  (in-memory)
 *  - @/lib/weatherCache                          (in-memory cache)
 *  - global fetch                                (sinon-style vi.fn)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory AsyncStorage mock
// ---------------------------------------------------------------------------
const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (k: string) => Promise.resolve(storage.get(k) ?? null),
    setItem: (k: string, v: string) => { storage.set(k, v); return Promise.resolve(); },
    removeItem: (k: string) => { storage.delete(k); return Promise.resolve(); },
    clear: () => { storage.clear(); return Promise.resolve(); },
  },
}));

// ---------------------------------------------------------------------------
// weatherCache mock — controls cache hit/miss
// ---------------------------------------------------------------------------
let cachedWeather: unknown = null;
let lastCached: unknown = null;
vi.mock("@/lib/weatherCache", () => ({
  getWeatherCached: vi.fn(async () => cachedWeather),
  setWeatherCached: vi.fn(async () => {}),
  getLastCachedWeather: vi.fn(async () => lastCached),
  invalidateWeatherCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered
// ---------------------------------------------------------------------------
import {
  getCurrentWeather,
  getWeatherForRoutePoints,
  getHourlyForecast,
  isWeatherConfigured,
  getRemainingCallsEstimate,
  invalidateWeatherCache,
} from "../weatherService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

const SAMPLE_WEATHER_RAW = {
  dt: 1700000000,
  main: { temp: 10, feels_like: 8, pressure: 1013, humidity: 70 },
  wind: { speed: 5, deg: 180 },
  visibility: 9000,
  clouds: { all: 30 },
  weather: [{ id: 800, main: "Clear", description: "clear sky", icon: "01d" }],
};

const SAMPLE_FORECAST_RAW = {
  list: [
    {
      dt: 1700000000,
      main: { temp: 10, feels_like: 8 },
      wind: { speed: 5, deg: 180 },
      visibility: 9000,
      pop: 0.1,
      weather: [{ id: 800, main: "Clear", description: "clear sky", icon: "01d" }],
    },
    {
      dt: 1700003600,
      main: { temp: 12, feels_like: 10 },
      wind: { speed: 3, deg: 90 },
      visibility: 10000,
      pop: 0.0,
      weather: [{ id: 801, main: "Clouds", description: "few clouds", icon: "02d" }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isWeatherConfigured", () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = origEnv;
  });

  it("returns false when env var is absent", () => {
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "" };
    expect(isWeatherConfigured()).toBe(false);
  });

  it("returns true when env var is set", () => {
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key-123" };
    expect(isWeatherConfigured()).toBe(true);
  });
});

describe("getRemainingCallsEstimate", () => {
  it("returns a non-negative number", () => {
    expect(getRemainingCallsEstimate()).toBeGreaterThanOrEqual(0);
  });
});

describe("invalidateWeatherCache", () => {
  it("does not throw", () => {
    expect(() => invalidateWeatherCache()).not.toThrow();
  });
});

describe("getCurrentWeather", () => {
  beforeEach(() => {
    cachedWeather = null;
    lastCached = null;
    storage.clear();
    invalidateWeatherCache();
  });

  it("returns cached value immediately when cache hits", async () => {
    const fakeWeather = { lat: 45.5, lon: -73.5, temp: 10 };
    cachedWeather = fakeWeather;
    const fetchSpy = mockFetch({});
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getCurrentWeather(45.5, -73.5);
    expect(result).toBe(fakeWeather);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("returns null when no API key and no cache", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "" };

    const result = await getCurrentWeather(45.5, -73.5);
    // lastCached is null → should resolve to null
    expect(result).toBeNull();

    process.env = origEnv;
  });

  it("fetches from API when key is present and cache misses", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };

    const fetchSpy = mockFetch(SAMPLE_WEATHER_RAW);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getCurrentWeather(45.5, -73.5);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
    expect(result?.temp).toBe(10);
    expect(result?.condition.main).toBe("Clear");

    process.env = origEnv;
    vi.unstubAllGlobals();
  });

  it("falls back to last cached weather on fetch failure", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };
    const fallback = { lat: 45.5, lon: -73.5, temp: 5 };
    lastCached = fallback;

    // fetchWithRetry retries 3× with exponential backoff — skip real delays
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const promise = getCurrentWeather(45.5, -73.5);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(fallback);

    process.env = origEnv;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("handles missing weather array in API response gracefully", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };

    const raw = { ...SAMPLE_WEATHER_RAW, weather: [] };
    vi.stubGlobal("fetch", mockFetch(raw));

    const result = await getCurrentWeather(45.5, -73.5);
    expect(result?.condition.main).toBe("Unknown");

    process.env = origEnv;
    vi.unstubAllGlobals();
  });
});

describe("getWeatherForRoutePoints", () => {
  beforeEach(() => {
    cachedWeather = null;
    lastCached = null;
    storage.clear();
    invalidateWeatherCache();
  });

  it("returns a map with keys for each unique point", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };
    cachedWeather = { temp: 5 }; // cache always hits → no real fetch

    const points = [
      { lat: 45.5, lon: -73.5 },
      { lat: 45.6, lon: -73.6 },
    ];
    const result = await getWeatherForRoutePoints(points);
    expect(result.size).toBe(2);

    process.env = origEnv;
  });

  it("deduplicates points with the same truncated coordinates", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };
    cachedWeather = { temp: 5 };

    // Both points truncate to same 4-decimal key
    const points = [
      { lat: 45.50001, lon: -73.50001 },
      { lat: 45.50002, lon: -73.50002 },
    ];
    const result = await getWeatherForRoutePoints(points);
    expect(result.size).toBe(1);

    process.env = origEnv;
  });

  it("returns last cached for all points when no API key", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "" };
    const fallback = { temp: 3 };
    lastCached = fallback;

    const points = [{ lat: 45.5, lon: -73.5 }, { lat: 46.0, lon: -74.0 }];
    const result = await getWeatherForRoutePoints(points);
    expect(result.size).toBe(2);
    for (const v of result.values()) {
      expect(v).toBe(fallback);
    }

    process.env = origEnv;
  });
});

describe("getHourlyForecast", () => {
  beforeEach(() => {
    invalidateWeatherCache();
  });

  it("returns empty array when no API key", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "" };
    const result = await getHourlyForecast(45.5, -73.5);
    expect(result).toEqual([]);
    process.env = origEnv;
  });

  it("fetches and parses forecast items", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };
    vi.stubGlobal("fetch", mockFetch(SAMPLE_FORECAST_RAW));

    const result = await getHourlyForecast(45.5, -73.5, 24);
    expect(result).toHaveLength(2);
    expect(result[0]!.temp).toBe(10);
    expect(result[0]!.condition.main).toBe("Clear");
    expect(result[1]!.temp).toBe(12);

    process.env = origEnv;
    vi.unstubAllGlobals();
  });

  it("respects hoursCount limit", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };
    vi.stubGlobal("fetch", mockFetch(SAMPLE_FORECAST_RAW));

    const result = await getHourlyForecast(45.5, -73.5, 1);
    expect(result).toHaveLength(1);

    process.env = origEnv;
    vi.unstubAllGlobals();
  });

  it("returns empty array on fetch error", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };
    // fetchWithRetry retries 3 times with exponential backoff — skip real delays
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const promise = getHourlyForecast(45.5, -73.5);
    // Advance past all retry waits (1s + 2s + 4s = 7s)
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual([]);

    process.env = origEnv;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses in-memory cache on second call (fetch called only once)", async () => {
    const origEnv = process.env;
    process.env = { ...origEnv, EXPO_PUBLIC_OPENWEATHERMAP_API_KEY: "test-key" };
    const fetchSpy = mockFetch(SAMPLE_FORECAST_RAW);
    vi.stubGlobal("fetch", fetchSpy);

    await getHourlyForecast(45.99, -73.99);
    await getHourlyForecast(45.99, -73.99);
    expect(fetchSpy).toHaveBeenCalledOnce();

    process.env = origEnv;
    vi.unstubAllGlobals();
  });
});
