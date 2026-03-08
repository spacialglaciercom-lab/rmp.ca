/**
 * Offline map data:
 * 1) Overture Maps — download transportation segments from AWS S3 / R2 (Parquet/PMTiles).
 * 2) MapLibre tile packs — download style + tiles for offline map viewing (native only).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { OVERPASS_API_ENDPOINTS } from "@/lib/overpassService";
import { getOfflineManager } from "./maplibre-offline-manager";

const OFFLINE_MAPS_KEY = "trashroute_offline_maps";
const DOWNLOAD_STATE_KEY = "trashroute_download_state";
const MAPS_DIR = "overture";

/** Persistent state for resumable downloads. */
interface DownloadState {
  cityId: string;
  source: "r2" | "s3";
  /** For R2: expo-file-system resumable snapshot. */
  resumableSnapshot?: string;
  /** For S3: list of completed file keys. */
  completedFiles?: string[];
  /** Total files expected (for S3). */
  totalFiles?: number;
  startedAt: number;
}

/** Save download state for resume capability. */
async function saveDownloadState(state: DownloadState): Promise<void> {
  try {
    await AsyncStorage.setItem(DOWNLOAD_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[OfflineMaps] Failed to save download state:", e);
  }
}

/** Load saved download state. */
async function loadDownloadState(): Promise<DownloadState | null> {
  try {
    const raw = await AsyncStorage.getItem(DOWNLOAD_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DownloadState;
  } catch {
    return null;
  }
}

/** Clear download state after completion or cancellation. */
async function clearDownloadState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DOWNLOAD_STATE_KEY);
  } catch {
    // ignore
  }
}

/** Check if there's a resumable download for a city. */
export async function hasResumableDownload(cityId: string): Promise<boolean> {
  const state = await loadDownloadState();
  return state?.cityId === cityId;
}

/** Get info about a pending resumable download. */
export async function getResumableDownloadInfo(): Promise<{
  cityId: string;
  source: "r2" | "s3";
  progress?: number;
} | null> {
  const state = await loadDownloadState();
  if (!state) return null;
  let progress: number | undefined;
  if (state.source === "s3" && state.completedFiles && state.totalFiles) {
    progress = Math.round((state.completedFiles.length / state.totalFiles) * 100);
  }
  return { cityId: state.cityId, source: state.source, progress };
}

/** Overture Maps S3 bucket base URL (public, no auth). */
const S3_BUCKET = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com";
const RELEASE = "2026-02-18.0";

/** R2 public bucket base and PMTiles version (must match build-pmtiles.sh). */
const R2_PUBLIC_BASE = "https://pub-914a188759fd40078f51e48f31a76dba.r2.dev";
const PMTILES_VERSION = "v2026-02";

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

export type DownloadSource = "r2" | "s3" | "osm_pbf";

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
  /** For source "osm_pbf", the city id used for the directory (file is {cityId}.osm). */
  cityId?: string;
  /** Data version (e.g., "2026-02-18.0" for Overture, "v2026-02" for R2 PMTiles). */
  dataVersion?: string;
}

/** Number of days after which downloaded data is considered stale. */
const DATA_STALE_DAYS = 30;

/** Current data versions for checking updates. */
export const CURRENT_DATA_VERSIONS = {
  overture: RELEASE,
  pmtiles: PMTILES_VERSION,
} as const;

/**
 * Check if a downloaded region's data is stale (older than DATA_STALE_DAYS).
 */
export function isRegionStale(region: DownloadedRegion): boolean {
  const ageMs = Date.now() - region.downloadedAt;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > DATA_STALE_DAYS;
}

/**
 * Check if a downloaded region has an outdated data version.
 */
export function isRegionOutdated(region: DownloadedRegion): boolean {
  if (!region.dataVersion) return true; // No version = assume outdated
  if (region.source === "r2") {
    return region.dataVersion !== PMTILES_VERSION;
  }
  if (region.source === "s3") {
    return region.dataVersion !== RELEASE;
  }
  // OSM data doesn't have versioning, use staleness check
  return isRegionStale(region);
}

/**
 * Get human-readable age of downloaded data.
 */
export function getRegionAge(region: DownloadedRegion): string {
  const ageMs = Date.now() - region.downloadedAt;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  if (ageDays === 0) return "Today";
  if (ageDays === 1) return "Yesterday";
  if (ageDays < 7) return `${ageDays} days ago`;
  if (ageDays < 30) return `${Math.floor(ageDays / 7)} weeks ago`;
  if (ageDays < 365) return `${Math.floor(ageDays / 30)} months ago`;
  return `${Math.floor(ageDays / 365)} years ago`;
}

