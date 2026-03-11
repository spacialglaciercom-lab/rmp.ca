/**
 * Route-based bbox map download from Cloudflare R2 PMTiles.
 *
 * Instead of downloading an entire city's tileset, this module computes a
 * bounding box from a GPX route (with a 500 m buffer), enumerates the tiles
 * at zoom levels 10–14, and fetches only those tiles via HTTP Range requests
 * to the public R2 bucket. Typical storage savings: ~95-98 % vs full city.
 *
 * Native only (iOS / Android). Web does not use this.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { parseGPXForNavigation, type ParsedTrackPoint } from "./gpxNavParser";

const R2_PUBLIC_BASE = "https://pub-914a188759fd40078f51e48f31a76dba.r2.dev";
const PMTILES_VERSION = "v2026-02";

const ROUTE_MAPS_KEY = "trashroute_route_bbox_maps";
const ROUTE_MAPS_DIR = "route_bbox_maps";

const BBOX_BUFFER_M = 500;
const MIN_ZOOM = 10;
const MAX_ZOOM = 14;
const PROGRESS_THROTTLE_MS = 250;

const AVAILABLE_CITIES: { id: string; bounds: RouteBBox }[] = [
  {
    id: "montreal",
    bounds: { minLat: 45.41, maxLat: 45.7, minLon: -73.85, maxLon: -73.5 },
  },
  {
    id: "laval",
    bounds: { minLat: 45.53, maxLat: 45.63, minLon: -73.8, maxLon: -73.65 },
  },
  {
    id: "longueuil",
    bounds: { minLat: 45.43, maxLat: 45.55, minLon: -73.55, maxLon: -73.42 },
  },
  {
    id: "toronto",
    bounds: { minLat: 43.58, maxLat: 43.85, minLon: -79.64, maxLon: -79.11 },
  },
  {
    id: "vancouver",
    bounds: { minLat: 49.2, maxLat: 49.35, minLon: -123.25, maxLon: -123.0 },
  },
];

// ─── Types ────────────────────────────────────────────────────────

export interface RouteBBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface DownloadedRouteMap {
  routeId: string;
  routeName: string;
  bbox: RouteBBox;
  tileCount: number;
  sizeBytes: number;
  downloadedAt: number;
  zoomRange: [number, number];
  city: string;
}

export interface RouteMapEstimate {
  tileCount: number;
  estimatedBytes: number;
  city: string | null;
  bbox: RouteBBox;
}

// ─── Geo utilities ────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLon(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos(lat * DEG_TO_RAD);
}

/**
 * Compute a bounding box from GPX track points with an outward buffer in meters.
 */
export function computeBBoxFromPoints(
  points: { lat: number; lon: number }[],
  bufferM: number = BBOX_BUFFER_M,
): RouteBBox {
  if (points.length === 0) {
    throw new Error("Cannot compute bbox from empty point list");
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const latBuffer = bufferM / METERS_PER_DEG_LAT;
  const midLat = (minLat + maxLat) / 2;
  const lonBuffer = bufferM / metersPerDegLon(midLat);

  return {
    minLat: minLat - latBuffer,
    maxLat: maxLat + latBuffer,
    minLon: minLon - lonBuffer,
    maxLon: maxLon + lonBuffer,
  };
}

/**
 * Compute bbox directly from a GPX XML string.
 */
export function computeBBoxFromGPX(gpxString: string): RouteBBox {
  const parsed = parseGPXForNavigation(gpxString);
  if (parsed.points.length === 0) {
    throw new Error("GPX contains no track or route points");
  }
  return computeBBoxFromPoints(parsed.points);
}

// ─── Tile math ────────────────────────────────────────────────────

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * (1 << z));
}

function latToTileY(lat: number, z: number): number {
  const latRad = lat * DEG_TO_RAD;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      (1 << z),
  );
}

/**
 * Enumerate all tile coordinates within a bbox for zoom levels minZ..maxZ.
 */
