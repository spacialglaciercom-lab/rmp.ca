/**
 * Native implementation: S3 Parquet extraction using apache-arrow + parquet-wasm.
 * Only loaded on native (Metro uses .web.ts for web so apache-arrow is never bundled there).
 */

import * as FileSystem from "expo-file-system/legacy";
import { getRegionDataDir } from "@/lib/offline-map-download";
import type { DownloadedRegion } from "@/lib/offline-map-download";
import type { GeoJSONFeatureCollection } from "@/services/overtureOptimizerService";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type { Feature, Polygon } from "geojson";

export type OfflineExtractProgress = {
  phase: string;
  done?: number;
  total?: number;
};

export async function extractFromS3ParquetImpl(
  region: DownloadedRegion,
  polygon: Polygon,
  onProgress?: (p: OfflineExtractProgress) => void,
): Promise<GeoJSONFeatureCollection> {
  if (region.source !== "s3") {
    throw new Error("Region is not S3 Parquet");
  }
  const regionDir = getRegionDataDir(region.id);
  const dirInfo = await FileSystem.getInfoAsync(regionDir, { size: false });
  if (!dirInfo.exists) {
    throw new Error(
      `Offline S3 data directory not found. Re-download the region in Settings.`,
    );
  }

  const allFiles = await FileSystem.readDirectoryAsync(regionDir);
  const parquetFiles = allFiles
    .filter((f) => f.endsWith(".parquet"))
    .sort((a, b) => {
      const aSeg = a.includes("segment") ? 0 : 1;
      const bSeg = b.includes("segment") ? 0 : 1;
      return aSeg - bSeg;
    });

  if (parquetFiles.length === 0) {
    throw new Error(
      "No Parquet files found in offline region. Re-download S3 Parquet in Settings.",
    );
  }

  const { tableFromIPC } = await import("apache-arrow");
  const parquetWasm = await import("parquet-wasm");
  const wkx = await import("wkx");
  const { Buffer } = await import("buffer");

  let wasmInit: (() => Promise<void>) | null = null;
  try {
    wasmInit = parquetWasm.default;
    if (wasmInit) await wasmInit();
  } catch (e) {
    console.warn("[offline-extract] parquet-wasm init:", e);
  }

  const readParquet = parquetWasm.readParquet;
  if (!readParquet) {
    throw new Error("parquet-wasm readParquet not available");
  }

  const features: Array<Feature<GeoJSON.LineString, Record<string, unknown>>> =
    [];
  const seen = new Set<string>();

  for (let f = 0; f < parquetFiles.length; f++) {
    const filename = parquetFiles[f];
    const filePath = `${regionDir}/${filename}`;
    onProgress?.({
      phase: "Reading Parquet…",
      done: f,
      total: parquetFiles.length,
    });

    const base64 = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    let table: import("apache-arrow").Table;
    try {
      const wasmTable = readParquet(bytes);
      const ipcStream = wasmTable.intoIPCStream();
      table = tableFromIPC(ipcStream);
    } catch (e) {
      console.warn(`[offline-extract] Parquet read failed for ${filename}:`, e);
      continue;
    }

    const geometryCol = table.getChild("geometry");
    const classCol = table.getChild("class");
    const subtypeCol = table.getChild("subtype");
    if (!geometryCol) continue;

    const n = table.length;
    for (let i = 0; i < n; i++) {
      if (subtypeCol) {
        const sub = subtypeCol.get(i);
        if (sub !== null && sub !== undefined && String(sub) !== "road")
          continue;
      }
      const geomVal = geometryCol.get(i);
      if (geomVal == null) continue;
      const wkb =
        geomVal instanceof Uint8Array
          ? geomVal
          : new Uint8Array(geomVal as ArrayBuffer);
      let geom: { toGeoJSON: () => { type: string; coordinates: number[][] } };
      try {
        geom = wkx.Geometry.parse(Buffer.from(wkb)) as unknown as typeof geom;
      } catch {
        continue;
      }
      const geojsonGeom = geom.toGeoJSON();
      if (
        geojsonGeom.type !== "LineString" ||
        !Array.isArray(geojsonGeom.coordinates)
      )
        continue;
      const coords = geojsonGeom.coordinates as [number, number][];
      if (coords.length < 2) continue;
      const inside = coords.some((c) =>
        booleanPointInPolygon([c[0], c[1]], polygon),
      );
      if (!inside) continue;
      const key = JSON.stringify(coords);
      if (seen.has(key)) continue;
      seen.add(key);
      const roadClass = classCol ? classCol.get(i) : null;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          class: roadClass != null ? String(roadClass) : undefined,
          id: table.getChild("id")?.get(i),
        },
      });
    }
  }

  onProgress?.({
    phase: "Done",
    done: parquetFiles.length,
    total: parquetFiles.length,
  });

  return {
    type: "FeatureCollection",
    features,
  };
}
