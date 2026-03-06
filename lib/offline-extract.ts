/**
 * Offline extraction from downloaded R2 PMTiles, S3 Parquet, or OSM PBF.
 * Uses data already downloaded via Settings → Offline Map Download.
 * When the webovertureextract WebSocket is unavailable (offline), we fall back to this.
 */

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getDownloadedRegions, getRegionDataDir } from "@/lib/offline-map-download";
import type { DownloadedRegion } from "@/lib/offline-map-download";
import type { GeoJSONFeatureCollection } from "@/services/overtureOptimizerService";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type { Feature, Polygon } from "geojson";
import { OSMParser } from "@/lib/route-optimizer-v2/osmParser";

const PMTILES_VERSION = "v2026-02";
const EXTRACT_MIN_ZOOM = 12;
const EXTRACT_MAX_ZOOM = 14;
const MVT_EXTENT = 4096;

/** Bbox in lat/lon */
interface BBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function bboxFromPolygon(coords: [number, number][]): BBox {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function bboxOverlaps(a: BBox, b: { minLat: number; maxLat: number; minLon: number; maxLon: number }): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLon <= b.maxLon && a.maxLon >= b.minLon;
}

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * (1 << z));
}

function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * (1 << z)
  );
}

/** Tile (z,x,y) to lon/lat for a point (xt, yt) in tile coordinates [0..MVT_EXTENT]. */
function tileToLonLat(z: number, x: number, y: number, xt: number, yt: number): [number, number] {
  const n = 1 << z;
  const lon = (x + xt / MVT_EXTENT) / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1 - yt / MVT_EXTENT)) / n)));
  const lat = (latRad * 180) / Math.PI;
  return [lon, lat];
}

/** Enumerate tile coords for a bbox at zoom levels [minZ, maxZ]. */
function enumerateTiles(bbox: BBox, minZ: number, maxZ: number): Array<{ z: number; x: number; y: number }> {
  const tiles: Array<{ z: number; x: number; y: number }> = [];
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

/** PMTiles Source that reads from an in-memory buffer (for local file). */
function createBufferSource(buffer: ArrayBuffer): { getBytes: (offset: number, length: number) => Promise<{ data?: ArrayBuffer }>; getKey: () => string } {
  const u8 = new Uint8Array(buffer);
  return {
    getBytes: async (offset: number, length: number) => {
      const end = Math.min(offset + length, u8.length);
      if (offset >= u8.length) return {};
      const len = end - offset;
      const out = new ArrayBuffer(len);
      new Uint8Array(out).set(u8.subarray(offset, end));
      return { data: out };
    },
    getKey: () => "local-pmtiles",
  };
}

/** Decode MVT tile buffer to GeoJSON features (LineStrings). Layer name varies (transportation, road, etc.). */
function decodeMvtToFeatures(
  buffer: ArrayBuffer,
  z: number,
  tx: number,
  ty: number,
  polygon: Polygon,
): Array<Feature<GeoJSON.LineString, Record<string, unknown>>> {
  const features: Array<Feature<GeoJSON.LineString, Record<string, unknown>>> = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const VectorTile = require("@mapbox/vector-tile").VectorTile;
    const tile = new VectorTile(new Uint8Array(buffer));
    const layerNames = Object.keys(tile.layers || {});
    for (const layerName of layerNames) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        const geom = feature.loadGeometry();
        if (!geom || geom.length === 0) continue;
        for (const ring of geom) {
          if (ring.length < 2) continue;
          const coords: [number, number][] = ring.map(
            (p: { x: number; y: number }) => tileToLonLat(z, tx, ty, p.x, p.y)
          );
          // Keep if any vertex is inside the polygon (simple filter; could clip exactly)
          const inside = coords.some((c) => booleanPointInPolygon([c[0], c[1]], polygon));
          if (!inside) continue;
          const props: Record<string, unknown> = {};
          if (feature.properties) {
            for (const k of Object.keys(feature.properties)) {
              props[k] = feature.properties[k];
            }
          }
          features.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: props,
          });
        }
      }
    }
  } catch (e) {
    console.warn("[offline-extract] MVT decode error:", e);
  }
  return features;
}

