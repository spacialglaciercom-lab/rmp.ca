/**
 * Offline map data — download Overture Maps transportation segments from AWS S3.
 * Uses the public Overture Maps bucket (no auth required).
 * Data is stored locally as GeoParquet files for offline routing and display.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

const OFFLINE_MAPS_KEY = "trashroute_offline_maps";
const MAPS_DIR = "overture";

/** Overture Maps S3 bucket base URL (public, no auth). */
const S3_BUCKET = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com";
const RELEASE = "2026-02-18.0";

/** Available Overture themes/types to download. */
export const OVERTURE_LAYERS = {
  transportation_segment: `release/${RELEASE}/theme=transportation/type=segment/`,
  transportation_connector: `release/${RELEASE}/theme=transportation/type=connector/`,
  places: `release/${RELEASE}/theme=places/type=place/`,
  buildings: `release/${RELEASE}/theme=buildings/type=building/`,
} as const;

export type OvertureLayerKey = keyof typeof OVERTURE_LAYERS;

/** Default layers to download per city. */
const DEFAULT_LAYERS: OvertureLayerKey[] = [
  "transportation_segment",
  "transportation_connector",
];

/** In-memory cache of downloaded regions to avoid AsyncStorage reads on every lookup. */
let regionsCache: DownloadedRegion[] | null = null;

/** Get the base storage directory. Throws if unavailable. */
function getStorageBase(): string {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) throw new Error("No file system directory available for offline maps");
  return base;
}

export interface CityBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface OfflineCity {
  id: string;
  name: string;
  country: string;
  bounds: CityBounds;
  /** Override which layers to download (defaults to transportation). */
  layers?: OvertureLayerKey[];
}

export type DownloadSource = "r2" | "s3";

export interface DownloadedRegion {
  id: string;
  name: string;
  country: string;
  bounds: CityBounds;
  fileCount: number;
  /** Total bytes on disk. */
  sizeBytes: number;
  downloadedAt: number;
  layers: string[];
  /** Which source this was downloaded from. Older entries may lack this field. */
  source?: DownloadSource;
}

/** Predefined cities and regions (Canadian cities only). */
export const OFFLINE_CITIES: OfflineCity[] = [
  { id: "montreal", name: "Montreal", country: "Canada", bounds: { minLat: 45.41, maxLat: 45.70, minLon: -73.85, maxLon: -73.50 } },
  { id: "laval", name: "Laval", country: "Canada", bounds: { minLat: 45.53, maxLat: 45.63, minLon: -73.80, maxLon: -73.65 } },
  { id: "longueuil", name: "Longueuil", country: "Canada", bounds: { minLat: 45.43, maxLat: 45.55, minLon: -73.55, maxLon: -73.42 } },
  { id: "toronto", name: "Toronto", country: "Canada", bounds: { minLat: 43.58, maxLat: 43.85, minLon: -79.64, maxLon: -79.11 } },
  { id: "vancouver", name: "Vancouver", country: "Canada", bounds: { minLat: 49.20, maxLat: 49.35, minLon: -123.25, maxLon: -123.00 } },
  { id: "ottawa", name: "Ottawa", country: "Canada", bounds: { minLat: 45.30, maxLat: 45.55, minLon: -76.05, maxLon: -75.50 } },
  { id: "calgary", name: "Calgary", country: "Canada", bounds: { minLat: 50.90, maxLat: 51.20, minLon: -114.25, maxLon: -113.85 } },
  { id: "edmonton", name: "Edmonton", country: "Canada", bounds: { minLat: 53.45, maxLat: 53.65, minLon: -113.65, maxLon: -113.35 } },
  { id: "quebec_city", name: "Quebec City", country: "Canada", bounds: { minLat: 46.75, maxLat: 46.95, minLon: -71.35, maxLon: -71.15 } },
  { id: "halifax", name: "Halifax", country: "Canada", bounds: { minLat: 44.60, maxLat: 44.72, minLon: -63.70, maxLon: -63.52 } },
];

// ─── S3 bucket listing ────────────────────────────────────────────

interface S3Object {
  key: string;
  size: number;
}

/** Max files to list per layer to avoid listing the entire global dataset. */
const MAX_FILES_PER_LAYER = 500;

/** Timeout for a single S3 list page request (ms). */
const LIST_PAGE_TIMEOUT_MS = 15000;

/**
 * List objects in the public S3 bucket under a given prefix.
 * Uses the S3 REST XML list-objects-v2 API (no auth needed for public buckets).
 * Caps at MAX_FILES_PER_LAYER to avoid hanging on huge global prefixes.
 */