export function enumerateTiles(
  bbox: RouteBBox,
  minZ: number = MIN_ZOOM,
  maxZ: number = MAX_ZOOM,
): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lonToTileX(bbox.minLon, z);
    const xMax = lonToTileX(bbox.maxLon, z);
    const yMin = latToTileY(bbox.maxLat, z); // higher lat → smaller y
    const yMax = latToTileY(bbox.minLat, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

// ─── City matching ────────────────────────────────────────────────

function bboxOverlaps(a: RouteBBox, b: RouteBBox): boolean {
  return (
    a.minLat <= b.maxLat &&
    a.maxLat >= b.minLat &&
    a.minLon <= b.maxLon &&
    a.maxLon >= b.minLon
  );
}

/**
 * Determine which PMTiles city file covers the route bbox.
 * Returns null if no coverage.
 */
export function findCityForBBox(bbox: RouteBBox): string | null {
  for (const city of AVAILABLE_CITIES) {
    if (bboxOverlaps(bbox, city.bounds)) return city.id;
  }
  return null;
}

// ─── Size estimation ──────────────────────────────────────────────

const AVG_TILE_BYTES: Record<number, number> = {
  10: 8_000,
  11: 12_000,
  12: 18_000,
  13: 25_000,
  14: 35_000,
};

/**
 * Estimate download size and tile count for a route's GPX data.
 */
export function estimateRouteMapDownload(gpxString: string): RouteMapEstimate {
  const bbox = computeBBoxFromGPX(gpxString);
  const tiles = enumerateTiles(bbox);
  const city = findCityForBBox(bbox);

  let estimatedBytes = 0;
  for (const t of tiles) {
    estimatedBytes += AVG_TILE_BYTES[t.z] ?? 20_000;
  }

  return { tileCount: tiles.length, estimatedBytes, city, bbox };
}

// ─── Storage helpers ──────────────────────────────────────────────

function getStorageBase(): string {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) throw new Error("No file system directory available");
  return base;
}

function getRouteMapDir(routeId: string): string {
  return `${getStorageBase()}${ROUTE_MAPS_DIR}/${routeId}`;
}

function getTilePath(routeId: string, tile: TileCoord): string {
  return `${getRouteMapDir(routeId)}/${tile.z}/${tile.x}/${tile.y}.pbf`;
}

let routeMapsCache: DownloadedRouteMap[] | null = null;

async function loadRouteMaps(): Promise<DownloadedRouteMap[]> {
  if (routeMapsCache) return routeMapsCache;
  try {
    const raw = await AsyncStorage.getItem(ROUTE_MAPS_KEY);
    if (!raw) {
      routeMapsCache = [];
      return [];
    }
    const parsed = JSON.parse(raw) as DownloadedRouteMap[];
    routeMapsCache = Array.isArray(parsed) ? parsed : [];
    return routeMapsCache;
  } catch {
    routeMapsCache = [];
    return [];
  }
}

async function saveRouteMaps(maps: DownloadedRouteMap[]): Promise<void> {
  routeMapsCache = maps;
  await AsyncStorage.setItem(ROUTE_MAPS_KEY, JSON.stringify(maps));
}

export async function getDownloadedRouteMaps(): Promise<DownloadedRouteMap[]> {
  return loadRouteMaps();
}

// ─── PMTiles tile fetching via HTTP Range ─────────────────────────

interface PMTilesInstance {
  getZxy(
    z: number,
    x: number,
    y: number,
  ): Promise<{ data: ArrayBuffer } | undefined>;
}

function getPMTilesUrl(city: string): string {
  return `${R2_PUBLIC_BASE}/tiles/${city}-${PMTILES_VERSION}.pmtiles`;
}