export interface OfflineExtractProgress {
  phase: string;
  done?: number;
  total?: number;
}

export interface OfflineExtractResult {
  geojson: GeoJSONFeatureCollection;
  source: "r2" | "s3" | "osm_pbf";
  regionId: string;
  regionName: string;
}

/**
 * Find a downloaded region (R2, S3, or OSM PBF) whose bounds overlap the polygon.
 */
export async function findRegionForPolygon(polygonCoords: [number, number][]): Promise<DownloadedRegion | null> {
  const bbox = bboxFromPolygon(polygonCoords);
  const regions = await getDownloadedRegions();
  if (!regions || regions.length === 0) return null;
  for (const r of regions) {
    if (bboxOverlaps(bbox, r.bounds)) return r;
  }
  return null;
}

/**
 * Extract road GeoJSON from downloaded R2 PMTiles for the given polygon.
 * Uses the local .pmtiles file for the region. Returns features that intersect the polygon.
 */
export async function extractFromR2Tiles(
  region: DownloadedRegion,
  polygon: Polygon,
  onProgress?: (p: OfflineExtractProgress) => void,
): Promise<GeoJSONFeatureCollection> {
  if (region.source !== "r2") {
    throw new Error("Region is not R2 PMTiles");
  }
  const regionDir = getRegionDataDir(region.id);
  const filename = `${region.id}-${PMTILES_VERSION}.pmtiles`;
  const localPath = `${regionDir}/${filename}`;

  const info = await FileSystem.getInfoAsync(localPath, { size: false });
  if (!info.exists) {
    throw new Error(`Offline R2 file not found: ${filename}. Re-download the region in Settings.`);
  }

  onProgress?.({ phase: "Reading PMTiles file…" });
  const base64 = await FileSystem.readAsStringAsync(localPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = bytes.buffer;

  const PMTiles = require("pmtiles").PMTiles;
  const source = createBufferSource(buffer);
  const pmtiles = new PMTiles(source);

  const coords = polygon.coordinates[0];
  const bbox = bboxFromPolygon(coords);
  const tiles = enumerateTiles(bbox, EXTRACT_MIN_ZOOM, EXTRACT_MAX_ZOOM);

  onProgress?.({ phase: "Extracting tiles…", done: 0, total: tiles.length });

  const allFeatures: Array<Feature<GeoJSON.LineString, Record<string, unknown>>> = [];
  const seen = new Set<string>();

  for (let i = 0; i < tiles.length; i++) {
    const { z, x, y } = tiles[i];
    const result = await pmtiles.getZxy(z, x, y);
    if (result?.data && result.data.byteLength > 0) {
      const feats = decodeMvtToFeatures(result.data, z, x, y, polygon);
      for (const f of feats) {
        const key = JSON.stringify(f.geometry.coordinates);
        if (seen.has(key)) continue;
        seen.add(key);
        allFeatures.push(f);
      }
    }
    if ((i + 1) % 10 === 0 || i === tiles.length - 1) {
      onProgress?.({ phase: "Extracting tiles…", done: i + 1, total: tiles.length });
    }
  }

  return {
    type: "FeatureCollection",
    features: allFeatures,
  };
}

/**
 * Extract from S3 Parquet (downloaded). Reads local Parquet files from the region dir,
 * decodes WKB geometry, filters by polygon and subtype=road, returns GeoJSON.
 * Implementation lives in offline-extract-parquet.ts (native) / .web.ts (web stub) so
 * apache-arrow is never bundled for web (Vercel).
 */
export async function extractFromS3Parquet(
  region: DownloadedRegion,
  polygon: Polygon,
  onProgress?: (p: OfflineExtractProgress) => void,
): Promise<GeoJSONFeatureCollection> {
  // Explicit paths so web bundle never includes apache-arrow (offline-extract-parquet.ts)
  const mod =
    Platform.OS === "web"
      ? await import("./offline-extract-parquet.web")
      : await import("./offline-extract-parquet");
  return mod.extractFromS3ParquetImpl(region, polygon, onProgress);
}

/**
 * Extract road GeoJSON from a downloaded OSM PBF (.osm XML) file.
 * Parses the XML with OSMParser, converts ways to GeoJSON LineString features,
 * and filters by polygon intersection.
 */
export async function extractFromOSMPBF(
  region: DownloadedRegion,
  polygon: Polygon,
  onProgress?: (p: OfflineExtractProgress) => void,
): Promise<GeoJSONFeatureCollection> {
  if (region.source !== "osm_pbf") {
    throw new Error("Region is not OSM PBF");
  }
  const cityId = region.cityId ?? region.id.replace(/_osm_pbf$/, "");
  const regionDir = getRegionDataDir(cityId);
  const localPath = `${regionDir}/${cityId}.osm`;

  const info = await FileSystem.getInfoAsync(localPath, { size: false });
  if (!info.exists) {
    throw new Error(`Offline OSM file not found: ${cityId}.osm. Re-download in Settings.`);
  }

  onProgress?.({ phase: "Reading OSM file…" });
  const osmContent = await FileSystem.readAsStringAsync(localPath, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  onProgress?.({ phase: "Parsing OSM data…" });
  const parser = new OSMParser();
  const { nodes, ways } = parser.parseOSM(osmContent);

  onProgress?.({ phase: "Building GeoJSON features…", done: 0, total: ways.length });

  const features: Array<Feature<GeoJSON.LineString, Record<string, unknown>>> = [];
  const seen = new Set<string>();

  for (let i = 0; i < ways.length; i++) {
    const way = ways[i];
    const coords: [number, number][] = [];
    for (const nodeId of way.nodes) {
      const node = nodes.get(nodeId);
      if (node) coords.push([node.lon, node.lat]);
    }
    if (coords.length < 2) continue;

    const inside = coords.some((c) => booleanPointInPolygon([c[0], c[1]], polygon));
    if (!inside) continue;

    const key = way.id;
    if (seen.has(key)) continue;
    seen.add(key);

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        id: way.id,
        highway: way.tags.highway,
        name: way.tags.name,
        class: way.tags.highway,
      },
    });

    if ((i + 1) % 500 === 0 || i === ways.length - 1) {
      onProgress?.({ phase: "Building GeoJSON features…", done: i + 1, total: ways.length });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Run offline extraction using downloaded data (R2, S3, or OSM PBF).
 * Tries whichever source the matching region was downloaded from.
 */
export async function extractFromDownloadedData(
  polygon: Polygon,
  onProgress?: (p: OfflineExtractProgress) => void,
): Promise<OfflineExtractResult | null> {
  const coords = polygon.coordinates[0];
  if (!coords || coords.length < 3) return null;

  const region = await findRegionForPolygon(coords);
  if (!region) {
    return null;
  }

  if (region.source === "r2") {
    onProgress?.({ phase: "Using R2 tiles…" });
    const geojson = await extractFromR2Tiles(region, polygon, onProgress);
    return { geojson, source: "r2", regionId: region.id, regionName: region.name };
  }

  if (region.source === "s3") {
    try {
      onProgress?.({ phase: "Using S3 Parquet…" });
      const geojson = await extractFromS3Parquet(region, polygon, onProgress);
      return { geojson, source: "s3", regionId: region.id, regionName: region.name };
    } catch {
      return null;
    }
  }

  if (region.source === "osm_pbf") {
    try {
      onProgress?.({ phase: "Using downloaded OSM data…" });
      const geojson = await extractFromOSMPBF(region, polygon, onProgress);
      return { geojson, source: "osm_pbf", regionId: region.id, regionName: region.name };
    } catch (e) {
      console.warn("[offline-extract] OSM PBF extraction failed:", e);
      return null;
    }
  }

  return null;
}