/**
 * Get regions that need updates (stale or outdated version).
 */
export async function getRegionsNeedingUpdate(): Promise<DownloadedRegion[]> {
  const regions = await getDownloadedRegions();
  return regions.filter((r) => isRegionStale(r) || isRegionOutdated(r));
}

/**
 * Get update status summary for UI display.
 */
export async function getUpdateStatus(): Promise<{
  totalRegions: number;
  staleCount: number;
  outdatedCount: number;
  upToDateCount: number;
}> {
  const regions = await getDownloadedRegions();
  let staleCount = 0;
  let outdatedCount = 0;
  let upToDateCount = 0;

  for (const region of regions) {
    if (isRegionOutdated(region)) {
      outdatedCount++;
    } else if (isRegionStale(region)) {
      staleCount++;
    } else {
      upToDateCount++;
    }
  }

  return {
    totalRegions: regions.length,
    staleCount,
    outdatedCount,
    upToDateCount,
  };
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
 * Supports resume: tracks completed files and skips them on restart.
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

  // Check for saved state (resume support)
  const savedState = await loadDownloadState();
  const completedFiles = new Set<string>(
    savedState?.cityId === city.id && savedState.source === "s3"
      ? savedState.completedFiles ?? []
      : []
  );
  const isResuming = completedFiles.size > 0;

  // Phase 1: List S3 objects for each layer
  onProgress?.(0, 1, isResuming ? "Resuming…" : "Listing files…");
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
    await clearDownloadState();
    return { success: false, fileCount: 0, sizeBytes: 0, error: "No data files found for this region" };
  }

  // Save initial state
  await saveDownloadState({
    cityId: city.id,
    source: "s3",
    completedFiles: Array.from(completedFiles),
    totalFiles: allObjects.length,
    startedAt: savedState?.startedAt ?? Date.now(),
  });

  // Phase 2: Download each file (skip already completed)
  let downloaded = completedFiles.size;
  let totalBytes = 0;
  let lastProgressTime = 0;
  let lastStateSaveTime = 0;

  for (let i = 0; i < allObjects.length; i++) {
    const obj = allObjects[i];

    // Skip already downloaded files
    if (completedFiles.has(obj.key)) {
      totalBytes += obj.size;
      continue;
    }

    if (signal?.aborted) {
      // Save state for resume
      await saveDownloadState({
        cityId: city.id,
        source: "s3",
        completedFiles: Array.from(completedFiles),
        totalFiles: allObjects.length,
        startedAt: savedState?.startedAt ?? Date.now(),
      });
      return { success: false, fileCount: downloaded, sizeBytes: totalBytes, error: "Download cancelled (resumable)" };
    }

    const localPath = getLocalPath(city.id, obj.key);

    try {
      const s3Url = `${S3_BUCKET}/${obj.key}`;
      await FileSystem.downloadAsync(s3Url, localPath);
      downloaded++;
      totalBytes += obj.size;
      completedFiles.add(obj.key);

      // Periodically save state (every 10 seconds) for crash recovery
      const now = Date.now();
      if (now - lastStateSaveTime >= 10000) {
        await saveDownloadState({
          cityId: city.id,
          source: "s3",
          completedFiles: Array.from(completedFiles),
          totalFiles: allObjects.length,
          startedAt: savedState?.startedAt ?? Date.now(),
        });
        lastStateSaveTime = now;
      }
    } catch (err) {
      console.warn(`[OvertureMaps] Failed to download ${obj.key}:`, err);
    }

    // Throttle progress
    const now = Date.now();
    if (now - lastProgressTime >= PROGRESS_THROTTLE_MS || i === allObjects.length - 1) {
      onProgress?.(downloaded, allObjects.length, isResuming ? "Resuming…" : "Downloading…");
      lastProgressTime = now;
    }
  }

  // Clear download state on success
  await clearDownloadState();

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
    dataVersion: RELEASE,
  };
  await saveDownloadedRegion(region);
  return { success: true, fileCount: downloaded, sizeBytes: totalBytes };
}

// ─── R2 PMTiles download ──────────────────────────────────────────

