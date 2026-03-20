import type { Polygon, FeatureCollection } from "geojson";

export interface FilterResponse {
  geojson: FeatureCollection;
  feature_count: number;
}

export async function extractFromDownloadedData(
  polygon: Polygon,
  onProgress?: (p: { phase: string; done: number; total: number }) => void,
): Promise<any | null> {
  // Offline extraction is not supported on web
  throw new Error("Offline extraction not available on web");
}

export async function findRegionForPolygon(
  coords: [number, number][],
): Promise<any | null> {
  return null;
}

export function filterGeoJSONLocal(params: {
  geojson: FeatureCollection;
  polygon?: Array<{ lat: number; lon: number }>;
  road_classes: string[];
}): FilterResponse {
  return {
    geojson: { type: "FeatureCollection", features: [] },
    feature_count: 0,
  };
}
