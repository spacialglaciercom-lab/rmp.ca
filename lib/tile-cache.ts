/**
 * Map tile cache — stores raster map tiles on disk (Library/Caches on iOS, cache dir on Android).
 * On-demand loading only: tiles are cached when requested, not pre-cached.
 * Max size 500MB with LRU eviction. Cache is cleared on app launch if it exceeds the threshold.
 */

import * as FileSystem from "expo-file-system/legacy";

/** Subdirectory under cacheDirectory where tiles are stored (e.g. Library/Caches/map-tiles on iOS). */
export const TILE_CACHE_DIR_NAME = "map-tiles";

/** Max cache size in bytes (500MB). */
export const MAX_CACHE_BYTES = 500 * 1024 * 1024;

/** If cache size exceeds this on app launch, the entire tile cache is cleared. */
export const LAUNCH_CLEAR_THRESHOLD_BYTES = 500 * 1024 * 1024;

const MANIFEST_FILE = "manifest.json";

interface ManifestEntry {
  size: number;
  lastAccessed: number;
}

type Manifest = Record<string, ManifestEntry>;

let manifestCache: Manifest | null = null;

function getCacheDir(): string | null {
  const base = FileSystem.cacheDirectory;
  if (!base) return null;
  return `${base}${TILE_CACHE_DIR_NAME}/`;
}

function getManifestPath(): string | null {
  const dir = getCacheDir();
  return dir ? `${dir}${MANIFEST_FILE}` : null;
}

/** Stable cache key for a tile (z, x, y) and URL template. */
function tileKey(z: number, x: number, y: number, urlTemplate: string): string {
  const templateId = urlTemplate.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80);
  return `${z}_${x}_${y}_${templateId}`;
}

/** Resolve URL template to concrete tile URL. */
function tileUrl(z: number, x: number, y: number, urlTemplate: string): string {
  return urlTemplate
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{s}", "a")
    .replace("{r}", "");
}

async function ensureCacheDir(): Promise<string | null> {
  const dir = getCacheDir();
  if (!dir) return null;
  const info = await FileSystem.getInfoAsync(dir, { size: false });
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

async function loadManifest(): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  const path = getManifestPath();
  if (!path) return {};
  try {
    const content = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(content) as Manifest;
    manifestCache = typeof parsed === "object" && parsed !== null ? parsed : {};
    return manifestCache!;
  } catch {
    manifestCache = {};
    return manifestCache;
  }
}

async function saveManifest(manifest: Manifest): Promise<void> {
  const dir = await ensureCacheDir();
  if (!dir) return;
  manifestCache = manifest;
  const path = `${dir}${MANIFEST_FILE}`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(manifest));
}

/** Evict least-recently-accessed tiles until total size is at or below maxBytes. */
async function evictLRU(manifest: Manifest, currentTotal: number, maxBytes: number): Promise<Manifest> {
  if (currentTotal <= maxBytes) return manifest;
  const dir = getCacheDir();
  if (!dir) return manifest;

  const entries = Object.entries(manifest)
    .filter(([, e]) => e.size > 0)
    .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

  let total = currentTotal;
  const next: Manifest = { ...manifest };

  for (const [key, entry] of entries) {
    if (total <= maxBytes) break;
    try {
      await FileSystem.deleteAsync(`${dir}${key}`, { idempotent: true });
      total -= entry.size;
      delete next[key];
    } catch {
      // keep entry if delete failed
    }
  }

  return next;
}

/**
 * Get a tile from cache or fetch and cache it (on-demand). Returns local file path or null.
 * Enforces MAX_CACHE_BYTES by evicting LRU tiles when adding.
 */
export async function getTile(
  z: number,
  x: number,
  y: number,
  urlTemplate: string
): Promise<string | null> {
  const dir = await ensureCacheDir();
  if (!dir) return null;

  const key = tileKey(z, x, y, urlTemplate);
  const manifest = await loadManifest();
  const entry = manifest[key];
  const filePath = `${dir}${key}`;

  if (entry) {
    const info = await FileSystem.getInfoAsync(filePath, { size: false });
    if (info.exists) {
      entry.lastAccessed = Date.now();
      await saveManifest(manifest);
      return filePath;
    }
    delete manifest[key];
  }

  const url = tileUrl(z, x, y, urlTemplate);
  try {
    await FileSystem.downloadAsync(url, filePath);
    const info = await FileSystem.getInfoAsync(filePath, { size: true });
    const size = (info as { size?: number }).size ?? 0;

    manifest[key] = { size, lastAccessed: Date.now() };
    const total = Object.values(manifest).reduce((s, e) => s + e.size, 0);
    const afterEvict = await evictLRU(manifest, total, MAX_CACHE_BYTES);
    await saveManifest(afterEvict);

    return filePath;
  } catch {
    try {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Get tile as a data URL for WebView (e.g. __resolveTile(id, dataUrl)).
 * Returns "data:image/png;base64,..." or null. On-demand: fetches and caches if missing.
 */
export async function getTileDataUrl(
  z: number,
  x: number,
  y: number,
  urlTemplate: string
): Promise<string | null> {
  const path = await getTile(z, x, y, urlTemplate);
  if (!path) return null;
  try {
    const base64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Total size in bytes of the tile cache (from manifest).
 */
export async function getTileCacheSize(): Promise<number> {
  const manifest = await loadManifest();
  return Object.values(manifest).reduce((s, e) => s + e.size, 0);
}

/**
 * Clear the entire tile cache (files + manifest). Called from Settings → Clear Cache and on launch if over threshold.
 */
export async function clearTileCache(): Promise<void> {
  const dir = getCacheDir();
  if (!dir) return;
  manifestCache = null;
  try {
    const info = await FileSystem.getInfoAsync(dir, { size: false });
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }
  } catch {
    // ignore
  }
}

/**
 * Call on app launch (native only). If tile cache size exceeds LAUNCH_CLEAR_THRESHOLD_BYTES, clear the cache.
 */
export async function ensureTileCacheUnderLimit(): Promise<void> {
  const size = await getTileCacheSize();
  if (size >= LAUNCH_CLEAR_THRESHOLD_BYTES) {
    await clearTileCache();
  }
}