async function listS3Objects(
  prefix: string,
  signal?: AbortSignal,
  onListProgress?: (found: number) => void,
): Promise<S3Object[]> {
  const objects: S3Object[] = [];
  let continuationToken: string | undefined;

  do {
    if (signal?.aborted) break;
    if (objects.length >= MAX_FILES_PER_LAYER) break;

    const params = new URLSearchParams({
      "list-type": "2",
      prefix,
      "max-keys": "1000",
      ...(continuationToken ? { "continuation-token": continuationToken } : {}),
    });
    const url = `${S3_BUCKET}?${params.toString()}`;

    // Per-page timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIST_PAGE_TIMEOUT_MS);
    const combinedSignal = signal
      ? { aborted: signal.aborted || controller.signal.aborted } as AbortSignal
      : controller.signal;

    try {
      const res = await fetch(url, {
        signal: signal ?? controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`S3 list failed: ${res.status}`);
      const xml = await res.text();

      // Parse XML response — extract Key and Size from each <Contents>
      const contentMatches = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
      for (const block of contentMatches) {
        if (objects.length >= MAX_FILES_PER_LAYER) break;
        const keyMatch = block.match(/<Key>(.*?)<\/Key>/);
        const sizeMatch = block.match(/<Size>(\d+)<\/Size>/);
        if (keyMatch?.[1]) {
          objects.push({
            key: keyMatch[1],
            size: sizeMatch?.[1] ? parseInt(sizeMatch[1], 10) : 0,
          });
        }
      }

      onListProgress?.(objects.length);

      // Check for pagination
      const truncated = xml.includes("<IsTruncated>true</IsTruncated>");
      const nextToken = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
      continuationToken = truncated && nextToken?.[1] ? nextToken[1] : undefined;
    } catch (err) {
      clearTimeout(timeout);
      // If it's a timeout or abort, return what we have so far
      if (objects.length > 0) {
        console.warn(`[OvertureMaps] Listing stopped after ${objects.length} files:`, err);
        break;
      }
      throw err;
    }
  } while (continuationToken);

  return objects;
}

// ─── Download logic ───────────────────────────────────────────────

/** Get local directory for a region's data. */
function getRegionDir(regionId: string): string {
  return `${getStorageBase()}${MAPS_DIR}/${regionId}`;
}

/** Get local path for a downloaded S3 file. */
function getLocalPath(regionId: string, s3Key: string): string {
  // Flatten the S3 key to a safe filename
  const safeName = s3Key.replace(/\//g, "__");
  return `${getRegionDir(regionId)}/${safeName}`;
}

/** Minimum interval between progress callbacks (ms). */
const PROGRESS_THROTTLE_MS = 300;

/**
 * Download Overture Maps data for a city from the public S3 bucket.
 * Downloads all Parquet files for the specified layers, then stores metadata.
 */
export async function downloadCityData(
  city: OfflineCity,
  onProgress?: (done: number, total: number, phase: string) => void,
  signal?: AbortSignal
): Promise<{ success: boolean; fileCount: number; sizeBytes: number; error?: string }> {
  const layers = city.layers ?? DEFAULT_LAYERS;
  const regionDir = getRegionDir(city.id);

  // Ensure region directory exists
  const dirInfo = await FileSystem.getInfoAsync(regionDir, { size: false });
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(regionDir, { intermediates: true });
  }

  // Phase 1: List S3 objects for each layer
  onProgress?.(0, 1, "Listing files…");
  const allObjects: S3Object[] = [];

  for (const layer of layers) {
    if (signal?.aborted) return { success: false, fileCount: 0, sizeBytes: 0, error: "Cancelled" };
    const prefix = OVERTURE_LAYERS[layer];
    try {
      const objects = await listS3Objects(
        prefix,
        signal,
        (found) => onProgress?.(found, found, `Listing ${layer}… (${found} files)`),
      );
      // Filter to .parquet files only
      const parquetFiles = objects.filter((o) => o.key.endsWith(".parquet"));
      allObjects.push(...parquetFiles);
    } catch (err) {
      console.warn(`[OvertureMaps] Failed to list ${layer}:`, err);
    }
  }

  if (allObjects.length === 0) {
    return { success: false, fileCount: 0, sizeBytes: 0, error: "No data files found for this region" };
  }

  // Phase 2: Download each file
  let downloaded = 0;
  let totalBytes = 0;
  let lastProgressTime = 0;

  for (let i = 0; i < allObjects.length; i++) {
    if (signal?.aborted) {
      return { success: false, fileCount: downloaded, sizeBytes: totalBytes, error: "Download cancelled" };
    }

    const obj = allObjects[i];
    const localPath = getLocalPath(city.id, obj.key);

    try {
      const s3Url = `${S3_BUCKET}/${obj.key}`;
      await FileSystem.downloadAsync(s3Url, localPath);
      downloaded++;
      totalBytes += obj.size;
    } catch (err) {
      console.warn(`[OvertureMaps] Failed to download ${obj.key}:`, err);
    }

    // Throttle progress
    const now = Date.now();
    if (now - lastProgressTime >= PROGRESS_THROTTLE_MS || i === allObjects.length - 1) {
      onProgress?.(i + 1, allObjects.length, "Downloading…");
      lastProgressTime = now;
    }
  }

  // Save metadata
  const region: DownloadedRegion = {
    id: city.id,
    name: city.name,
    country: city.country,
    bounds: city.bounds,
    fileCount: downloaded,
    sizeBytes: totalBytes,
    downloadedAt: Date.now(),
    layers: layers,
    source: "s3",
  };
  await saveDownloadedRegion(region);
  return { success: true, fileCount: downloaded, sizeBytes: totalBytes };
}

// ─── R2 PMTiles download ──────────────────────────────────────────

const R2_PUBLIC_BASE = "https://pub-914a188759fd40078f51e48f31a76dba.r2.dev";
const PMTILES_VERSION = "v2026-02";

/**
 * Download a single pre-built PMTiles file for a city from our R2 bucket.
 * Much faster than S3 Parquet — typically 3-35 MB per city.
 */
export async function downloadCityFromR2(
  city: OfflineCity,
  onProgress?: (done: number, total: number, phase: string) => void,
  signal?: AbortSignal
): Promise<{ success: boolean; fileCount: number; sizeBytes: number; error?: string }> {
  const regionDir = getRegionDir(city.id);
  const filename = `${city.id}-${PMTILES_VERSION}.pmtiles`;
  const localPath = `${regionDir}/${filename}`;
  const url = `${R2_PUBLIC_BASE}/tiles/${filename}`;

  // Ensure region directory exists
  const dirInfo = await FileSystem.getInfoAsync(regionDir, { size: false });
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(regionDir, { intermediates: true });
  }

  onProgress?.(0, 1, "Downloading PMTiles…");

  // Use createDownloadResumable for progress tracking
  let lastProgressTime = 0;
  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    localPath,
    {},
    (downloadProgress) => {
      if (signal?.aborted) return;
      const now = Date.now();
      if (now - lastProgressTime < PROGRESS_THROTTLE_MS) return;
      lastProgressTime = now;
      const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
      const pct = totalBytesExpectedToWrite > 0
        ? Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100)
        : 0;
      onProgress?.(
        totalBytesWritten,
        totalBytesExpectedToWrite,
        `Downloading… ${pct}% (${formatBytes(totalBytesWritten)})`
      );
    }
  );

  // Handle abort
  if (signal) {
    const onAbort = () => {
      downloadResumable.pauseAsync().catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const result = await downloadResumable.downloadAsync();
    if (signal?.aborted) {
      // Clean up partial file
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
      return { success: false, fileCount: 0, sizeBytes: 0, error: "Cancelled" };
    }
    if (!result) {
      return { success: false, fileCount: 0, sizeBytes: 0, error: "Download returned no result" };
    }

    // Get actual file size
    const fileInfo = await FileSystem.getInfoAsync(localPath, { size: true });
    const sizeBytes = (fileInfo as any).size ?? 0;

    // Save metadata
    const region: DownloadedRegion = {
      id: city.id,
      name: city.name,
      country: city.country,
      bounds: city.bounds,
      fileCount: 1,
      sizeBytes,
      downloadedAt: Date.now(),
      layers: ["pmtiles"],
      source: "r2",
    };
    await saveDownloadedRegion(region);
    onProgress?.(1, 1, "Done");
    return { success: true, fileCount: 1, sizeBytes };
  } catch (err) {
    // Clean up partial file on error
    await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
    if (signal?.aborted) {
      return { success: false, fileCount: 0, sizeBytes: 0, error: "Cancelled" };
    }
    throw err;
  }
}

