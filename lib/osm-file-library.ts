/**
 * Persistent OSM File Library
 *
 * Stores imported OSM files so users don't have to re-import every time.
 * Each entry stores the raw XML content, metadata, and a display name.
 * Uses AsyncStorage with a manifest + individual content keys to avoid
 * loading all file contents when listing.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

const MANIFEST_KEY = "@trashroute:osm_library_manifest";
const CONTENT_PREFIX = "@trashroute:osm_file:";
/** Directory for OSM file content stored on the file system (native only). */
const OSM_FILES_DIR = "osm_library";

/** Get the base storage directory, guaranteed non-empty. Throws if unavailable. */
function getStorageBase(): string {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) throw new Error("No file system directory available");
  return base;
}

/** Get the file path for an OSM file's content on the file system. */
function getOSMFilePath(id: string): string {
  return `${getStorageBase()}${OSM_FILES_DIR}/${id}.osm`;
}

/** Estimate byte length of a string (UTF-8). */
function estimateByteLength(str: string): number {
  // Fast estimate: ASCII chars = 1 byte, others ≈ 2-3 bytes
  // For OSM XML (mostly ASCII), str.length is close enough
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str).byteLength;
  }
  return str.length;
}

/** Max stored files to prevent unbounded storage growth. */
const MAX_FILES = 20;

/** AsyncStorage has ~2MB per-key limit on Android; web often similar. Avoid truncation/corruption by rejecting oversize content on web. */
const MAX_CONTENT_BYTES_WEB = 1.5 * 1024 * 1024;

export interface OSMFileEntry {
  /** Unique identifier (timestamp-based). */
  id: string;
  /** Display name (filename without extension, editable). */
  name: string;
  /** ISO timestamp of when the file was imported. */
  importedAt: string;
  /** File size in bytes (of the raw XML). */
  sizeBytes: number;
  /** Number of ways parsed from the file. */
  wayCount: number;
  /** Number of nodes parsed from the file. */
  nodeCount: number;
  /** Bounding box of the OSM data. */
  bounds?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

/** Load the manifest (list of stored files without content). */
export async function listOSMFiles(): Promise<OSMFileEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OSMFileEntry[];
  } catch {
    return [];
  }
}

/** Save a new OSM file to the library. Returns the new entry. Throws if content cannot be stored (e.g. too large on web). */
export async function saveOSMFile(
  xmlContent: string,
  options: {
    name: string;
    wayCount: number;
    nodeCount: number;
    bounds?: OSMFileEntry["bounds"];
  }
): Promise<OSMFileEntry> {
  const id = `osm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sizeBytes = estimateByteLength(xmlContent);
  const entry: OSMFileEntry = {
    id,
    name: options.name,
    importedAt: new Date().toISOString(),
    sizeBytes,
    wayCount: options.wayCount,
    nodeCount: options.nodeCount,
    bounds: options.bounds,
  };

  const manifest = await listOSMFiles();

  // Enforce max files — remove oldest if at limit
  if (manifest.length >= MAX_FILES) {
    const oldest = manifest[manifest.length - 1]!;
    await removeOSMContent(oldest.id);
    manifest.pop();
  }

  // Write content first so we never add a manifest entry for content that failed to write (avoids corrupted/missing segments on load).
  await writeOSMContent(id, xmlContent);

  // Then update manifest so the new entry is only listed after content is safely stored.
  manifest.unshift(entry);
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));

  return entry;
}

/** Write OSM content to FileSystem (native) or AsyncStorage (web fallback). Throws if content is too large (web) or write fails. */
async function writeOSMContent(id: string, content: string): Promise<void> {
  if (Platform.OS === "web") {
    const bytes = estimateByteLength(content);
    if (bytes > MAX_CONTENT_BYTES_WEB) {
      throw new Error(
        `OSM file is too large to save in the library on this device (${(bytes / 1024 / 1024).toFixed(1)} MB). ` +
          `Maximum is about ${(MAX_CONTENT_BYTES_WEB / 1024 / 1024).toFixed(1)} MB. Use a smaller extract or open the file directly each time.`
      );
    }
    await AsyncStorage.setItem(CONTENT_PREFIX + id, content);
    return;
  }
  const path = getOSMFilePath(id);
  const dir = path.substring(0, path.lastIndexOf("/"));
  const dirInfo = await FileSystem.getInfoAsync(dir, { size: false });
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  await FileSystem.writeAsStringAsync(path, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/** Remove OSM content from FileSystem (native) or AsyncStorage (web fallback). */
async function removeOSMContent(id: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(CONTENT_PREFIX + id);
    return;
  }
  try {
    const path = getOSMFilePath(id);
    const info = await FileSystem.getInfoAsync(path, { size: false });
    if (info.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
    }
  } catch (err) {
    console.warn("[OSMLibrary] Failed to remove file for", id, err);
  }
}

/** Load the raw XML content for a stored file. */
export async function loadOSMFileContent(id: string): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return await AsyncStorage.getItem(CONTENT_PREFIX + id);
    }
    const path = getOSMFilePath(id);
    const info = await FileSystem.getInfoAsync(path, { size: false });
    if (!info.exists) {
      // Fallback: try AsyncStorage for files saved before migration
      return await AsyncStorage.getItem(CONTENT_PREFIX + id);
    }
    return await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (err) {
    console.warn("[OSMLibrary] Failed to load file", id, err);
    return null;
  }
}

/** Delete a stored OSM file. */
export async function deleteOSMFile(id: string): Promise<void> {
  const manifest = await listOSMFiles();
  const filtered = manifest.filter((e) => e.id !== id);
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(filtered));
  await removeOSMContent(id);
}

/** Rename a stored OSM file. */
export async function renameOSMFile(id: string, newName: string): Promise<void> {
  const manifest = await listOSMFiles();
  const entry = manifest.find((e) => e.id === id);
  if (entry) {
    entry.name = newName;
    await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  }
}

/** Clear the entire OSM file library. */
export async function clearOSMLibrary(): Promise<void> {
  const manifest = await listOSMFiles();
  // Remove all content (FileSystem + legacy AsyncStorage keys)
  for (const entry of manifest) {
    await removeOSMContent(entry.id);
  }
  // Also clean up any legacy AsyncStorage content keys
  const legacyKeys = manifest.map((e) => CONTENT_PREFIX + e.id);
  legacyKeys.push(MANIFEST_KEY);
  await AsyncStorage.multiRemove(legacyKeys);
}

/** Format bytes as human-readable string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
