/**
 * Web stub: Parquet extraction is not available on web (requires apache-arrow).
 * Metro resolves this file when building for web so apache-arrow is never loaded.
 */

import type { DownloadedRegion } from "@/lib/offline-map-download";
import type { GeoJSONFeatureCollection } from "@/services/overtureOptimizerService";
import type { Polygon } from "geojson";

export type OfflineExtractProgress = { phase: string; done?: number; total?: number };

export async function extractFromS3ParquetImpl(
  _region: DownloadedRegion,
  _polygon: Polygon,
  _onProgress?: (p: OfflineExtractProgress) => void,
): Promise<GeoJSONFeatureCollection> {
  throw new Error(
    "Parquet extraction is not available on web. Use the mobile app for offline S3 Parquet extraction.",
  );
}