async function createPMTilesReader(city: string): Promise<PMTilesInstance> {
  const { PMTiles } = require("pmtiles");
  return new PMTiles(getPMTilesUrl(city)) as PMTilesInstance;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── Download ─────────────────────────────────────────────────────

export type ProgressCallback = (
  done: number,
  total: number,
  phase: string,
) => void;

/**
 * Download map tiles for a route's bounding box from Cloudflare R2.
 * Uses the PMTiles library, which internally makes HTTP Range requests.
 */
export async function downloadRouteMap(
  routeId: string,
  routeName: string,
  gpxString: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<{
  success: boolean;
  tileCount: number;
  sizeBytes: number;
  error?: string;
}> {
  const bbox = computeBBoxFromGPX(gpxString);
  const city = findCityForBBox(bbox);
  if (!city) {
    return {
      success: false,
      tileCount: 0,
      sizeBytes: 0,
      error:
        "Route is outside available PMTiles coverage. Supported: Montreal, Laval, Longueuil, Toronto, Vancouver.",
    };
  }

  const tiles = enumerateTiles(bbox);
  if (tiles.length === 0) {
    return {
      success: false,
      tileCount: 0,
      sizeBytes: 0,
      error: "No tiles in route bbox",
    };
  }

  onProgress?.(0, tiles.length, "Opening PMTiles…");

  let reader: PMTilesInstance;
  try {
    reader = await createPMTilesReader(city);
  } catch (err) {
    return {
      success: false,
      tileCount: 0,
      sizeBytes: 0,
      error: `Failed to open PMTiles: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const routeDir = getRouteMapDir(routeId);
  const dirInfo = await FileSystem.getInfoAsync(routeDir, { size: false });
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(routeDir, { intermediates: true });
  }

  let downloaded = 0;
  let totalBytes = 0;
  let lastProgressTime = 0;
  let skipped = 0;

  for (let i = 0; i < tiles.length; i++) {
    if (signal?.aborted) {
      return {
        success: false,
        tileCount: downloaded,
        sizeBytes: totalBytes,
        error: "Cancelled",
      };
    }

    const tile = tiles[i];
    const tilePath = getTilePath(routeId, tile);

    try {
      const tileDir = tilePath.substring(0, tilePath.lastIndexOf("/"));
      const tdInfo = await FileSystem.getInfoAsync(tileDir, { size: false });
      if (!tdInfo.exists) {
        await FileSystem.makeDirectoryAsync(tileDir, { intermediates: true });
      }

      const result = await reader.getZxy(tile.z, tile.x, tile.y);
      if (result?.data && result.data.byteLength > 0) {
        const base64 = arrayBufferToBase64(result.data);
        await FileSystem.writeAsStringAsync(tilePath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        totalBytes += result.data.byteLength;
        downloaded++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn(
        `[RouteMap] Failed tile ${tile.z}/${tile.x}/${tile.y}:`,
        err,
      );
      skipped++;
    }

    const now = Date.now();
    if (
      now - lastProgressTime >= PROGRESS_THROTTLE_MS ||
      i === tiles.length - 1
    ) {
      onProgress?.(
        i + 1,
        tiles.length,
        `Downloading tiles… (${downloaded} saved)`,
      );
      lastProgressTime = now;
    }
  }

  if (downloaded === 0) {
    return {
      success: false,
      tileCount: 0,
      sizeBytes: 0,
      error: "No tile data returned for this area",
    };
  }

  const routeMap: DownloadedRouteMap = {
    routeId,
    routeName,
    bbox,
    tileCount: downloaded,
    sizeBytes: totalBytes,
    downloadedAt: Date.now(),
    zoomRange: [MIN_ZOOM, MAX_ZOOM],
    city,
  };

  const existing = await loadRouteMaps();
  const filtered = existing.filter((r) => r.routeId !== routeId);
  filtered.push(routeMap);
  await saveRouteMaps(filtered);

  return { success: true, tileCount: downloaded, sizeBytes: totalBytes };
}

// ─── Delete ───────────────────────────────────────────────────────

export async function deleteRouteMap(routeId: string): Promise<void> {
  const dir = getRouteMapDir(routeId);
  try {
    const info = await FileSystem.getInfoAsync(dir, { size: false });
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }
  } catch (err) {
    console.warn(`[RouteMap] Failed to delete data for ${routeId}:`, err);
  }

  const existing = await loadRouteMaps();
  const filtered = existing.filter((r) => r.routeId !== routeId);
  await saveRouteMaps(filtered);
}

// ─── Tile access (for serving to MapLibre) ────────────────────────

/**
 * Get the local file path for a downloaded tile, or null if not cached.
 */
export async function getLocalTile(
  routeId: string,
  z: number,
  x: number,
  y: number,
): Promise<string | null> {
  const path = getTilePath(routeId, { z, x, y });
  try {
    const info = await FileSystem.getInfoAsync(path, { size: false });
    return info.exists ? path : null;
  } catch {
    return null;
  }
}

/**
 * Get the base directory for a route's downloaded tiles.
 */
export function getRouteMapTileDir(routeId: string): string {
  return getRouteMapDir(routeId);
}

// ─── Formatting ───────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
