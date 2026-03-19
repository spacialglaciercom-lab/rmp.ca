/**
 * Custom bounding-box region download from R2 PMTiles.
 *
 * Lets the user enter any lat/lon bounding box and download only the tiles
 * they need from the montreal.pmtiles file (which covers a large regional area).
 * Uses HTTP Range requests via the PMTiles library — only the requested tiles
 * are transferred, not the entire 89 MB file.
 *
 * Downloaded tiles are stored as individual .pbf files and registered as a
 * DownloadedRegion (source "r2_bbox") so the offline extraction pipeline
 * can use them for route optimization.
 *
 * Native only (iOS/Android).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  getDownloadedRegions,
  saveDownloadedRegion,
  deleteDownloadedRegionById,
  type DownloadedRegion,
  type CityBounds,
} from "@/lib/offline-map-download";

// ─── Constants ────────────────────────────────────────────────────

const R2_PUBLIC_BASE = "https://pub-914a188759fd40078f51e48f31a76dba.r2.dev";
const PMTILES_VERSION = "v2026-02";
const PMTILES_FILE = "montreal"; // covers broad regional area despite the name

/** Zoom levels fetched for road extraction (matches extractFromR2Tiles). */
export const BBOX_MIN_ZOOM = 12;
export const BBOX_MAX_ZOOM = 14;

const PROGRESS_THROTTLE_MS = 250;

/** Average bytes per tile by zoom level (rough estimate for size preview). */
const AVG_TILE_BYTES: Record<number, number> = {
  12: 18_000,
  13: 25_000,
  14: 35_000,
};

// ─── Types ────────────────────────────────────────────────────────

export interface BboxDownloadEstimate {
  tileCount: number;
  estimatedBytes: number;
  zoom: [number, number];
}

export type BboxProgressCallback = (
  done: number,
  total: number,
  phase: string,
) => void;

/** Pre-defined neighbourhood bounding boxes for quick selection. */
export const BBOX_PRESETS: { label: string; bbox: CityBounds }[] = [
  {
    label: "Plateau-Mont-Royal",
    bbox: { minLat: 45.514, maxLat: 45.535, minLon: -73.582, maxLon: -73.548 },
  },
  {
    label: "Rosemont",
    bbox: { minLat: 45.538, maxLat: 45.563, minLon: -73.593, maxLon: -73.554 },
  },
  {
    label: "Ahuntsic",
    bbox: { minLat: 45.553, maxLat: 45.580, minLon: -73.666, maxLon: -73.620 },
  },
  {
    label: "Verdun",
    bbox: { minLat: 45.453, maxLat: 45.478, minLon: -73.590, maxLon: -73.550 },
  },
  {
    label: "Saint-Laurent",
    bbox: { minLat: 45.495, maxLat: 45.522, minLon: -73.730, maxLon: -73.690 },
  },
  {
    label: "LaSalle",
    bbox: { minLat: 45.428, maxLat: 45.455, minLon: -73.650, maxLon: -73.605 },
  },
  {
    label: "Outremont",
    bbox: { minLat: 45.512, maxLat: 45.530, minLon: -73.612, maxLon: -73.580 },
  },
  {
    label: "NDG",
    bbox: { minLat: 45.468, maxLat: 45.495, minLon: -73.648, maxLon: -73.608 },
  },
  {
    label: "Ville-Émard",
    bbox: { minLat: 45.457, maxLat: 45.478, minLon: -73.618, maxLon: -73.582 },
  },
  {
    label: "Côte-des-Neiges",
    bbox: { minLat: 45.491, maxLat: 45.516, minLon: -73.648, maxLon: -73.614 },
  },
];

// ─── Tile math ─────────────────────────────────────────────────────

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * (1 << z));
}

function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      (1 << z),
  );
}

