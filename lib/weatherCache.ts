/**
 * Weather cache: AsyncStorage for persistence, in-memory for session.
 * Key format: weather_${lat}_${lng}_${hour}
 * TTL: 30 minutes. Spatial clustering: reuse data for points within 5km.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WeatherData } from "@/types/weather";

const CACHE_PREFIX = "weather_";
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLUSTER_RADIUS_KM = 5;
const MAX_PERSISTED_KEYS = 200; // trim old keys if over

export interface WeatherCacheEntry {
  data: WeatherData;
  fetchedAt: number;
  lat: number;
  lon: number;
}

const MAX_MEMORY_CACHE_SIZE = 100;
const memoryCache = new Map<string, WeatherCacheEntry>();

/** Evict oldest entries when the in-memory cache exceeds MAX_MEMORY_CACHE_SIZE. */
function evictMemoryCache(): void {
  if (memoryCache.size <= MAX_MEMORY_CACHE_SIZE) return;
  const entries = Array.from(memoryCache.entries()).sort(
    ([, a], [, b]) => a.fetchedAt - b.fetchedAt,
  );
  const toRemove = entries.length - MAX_MEMORY_CACHE_SIZE;
  for (let i = 0; i < toRemove; i++) {
    memoryCache.delete(entries[i]![0]);
  }
}

/** Haversine distance in km */
function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function currentHourUtc(): number {
  const d = new Date();
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
  );
}

export function weatherCacheKey(
  lat: number,
  lon: number,
  hour?: number,
): string {
  const h = hour ?? currentHourUtc();
  return `${CACHE_PREFIX}${lat.toFixed(4)}_${lon.toFixed(4)}_${h}`;
}

function isFresh(entry: WeatherCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < TTL_MS;
}

/** Find a cached entry within 5km of (lat, lon) that is still fresh. */
function findWithinCluster(lat: number, lon: number): WeatherCacheEntry | null {
  for (const entry of memoryCache.values()) {
    if (!isFresh(entry)) continue;
    if (distanceKm(lat, lon, entry.lat, entry.lon) <= CLUSTER_RADIUS_KM) {
      return entry;
    }
  }
  return null;
}

/**
 * Get cached weather for (lat, lon). Checks exact key then spatial cluster (5km).
 * Returns null if none fresh.
 */
export async function getWeatherCached(
  lat: number,
  lon: number,
): Promise<WeatherData | null> {
  const hour = currentHourUtc();
  const key = weatherCacheKey(lat, lon, hour);

  const fromMemory = memoryCache.get(key);
  if (fromMemory && isFresh(fromMemory)) return fromMemory.data;

  const fromCluster = findWithinCluster(lat, lon);
  if (fromCluster) return fromCluster.data;

  if (typeof AsyncStorage !== "undefined") {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const entry = JSON.parse(raw) as WeatherCacheEntry;
        if (isFresh(entry)) {
          memoryCache.set(key, entry);
          return entry.data;
        }
      }
      const allKeys = await AsyncStorage.getAllKeys();
      const weatherKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
      for (const k of weatherKeys) {
        const stored = await AsyncStorage.getItem(k);
        if (!stored) continue;
        const entry = JSON.parse(stored) as WeatherCacheEntry;
        if (
          isFresh(entry) &&
          distanceKm(lat, lon, entry.lat, entry.lon) <= CLUSTER_RADIUS_KM
        ) {
          memoryCache.set(key, { ...entry, lat, lon });
          evictMemoryCache();
          return entry.data;
        }
      }
    } catch {
      // Offline or parse error
    }
  }
  return null;
}

/**
 * Set cached weather for (lat, lon). Key includes current hour; TTL 30 min.
 */
export async function setWeatherCached(
  lat: number,
  lon: number,
  data: WeatherData,
): Promise<void> {
  const hour = currentHourUtc();
  const key = weatherCacheKey(lat, lon, hour);
  const entry: WeatherCacheEntry = {
    data: { ...data, lat, lon },
    fetchedAt: Date.now(),
    lat,
    lon,
  };
  memoryCache.set(key, entry);
  evictMemoryCache();
  if (typeof AsyncStorage !== "undefined") {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(entry));
      const keys = await AsyncStorage.getAllKeys();
      const weatherKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
      if (weatherKeys.length > MAX_PERSISTED_KEYS) {
        // Sort by the hour timestamp suffix (oldest first) before trimming
        weatherKeys.sort();
        const toRemove = weatherKeys.slice(
          0,
          weatherKeys.length - MAX_PERSISTED_KEYS,
        );
        await AsyncStorage.multiRemove(toRemove);
      }
    } catch {
      // Ignore persistence errors
    }
  }
}

/** Invalidate all cached weather (e.g. on "Refresh weather"). */
export function invalidateWeatherCache(): void {
  memoryCache.clear();
  if (typeof AsyncStorage !== "undefined") {
    AsyncStorage.getAllKeys().then((keys) => {
      const weatherKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
      if (weatherKeys.length > 0) AsyncStorage.multiRemove(weatherKeys);
    });
  }
}

/** Clear weather cache and wait for AsyncStorage to finish (e.g. Settings "Clear Cache"). */
export async function clearWeatherCacheAsync(): Promise<void> {
  memoryCache.clear();
  if (typeof AsyncStorage !== "undefined") {
    const keys = await AsyncStorage.getAllKeys();
    const weatherKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (weatherKeys.length > 0) await AsyncStorage.multiRemove(weatherKeys);
  }
}

/** Get last cached entry for any location (for offline fallback). */
export async function getLastCachedWeather(): Promise<WeatherData | null> {
  for (const entry of memoryCache.values()) {
    return entry.data;
  }
  if (typeof AsyncStorage !== "undefined") {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const weatherKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
      let latest: WeatherCacheEntry | null = null;
      for (const k of weatherKeys) {
        const raw = await AsyncStorage.getItem(k);
        if (!raw) continue;
        const entry = JSON.parse(raw) as WeatherCacheEntry;
        if (!latest || entry.fetchedAt > latest.fetchedAt) latest = entry;
      }
      return latest?.data ?? null;
    } catch {
      //
    }
  }
  return null;
}
