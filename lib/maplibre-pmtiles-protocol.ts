/**
 * PMTiles custom protocol for MapLibre React Native.
 * Supports remote (pmtiles://https://...) and local (pmtiles://local-{cityId}/) so R2 works offline when downloaded.
 *
 * Memory optimization:
 * - LRU cache with max entries to prevent unbounded memory growth
 * - Lazy loading: PMTiles instances are created on first tile request
 * - Chunked base64 decoding for large files to reduce peak memory
 */

import { Platform } from "react-native";

let registered = false;
const localPaths = new Map<string, string>();

/** Max number of local PMTiles instances to keep in memory. */
const MAX_LOCAL_CACHE_ENTRIES = 3;

/** Max number of remote PMTiles instances to keep in memory. */
const MAX_REMOTE_CACHE_ENTRIES = 5;

/** Track access order for LRU eviction. */
interface CacheEntry<T> {
  instance: T;
  lastAccessed: number;
}

function getMapLibre(): any {
  if (Platform.OS === "web") return null;
  try {
    return require("@maplibre/maplibre-react-native").default;
  } catch {
    return null;
  }
}

/**
 * Register a local PMTiles file path for a city so that requests to
 * pmtiles://local-{cityId}/z/x/y are served from that file.
 */
export function registerLocalPmtilesPath(cityId: string, localPath: string): void {
  localPaths.set(`local-${cityId}`, localPath);
}

export function unregisterLocalPmtilesPath(cityId: string): void {
  localPaths.delete(`local-${cityId}`);
}

/**
 * Clear all cached PMTiles instances to free memory.
 * Call when the app goes to background or when memory pressure is detected.
 */
export function clearPmtilesCache(): void {
  if (typeof _localCache !== "undefined") _localCache.clear();
  if (typeof _remoteCache !== "undefined") _remoteCache.clear();
}

let _localCache: Map<string, CacheEntry<any>> | null = null;
let _remoteCache: Map<string, CacheEntry<any>> | null = null;

/**
 * Evict least recently used entries from cache if over limit.
 */
function evictLRU<T>(cache: Map<string, CacheEntry<T>>, maxEntries: number): void {
  if (cache.size <= maxEntries) return;

  const entries = Array.from(cache.entries()).sort(
    ([, a], [, b]) => a.lastAccessed - b.lastAccessed
  );

  const toRemove = entries.slice(0, cache.size - maxEntries);
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

/**
 * Decode base64 in chunks to reduce peak memory usage.
 * Standard atob() creates intermediate strings that double memory pressure.
 */
function decodeBase64Chunked(base64: string): Uint8Array {
  const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
  const totalLength = Math.floor((base64.length * 3) / 4);
  const result = new Uint8Array(totalLength);
  let resultOffset = 0;

  for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
    const chunk = base64.slice(i, Math.min(i + CHUNK_SIZE, base64.length));
    const binary = atob(chunk);
    for (let j = 0; j < binary.length; j++) {
      result[resultOffset++] = binary.charCodeAt(j);
    }
  }

  return result.slice(0, resultOffset);
}

/**
 * Register the pmtiles custom protocol with MapLibre (native only).
 * Call once at app startup (e.g. in _layout.tsx).
 */
export function registerPMTilesProtocol(): void {
  if (registered) return;
  const MapLibreGL = getMapLibre();
  if (!MapLibreGL?.addCustomProtocol) return;

  try {
    const { PMTiles } = require("pmtiles");
    _remoteCache = new Map<string, CacheEntry<InstanceType<typeof PMTiles>>>();
    _localCache = new Map<string, CacheEntry<InstanceType<typeof PMTiles>>>();

    MapLibreGL.addCustomProtocol("pmtiles", async (params: { url: string }) => {
      try {
        const url = params.url.replace("pmtiles://", "");
        const parts = url.split("/").filter(Boolean);
        const z = parseInt(parts[parts.length - 3], 10);
        const x = parseInt(parts[parts.length - 2], 10);
        const y = parseInt(parts[parts.length - 1], 10);

        if (isNaN(z) || isNaN(x) || isNaN(y)) {
          return { data: new ArrayBuffer(0) };
        }

        const prefix = parts.slice(0, -3).join("/");
        const isLocal = prefix.startsWith("local-");
        const key = isLocal ? prefix : (prefix.endsWith(".pmtiles") ? prefix : `${prefix}.pmtiles`);

        if (isLocal) {
          const path = localPaths.get(prefix);
          if (!path) {
            return { data: new ArrayBuffer(0) };
          }

          let entry = _localCache!.get(key);
          if (!entry) {
            // Load file with chunked decoding to reduce peak memory
            const FileSystem = require("expo-file-system/legacy").default;

            // Check file exists and get size
            const fileInfo = await FileSystem.getInfoAsync(path, { size: true });
            if (!fileInfo.exists) {
              console.warn(`[pmtiles] Local file not found: ${path}`);
              return { data: new ArrayBuffer(0) };
            }

            const base64 = await FileSystem.readAsStringAsync(path, {
              encoding: FileSystem.EncodingType.Base64,
            });

            // Use chunked decoding for memory efficiency
            const bytes = decodeBase64Chunked(base64);

            entry = {
              instance: new PMTiles(bytes.buffer),
              lastAccessed: Date.now(),
            };
            _localCache!.set(key, entry);

            // Evict old entries if over limit
            evictLRU(_localCache!, MAX_LOCAL_CACHE_ENTRIES);
          } else {
            entry.lastAccessed = Date.now();
          }

          const tile = await entry.instance.getZxy(z, x, y);
          if (!tile?.data) return { data: new ArrayBuffer(0) };
          return { data: tile.data };
        }

        // Remote PMTiles - uses HTTP range requests natively
        let entry = _remoteCache!.get(key);
        if (!entry) {
          const pmtilesUrl = key.includes(".pmtiles") ? key : `${prefix}.pmtiles`;
          entry = {
            instance: new PMTiles(pmtilesUrl),
            lastAccessed: Date.now(),
          };
          _remoteCache!.set(key, entry);

          // Evict old entries if over limit
          evictLRU(_remoteCache!, MAX_REMOTE_CACHE_ENTRIES);
        } else {
          entry.lastAccessed = Date.now();
        }

        const tile = await entry.instance.getZxy(z, x, y);
        if (!tile?.data) return { data: new ArrayBuffer(0) };
        return { data: tile.data };
      } catch (e) {
        console.warn("[pmtiles] Tile fetch failed:", e);
        return { data: new ArrayBuffer(0) };
      }
    });

    registered = true;
  } catch (e) {
    console.warn("[maplibre-pmtiles-protocol] Failed to register:", e);
  }
}
