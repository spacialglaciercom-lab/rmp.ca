/**
 * Shared GeoJSON import utilities.
 *
 * Provides common logic for importing GeoJSON files and optimizing routes
 * via the Python/FastAPI backend. Used by both the file picker (OSMImport)
 * and drag-and-drop (WebOSMDropZoneRoot) components.
 */

import {
  optimizeRoute,
  type GeoJSONFeatureCollection,
  type OptimizeResponse,
} from "@/services/overtureOptimizerService";
import { CollectionPoint } from "@/types";

export interface GeoJSONImportOptions {
  startLat?: number;
  startLon?: number;
  turnPenalties?: {
    leftTurn?: number;
    uTurn?: number;
    rightTurn?: number;
  };
}

export interface GeoJSONImportResult {
  collectionPoints: CollectionPoint[];
  totalDistanceKm: number;
  stats: {
    nodesInGraph: number;
    edgesInGraph: number;
  };
}

/**
 * Parse raw JSON content into a validated GeoJSON FeatureCollection.
 * Accepts both FeatureCollection and single Feature inputs.
 *
 * @throws Error if the content is not valid GeoJSON
 */
export function parseGeoJSON(content: string): GeoJSONFeatureCollection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Invalid JSON");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return obj as unknown as GeoJSONFeatureCollection;
  }

  if (obj.type === "Feature" && obj.geometry) {
    return {
      type: "FeatureCollection",
      features: [obj as unknown as GeoJSONFeatureCollection["features"][0]],
    };
  }

  throw new Error("JSON is not a valid GeoJSON FeatureCollection or Feature");
}

/**
 * Import GeoJSON and optimize route via the backend service.
 * Returns collection points ready for use in the app.
 *
 * @param geojson - Parsed GeoJSON FeatureCollection
 * @param options - Start coordinates and turn penalty configuration
 * @throws Error if the optimizer returns no route
 */
export async function importGeoJSONRoute(
  geojson: GeoJSONFeatureCollection,
  options: GeoJSONImportOptions = {}
): Promise<GeoJSONImportResult> {
  const { startLat, startLon, turnPenalties } = options;

  const optResult: OptimizeResponse = await optimizeRoute({
    geojson,
    start_lat: startLat,
    start_lon: startLon,
    turn_penalties: {
      left_turn: turnPenalties?.leftTurn ?? 50,
      u_turn: turnPenalties?.uTurn ?? 100,
      right_turn: turnPenalties?.rightTurn ?? 0,
    },
  });

  if (!optResult.route?.length) {
    throw new Error(
      optResult.message ||
        "Optimizer returned no route. Check that the GeoJSON contains LineString road features."
    );
  }

  const collectionPoints: CollectionPoint[] = optResult.route.map((p, i) => ({
    id: p.node_id ?? `route-${i}`,
    address: `Stop ${i + 1}`,
    latitude: p.latitude,
    longitude: p.longitude,
    collectionType: "residential" as const,
    status: "pending" as const,
  }));

  return {
    collectionPoints,
    totalDistanceKm: optResult.total_distance_km,
    stats: {
      nodesInGraph: optResult.stats.nodes_in_graph,
      edgesInGraph: optResult.stats.edges_in_graph,
    },
  };
}

/**
 * Combined parse + import helper for convenience.
 * Parses raw JSON content and imports via the optimizer.
 */
export async function parseAndImportGeoJSON(
  content: string,
  options: GeoJSONImportOptions = {}
): Promise<GeoJSONImportResult> {
  const geojson = parseGeoJSON(content);
  return importGeoJSONRoute(geojson, options);
}