/**
 * Download a single pre-built PMTiles file for a city from our R2 bucket.
 * Much faster than S3 Parquet — typically 3-35 MB per city.
 * Supports resume: if interrupted, call again to continue from where it left off.
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

  // Check for saved resumable state
  const savedState = await loadDownloadState();
  let downloadResumable: FileSystem.DownloadResumable;
  let isResuming = false;

  // Use createDownloadResumable for progress tracking
  let lastProgressTime = 0;
  const progressCallback = (downloadProgress: FileSystem.DownloadProgressData) => {
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
      `${isResuming ? "Resuming" : "Downloading"}… ${pct}% (${formatBytes(totalBytesWritten)})`
    );
  };

  // Try to resume from saved state
  if (savedState?.cityId === city.id && savedState.source === "r2" && savedState.resumableSnapshot) {
    try {
      onProgress?.(0, 1, "Resuming download…");
      downloadResumable = new FileSystem.DownloadResumable(
        url,
        localPath,
        {},
        progressCallback,
        savedState.resumableSnapshot
      );
      isResuming = true;
    } catch {
      // Fall back to fresh download
      downloadResumable = FileSystem.createDownloadResumable(url, localPath, {}, progressCallback);
    }
  } else {
    onProgress?.(0, 1, "Downloading PMTiles…");
    downloadResumable = FileSystem.createDownloadResumable(url, localPath, {}, progressCallback);
  }

  // Save initial state
  await saveDownloadState({
    cityId: city.id,
    source: "r2",
    startedAt: Date.now(),
  });

  // Handle abort - save state for resume
  if (signal) {
    const onAbort = async () => {
      try {
        const snapshot = await downloadResumable.pauseAsync();
        if (snapshot) {
          await saveDownloadState({
            cityId: city.id,
            source: "r2",
            resumableSnapshot: snapshot.resumeData,
            startedAt: savedState?.startedAt ?? Date.now(),
          });
        }
      } catch {
        // Couldn't save state, will restart from beginning
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const result = isResuming
      ? await downloadResumable.resumeAsync()
      : await downloadResumable.downloadAsync();

    if (signal?.aborted) {
      return { success: false, fileCount: 0, sizeBytes: 0, error: "Cancelled (resumable)" };
    }
    if (!result) {
      await clearDownloadState();
      return { success: false, fileCount: 0, sizeBytes: 0, error: "Download returned no result" };
    }

    // Get actual file size
    const fileInfo = await FileSystem.getInfoAsync(localPath, { size: true });
    const sizeBytes = (fileInfo as any).size ?? 0;

    // Clear download state on success
    await clearDownloadState();

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
      dataVersion: PMTILES_VERSION,
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
  const existing = await getDownloadedRegions();
  const region = existing.find((r) => r.id === regionId);
  if (region?.source === "osm_pbf" && region.cityId) {
    const osmPath = `${getRegionDir(region.cityId)}/${region.cityId}.osm`;
    try {
      const info = await FileSystem.getInfoAsync(osmPath, { size: false });
      if (info.exists) await FileSystem.deleteAsync(osmPath, { idempotent: true });
    } catch (err) {
      console.warn(`[OfflineMaps] Failed to delete OSM file for ${regionId}:`, err);
    }
  } else {
    const dir = getRegionDir(regionId);
    try {
      const info = await FileSystem.getInfoAsync(dir, { size: false });
      if (info.exists) await FileSystem.deleteAsync(dir, { idempotent: true });
    } catch (err) {
      console.warn(`[OvertureMaps] Failed to delete data for ${regionId}:`, err);
    }
  }
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

/** Local path for a city's R2 PMTiles file (when downloaded). */
export function getLocalOverturePmtilesPath(cityId: string): string {
  return `${getRegionDir(cityId)}/${cityId}-${PMTILES_VERSION}.pmtiles`;
}

/**
 * Resolve Overture PMTiles URL for the map: use local file when downloaded, otherwise remote R2.
 * Returns url for VectorSource (pmtiles://local-{cityId}/ or pmtiles://https://...)
 * and optional localPath so the caller can register it with the pmtiles protocol.
 */