// ─── Metadata persistence ─────────────────────────────────────────

async function saveDownloadedRegion(region: DownloadedRegion): Promise<void> {
  const existing = await getDownloadedRegions();
  const filtered = existing.filter((r) => r.id !== region.id);
  filtered.push(region);
  regionsCache = filtered;
  await AsyncStorage.setItem(OFFLINE_MAPS_KEY, JSON.stringify(filtered));
}

export async function getDownloadedRegions(): Promise<DownloadedRegion[]> {
  if (regionsCache) return regionsCache;
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_MAPS_KEY);
    if (!raw) { regionsCache = []; return []; }
    const parsed = JSON.parse(raw) as DownloadedRegion[];
    regionsCache = Array.isArray(parsed) ? parsed : [];
    return regionsCache;
  } catch (err) {
    console.warn("[OvertureMaps] Failed to load regions:", err);
    regionsCache = [];
    return [];
  }
}

/** Delete a downloaded region and its data files. */
export async function deleteDownloadedRegion(regionId: string): Promise<void> {
  const dir = getRegionDir(regionId);
  try {
    const info = await FileSystem.getInfoAsync(dir, { size: false });
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }
  } catch (err) {
    console.warn(`[OvertureMaps] Failed to delete data for ${regionId}:`, err);
  }
  const existing = await getDownloadedRegions();
  const filtered = existing.filter((r) => r.id !== regionId);
  regionsCache = filtered;
  await AsyncStorage.setItem(OFFLINE_MAPS_KEY, JSON.stringify(filtered));
}

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Get the local directory path for a downloaded region (for reading Parquet files). */
export function getRegionDataDir(regionId: string): string {
  return getRegionDir(regionId);
}