function enumerateTiles(
  bbox: CityBounds,
  minZ = BBOX_MIN_ZOOM,
  maxZ = BBOX_MAX_ZOOM,
): { z: number; x: number; y: number }[] {
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const xMin = lonToTileX(bbox.minLon, z);
    const xMax = lonToTileX(bbox.maxLon, z);
    const yMin = latToTileY(bbox.maxLat, z);
    const yMax = latToTileY(bbox.minLat, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

// ─── Storage helpers ───────────────────────────────────────────────

function getStorageBase(): string {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) throw new Error("No file system directory available");
  return base;
}

function getRegionDir(regionId: string): string {
  return `${getStorageBase()}overture/${regionId}`;
}

function getTilePath(regionId: string, z: number, x: number, y: number): string {
  return `${getRegionDir(regionId)}/${z}/${x}/${y}.pbf`;
}

export function getRegionTileDir(regionId: string): string {
  return getRegionDir(regionId);
}

// ─── Estimation ───────────────────────────────────────────────────

export function estimateBboxDownload(bbox: CityBounds): BboxDownloadEstimate {
  const tiles = enumerateTiles(bbox);
  let estimatedBytes = 0;
  for (const t of tiles) {
    estimatedBytes += AVG_TILE_BYTES[t.z] ?? 25_000;
  }
  return { tileCount: tiles.length, estimatedBytes, zoom: [BBOX_MIN_ZOOM, BBOX_MAX_ZOOM] };
}

// ─── Download ─────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Download tiles for a custom bounding box from the R2 PMTiles file.
 * Creates a DownloadedRegion (source "r2_bbox") usable for offline extraction.
 */
export async function downloadBboxRegion(
  name: string,
  bbox: CityBounds,
  onProgress?: BboxProgressCallback,
  signal?: AbortSignal,
): Promise<{ success: boolean; regionId: string; tileCount: number; sizeBytes: number; error?: string }> {
  const tiles = enumerateTiles(bbox);
  if (tiles.length === 0) {
    return { success: false, regionId: "", tileCount: 0, sizeBytes: 0, error: "No tiles in bounding box" };
  }
  if (tiles.length > 5000) {
    return {
      success: false, regionId: "", tileCount: 0, sizeBytes: 0,
      error: `Too many tiles (${tiles.length}). Reduce your bounding box or zoom range.`,
    };
  }

  const regionId = `bbox_${Date.now()}`;
  const regionDir = getRegionDir(regionId);

  onProgress?.(0, tiles.length, "Opening PMTiles…");

  let reader: { getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined> };
  try {
    const { PMTiles } = require("pmtiles");
    const url = `${R2_PUBLIC_BASE}/tiles/${PMTILES_FILE}-${PMTILES_VERSION}.pmtiles`;
    reader = new PMTiles(url);
  } catch (err) {
    return { success: false, regionId: "", tileCount: 0, sizeBytes: 0, error: `Failed to open PMTiles: ${err instanceof Error ? err.message : String(err)}` };
  }

  const dirInfo = await FileSystem.getInfoAsync(regionDir, { size: false });
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(regionDir, { intermediates: true });
  }

  let downloaded = 0;
  let skipped = 0;
  let totalBytes = 0;
  let lastProgressTime = 0;

  for (let i = 0; i < tiles.length; i++) {
    if (signal?.aborted) {
      // Clean up partial download
      await FileSystem.deleteAsync(regionDir, { idempotent: true }).catch(() => {});
      return { success: false, regionId: "", tileCount: downloaded, sizeBytes: totalBytes, error: "Cancelled" };
    }

    const { z, x, y } = tiles[i];
    const tilePath = getTilePath(regionId, z, x, y);

    try {
      const tileDir = tilePath.substring(0, tilePath.lastIndexOf("/"));
      const tdInfo = await FileSystem.getInfoAsync(tileDir, { size: false });
      if (!tdInfo.exists) {
        await FileSystem.makeDirectoryAsync(tileDir, { intermediates: true });
      }

      const result = await reader.getZxy(z, x, y);
      if (result?.data && result.data.byteLength > 0) {
        await FileSystem.writeAsStringAsync(tilePath, arrayBufferToBase64(result.data), {
          encoding: FileSystem.EncodingType.Base64,
        });
        totalBytes += result.data.byteLength;
        downloaded++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }

    const now = Date.now();
    if (now - lastProgressTime >= PROGRESS_THROTTLE_MS || i === tiles.length - 1) {
      onProgress?.(i + 1, tiles.length, `Downloading tiles… (${downloaded} saved, ${skipped} empty)`);
      lastProgressTime = now;
    }
  }

  if (downloaded === 0) {
    await FileSystem.deleteAsync(regionDir, { idempotent: true }).catch(() => {});
    return { success: false, regionId: "", tileCount: 0, sizeBytes: 0, error: "No tile data returned — check that the bounding box is within the PMTiles coverage area" };
  }

  // Register as DownloadedRegion
  const region: DownloadedRegion = {
    id: regionId,
    name,
    country: "CA",
    bounds: bbox,
    fileCount: downloaded,
    sizeBytes: totalBytes,
    downloadedAt: Date.now(),
    layers: ["transportation"],
    source: "r2_bbox",
    dataVersion: PMTILES_VERSION,
  };

  await saveDownloadedRegion(region);

  return { success: true, regionId, tileCount: downloaded, sizeBytes: totalBytes };
}

// ─── Delete ───────────────────────────────────────────────────────

export async function deleteBboxRegion(regionId: string): Promise<void> {
  const dir = getRegionDir(regionId);
  try {
    const info = await FileSystem.getInfoAsync(dir, { size: false });
    if (info.exists) await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {}
  await deleteDownloadedRegionById(regionId);
}

// ─── Tile access for extraction ───────────────────────────────────

/**
 * Read a saved tile as ArrayBuffer, or null if the tile wasn't downloaded.
 */
export async function getBboxRegionTile(
  regionId: string,
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer | null> {
  const path = getTilePath(regionId, z, x, y);
  try {
    const info = await FileSystem.getInfoAsync(path, { size: false });
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

/**
 * Enumerate the tile coordinates stored for a region (based on saved files).
 * Used by the extraction pipeline to know which tiles to read.
 */
export function enumerateBboxTiles(
  bbox: CityBounds,
): { z: number; x: number; y: number }[] {
  return enumerateTiles(bbox);
}