export async function getOverturePmtilesUrl(cityId: string): Promise<{
  url: string;
  localPath?: string;
}> {
  const localPath = getLocalOverturePmtilesPath(cityId);
  try {
    const info = await FileSystem.getInfoAsync(localPath, { size: false });
    if (info?.exists) {
      return {
        url: `pmtiles://local-${cityId}/`,
        localPath,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    url: `pmtiles://${R2_PUBLIC_BASE}/tiles/${cityId}-${PMTILES_VERSION}.pmtiles`,
  };
}

// ─── MapLibre tile packs (native only) ─────────────────────────────────────
// Download map style + tiles for offline viewing via @maplibre/maplibre-react-native.

export type OfflineProgress = {
  percentage: number;
  completedResourceCount: number;
  completedResourceSize: number;
  requiredResourceCount: number;
};

/**
 * Download an offline tile pack for the given bounds and zoom range.
 * styleURL must match the styleURL used in <MapView styleURL={...}>.
 * Bounds: [[NE_LNG, NE_LAT], [SW_LNG, SW_LAT]].
 */
export async function downloadOfflineRegion(
  name: string,
  styleURL: string,
  bounds: [[number, number], [number, number]],
  minZoom: number = 10,
  maxZoom: number = 16,
  onProgress: (progress: OfflineProgress) => void,
  onComplete: () => void,
  onError: (error: unknown) => void
): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager) {
    onError(new Error("MapLibre OfflineManager not available on this platform"));
    return;
  }
  try {
    await OfflineManager.createPack(
      { name, styleURL, minZoom, maxZoom, bounds },
      (_offlineRegion: unknown, status: { completedResourceCount: number; completedResourceSize: number; requiredResourceCount: number }) => {
        const required = status.requiredResourceCount || 1;
        const progress: OfflineProgress = {
          percentage: Math.round((status.completedResourceCount / required) * 100),
          completedResourceCount: status.completedResourceCount,
          completedResourceSize: status.completedResourceSize,
          requiredResourceCount: status.requiredResourceCount,
        };
        onProgress(progress);
      },
      (_offlineRegion: unknown, err: unknown) => {
        console.error("Offline download error:", err);
        onError(err);
      }
    );
    onComplete();
  } catch (err) {
    onError(err);
  }
}

export async function getAllOfflinePacks(): Promise<unknown[]> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.getPacks) return [];
  try {
    return await OfflineManager.getPacks();
  } catch {
    return [];
  }
}

export async function getOfflinePack(name: string): Promise<unknown | null> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.getPack) return null;
  try {
    return await OfflineManager.getPack(name);
  } catch {
    return null;
  }
}

/**
 * Delete a MapLibre offline pack by name.
 * Returns true if deleted successfully, false otherwise.
 * UI alerts should be handled by the calling component, not here.
 */
export async function deleteOfflinePack(name: string): Promise<boolean> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.deletePack) return false;
  try {
    await OfflineManager.deletePack(name);
    return true;
  } catch (e) {
    console.warn("[OfflineMapDownload] deleteOfflinePack failed:", e);
    return false;
  }
}

/** @deprecated Use deleteOfflinePack instead. Kept for backward compatibility. */
export const deleteMapLibrePack = deleteOfflinePack;

/** Info returned by getPacks() for display in settings. */
export interface MapLibrePackInfo {
  name: string;
  bounds?: [[number, number], [number, number]];
  metadata?: Record<string, unknown>;
}

/** Get all MapLibre offline packs (native only). */
export async function getMapLibrePacks(): Promise<MapLibrePackInfo[]> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.getPacks) return [];
  try {
    const packs = (await OfflineManager.getPacks()) as Array<{ name?: string; bounds?: [[number, number], [number, number]]; metadata?: Record<string, unknown> }>;
    return (packs ?? []).map((p) => ({
      name: p.name ?? "unknown",
      bounds: p.bounds,
      metadata: p.metadata,
    }));
  } catch {
    return [];
  }
}

/**
 * Create a MapLibre offline tile pack for a city (native only).
 * Bounds are taken from the city; use the same styleURL as the map (e.g. MAPLIBRE_STYLE_OSM).
 */
export async function createMapLibrePack(
  city: OfflineCity,
  styleURL: string,
  minZoom: number,
  maxZoom: number,
  onProgress: (progress: OfflineProgress) => void,
  onError: (error: unknown) => void
): Promise<void> {
  const name = `pack_${city.id}`;
  const { minLat, maxLat, minLon, maxLon } = city.bounds;
  const bounds: [[number, number], [number, number]] = [
    [maxLon, maxLat],
    [minLon, minLat],
  ];
  return downloadOfflineRegion(
    name,
    styleURL,
    bounds,
    minZoom,
    maxZoom,
    onProgress,
    () => {},
    onError
  );
}

export async function invalidatePack(name: string): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.invalidatePack) return;
  try {
    await OfflineManager.invalidatePack(name);
  } catch (e) {
    console.warn("[OfflineMapDownload] invalidatePack failed:", e);
  }
}

