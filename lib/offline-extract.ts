/**
 * Offline extraction from downloaded R2 PMTiles, S3 Parquet, or OSM PBF.
 * Uses data already downloaded via Settings → Offline Map Download.
 * When the webovertureextract WebSocket is unavailable (offline), we fall back to this.
 */

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getDownloadedRegions, getRegionDataDir } from "@/lib/offline-map-download";
import type { DownloadedRegion } from "@/lib/offline-map-download";
import type {
  GeoJSONFeatureCollection,
  FilterResponse,
} from "@/services/overtureOptimizerService";
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

export interface RoadGraphStats {
  nodes: number;
  edges: number;
  roads: number;
  segmentsLengthKm: number;
}

export interface RoadGraphResult {
  geojson: GeoJSONFeatureCollection;
  stats: RoadGraphStats;
}

export interface OfflineExtractResult {
  geojson: GeoJSONFeatureCollection;
  /** Road graph edges — output of the local building_graph stage. */
  graphGeojson: GeoJSONFeatureCollection;
  stats: RoadGraphStats;
  source: "r2" | "s3" | "osm_pbf";
  regionId: string;
  regionName: string;
}

/**
 * Get road class from a GeoJSON feature (OSM/Overture property names).
 */
function getRoadClass(props: Record<string, unknown> | undefined): string {
  if (!props) return "";
  const v =
    props.class ?? props.road_class ?? props.highway ?? props.category;
  return typeof v === "string" ? v.toLowerCase().trim() : "";
}

// ---------------------------------------------------------------------------
// Road graph building (replicates the backend's building_graph stage)
// ---------------------------------------------------------------------------

/** Haversine distance in km between two [lon, lat] points. */
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function coordLengthKm(coords: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversineKm(coords[i - 1], coords[i]);
  return d;
}

/** Round to 6 decimal places (≈ 11 cm) for coordinate snapping. */
function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function ck(lon: number, lat: number): string {
  return `${roundCoord(lon)},${roundCoord(lat)}`;
}

/**
 * Build a topology-aware road graph from raw GeoJSON LineString features.
 * Finds intersections, splits road segments at them, assigns node/edge IDs,
 * and computes length + estimated travel time for each edge.
 *
 * This replicates the backend's `building_graph` stage for offline use.
 * The returned GeoJSON is compatible with `partitionZonesFromGeoJSON`.
 */
export function buildRoadGraph(rawGeojson: GeoJSONFeatureCollection): RoadGraphResult {
  const features = (rawGeojson.features ?? []).filter(
    (f): f is Feature<GeoJSON.LineString, Record<string, unknown>> =>
      f.geometry?.type === "LineString" &&
      Array.isArray((f.geometry as GeoJSON.LineString).coordinates) &&
      (f.geometry as GeoJSON.LineString).coordinates.length >= 2,
  );

  if (features.length === 0) {
    return {
      geojson: { type: "FeatureCollection", features: [] },
      stats: { nodes: 0, edges: 0, roads: 0, segmentsLengthKm: 0 },
    };
  }

  // Map each snapped coordinate key → set of feature indices that share it.
  const coordUsage = new Map<string, Set<number>>();
  for (let fi = 0; fi < features.length; fi++) {
    const coords = features[fi].geometry.coordinates as [number, number][];
    for (const [lon, lat] of coords) {
      const k = ck(lon, lat);
      if (!coordUsage.has(k)) coordUsage.set(k, new Set());
      coordUsage.get(k)!.add(fi);
    }
  }

  // A coordinate is a graph node if:
  //   - it is the first or last point of any feature (dead end / segment end), or
  //   - it is shared by 2+ different features (intersection).
  const nodeKeySet = new Set<string>();
  for (let fi = 0; fi < features.length; fi++) {
    const coords = features[fi].geometry.coordinates as [number, number][];
    nodeKeySet.add(ck(coords[0][0], coords[0][1]));
    nodeKeySet.add(ck(coords[coords.length - 1][0], coords[coords.length - 1][1]));
  }
  for (const [k, uses] of coordUsage) {
    if (uses.size >= 2) nodeKeySet.add(k);
  }

  // Assign stable node IDs.
  const nodeIdMap = new Map<string, string>();
  let nodeCounter = 0;
  for (const k of nodeKeySet) {
    nodeIdMap.set(k, `n${nodeCounter++}`);
  }

  // Split each feature at intersection nodes → directed graph edges.
  const edgeFeatures: Array<Feature<GeoJSON.LineString, Record<string, unknown>>> = [];
  let edgeCounter = 0;
  let totalLengthKm = 0;

  for (const feat of features) {
    const coords = feat.geometry.coordinates as [number, number][];
    const props = feat.properties ?? {};
    const roadClass = getRoadClass(props);
    const name = typeof props.name === "string" ? props.name : undefined;

    // Collect coordinate indices where we must split.
    const splits: number[] = [0];
    for (let i = 1; i < coords.length - 1; i++) {
      if (nodeKeySet.has(ck(coords[i][0], coords[i][1]))) splits.push(i);
    }
    splits.push(coords.length - 1);

    for (let s = 0; s < splits.length - 1; s++) {
      const fromIdx = splits[s];
      const toIdx = splits[s + 1];
      if (fromIdx >= toIdx) continue;
      const segCoords = coords.slice(fromIdx, toIdx + 1) as [number, number][];
      if (segCoords.length < 2) continue;

      const fromKey = ck(segCoords[0][0], segCoords[0][1]);
      const toKey = ck(segCoords[segCoords.length - 1][0], segCoords[segCoords.length - 1][1]);
      const fromNodeId = nodeIdMap.get(fromKey) ?? `n${nodeCounter++}`;
      const toNodeId = nodeIdMap.get(toKey) ?? `n${nodeCounter++}`;
      const lengthKm = coordLengthKm(segCoords);
      totalLengthKm += lengthKm;

      edgeFeatures.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: segCoords },
        properties: {
          id: `e${edgeCounter}`,
          from_node: fromNodeId,
          to_node: toNodeId,
          length_km: Math.round(lengthKm * 10000) / 10000,
          travel_time_sec: Math.round((lengthKm / 30) * 3600), // 30 km/h default
          road_class: roadClass,
          ...(name ? { name } : {}),
        },
      });
      edgeCounter++;
    }
  }

  return {
    geojson: { type: "FeatureCollection", features: edgeFeatures },
    stats: {
      nodes: nodeCounter,
      edges: edgeCounter,
      roads: features.length,
      segmentsLengthKm: Math.round(totalLengthKm * 100) / 100,
    },
  };
}