export async function clearAmbientCache(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.clearAmbientCache) return;
  try {
    await OfflineManager.clearAmbientCache();
  } catch (e) {
    console.warn("[OfflineMapDownload] clearAmbientCache failed:", e);
  }
}

export async function invalidateAmbientCache(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.invalidateAmbientCache) return;
  try {
    await OfflineManager.invalidateAmbientCache();
  } catch (e) {
    console.warn("[OfflineMapDownload] invalidateAmbientCache failed:", e);
  }
}

export async function setMaxCacheSize(bytes: number): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.setMaximumAmbientCacheSize) return;
  try {
    await OfflineManager.setMaximumAmbientCacheSize(bytes);
  } catch (e) {
    console.warn("[OfflineMapDownload] setMaxCacheSize failed:", e);
  }
}

export async function resetEverything(): Promise<void> {
  const OfflineManager = getOfflineManager();
  if (!OfflineManager?.resetDatabase) return;
  try {
    await OfflineManager.resetDatabase();
  } catch (e) {
    console.warn("[OfflineMapDownload] resetEverything failed:", e);
  }
}

// ─── OSM PBF / OSM data download (Overpass API, saved as .osm) ─────────────

/**
 * Download OSM data for a city (Overpass API bbox export, saved as .osm XML).
 * Tries each endpoint in OVERPASS_API_ENDPOINTS until one succeeds.
 * Returns the local file URI. Progress is approximate (fetch has no progress for response body).
 */
export async function downloadOSMPBF(
  city: OfflineCity,
  onProgress?: (done: number, total: number, phase: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const regionDir = getRegionDir(city.id);
  const filename = `${city.id}.osm`;
  const localPath = `${regionDir}/${filename}`;

  const dirInfo = await FileSystem.getInfoAsync(regionDir, { size: false });
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(regionDir, { intermediates: true });
  }

  const { minLat, maxLat, minLon, maxLon } = city.bounds;
  // Include primary/trunk roads for better coverage of main routes
  const query = `[out:xml][timeout:180];way["highway"~"residential|tertiary|secondary|primary|trunk|unclassified|living_street|primary_link|secondary_link|tertiary_link|trunk_link"](${minLat},${minLon},${maxLat},${maxLon});(._;>;);out;`;
  const body = `data=${encodeURIComponent(query)}`;

  let text: string | null = null;
  let lastError: Error | null = null;

  for (let i = 0; i < OVERPASS_API_ENDPOINTS.length; i++) {
    if (signal?.aborted) throw new Error("Cancelled");
    const endpoint = OVERPASS_API_ENDPOINTS[i];
    onProgress?.(0, 1, `Requesting OSM data… (endpoint ${i + 1}/${OVERPASS_API_ENDPOINTS.length})`);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
      if (!res.ok) {
        throw new Error(`Overpass API failed: ${res.status} ${res.statusText}`);
      }
      text = await res.text();
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (signal?.aborted) throw new Error("Cancelled");
      console.warn(`[OfflineMaps] Overpass endpoint failed: ${endpoint}`, lastError.message);
    }
  }

  if (text == null) {
    throw lastError ?? new Error("All Overpass API endpoints failed. Please try again later.");
  }

  onProgress?.(0.5, 1, "Saving…");
  await FileSystem.writeAsStringAsync(localPath, text, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const fileInfo = await FileSystem.getInfoAsync(localPath, { size: true });
  const sizeBytes = (fileInfo as { size?: number }).size ?? 0;

  const regionId = `${city.id}_osm_pbf`;
  const downloadDate = new Date();
  const region: DownloadedRegion = {
    id: regionId,
    name: city.name,
    country: city.country,
    bounds: city.bounds,
    fileCount: 1,
    sizeBytes,
    downloadedAt: downloadDate.getTime(),
    layers: ["osm"],
    source: "osm_pbf",
    cityId: city.id,
    // OSM data uses download date as version (format: YYYY-MM-DD)
    dataVersion: downloadDate.toISOString().split("T")[0],
  };
  await saveDownloadedRegion(region);
  onProgress?.(1, 1, "Done");
  return localPath;
}

/** Get the local path to a downloaded OSM file for a city, if it exists. */
export async function getOSMPBFFilePath(cityId: string): Promise<string | null> {
  const path = `${getRegionDir(cityId)}/${cityId}.osm`;
  const info = await FileSystem.getInfoAsync(path, { size: false });
  return info.exists ? path : null;
}