/**
 * Filter GeoJSON road features by road class (and optionally polygon) locally.
 * Use when backend filterGeoJSON is unavailable (offline). Matches FilterResponse shape.
 */
export function filterGeoJSONLocal(params: {
  geojson: GeoJSONFeatureCollection;
  polygon?: Array<{ lat: number; lon: number }>;
  road_classes: string[];
}): FilterResponse {
  const allow = new Set(
    params.road_classes.map((c) => c.toLowerCase().trim()),
  );
  const polygon =
    params.polygon && params.polygon.length >= 3
      ? ({
          type: "Polygon" as const,
          coordinates: [
            params.polygon.map((p) => [p.lon, p.lat] as [number, number]),
          ],
        } as Polygon)
      : null;

  const features = (params.geojson.features ?? []).filter((f) => {
    const cls = getRoadClass(f.properties);
    if (!allow.has(cls)) return false;
    if (polygon && f.geometry?.type === "LineString") {
      const coords = f.geometry.coordinates as [number, number][];
      // Keep feature if ANY coordinate falls inside the polygon
      const anyInside = coords.some((c) => booleanPointInPolygon(c, polygon!));
      if (!anyInside) return false;
    }
    return true;
  });

  const road_class_counts: Record<string, number> = {};
  for (const f of features) {
    const cls = getRoadClass(f.properties) || "unknown";
    road_class_counts[cls] = (road_class_counts[cls] ?? 0) + 1;
  }

  return {
    geojson: { type: "FeatureCollection", features },
    feature_count: features.length,
    road_class_counts,
  };
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

  let geojson: GeoJSONFeatureCollection | null = null;
  let source: "r2" | "s3" | "osm_pbf";

  if (region.source === "r2") {
    onProgress?.({ phase: "Using R2 tiles…" });
    geojson = await extractFromR2Tiles(region, polygon, onProgress);
    source = "r2";
  } else if (region.source === "s3") {
    try {
      onProgress?.({ phase: "Using S3 Parquet…" });
      geojson = await extractFromS3Parquet(region, polygon, onProgress);
      source = "s3";
    } catch {
      return null;
    }
  } else if (region.source === "osm_pbf") {
    try {
      onProgress?.({ phase: "Using downloaded OSM data…" });
      geojson = await extractFromOSMPBF(region, polygon, onProgress);
      source = "osm_pbf";
    } catch (e) {
      console.warn("[offline-extract] OSM PBF extraction failed:", e);
      return null;
    }
  } else {
    return null;
  }

  if (!geojson) return null;

  onProgress?.({ phase: "Building road graph…" });
  const { geojson: graphGeojson, stats } = buildRoadGraph(geojson);

  return { geojson, graphGeojson, stats, source: source!, regionId: region.id, regionName: region.name };
}
