import type { Node, Way, TurnRestriction } from "./types";
import { debug } from "./debug";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-utils";
// import { v4 as uuidv4 } from 'uuid';
const uuidv4 = () => Math.random().toString(36).substring(2, 10);

export class GeoJSONParser {
  private nodes: Map<string, Node> = new Map();
  private ways: Way[] = [];
  private turnRestrictions: TurnRestriction[] = [];

  /**
   * Parse GeoJSON FeatureCollection into Nodes and Ways for the optimizer.
   * Splits LineStrings into ways and deduplicates nodes based on coordinates.
   */
  parseGeoJSON(geojson: GeoJSONFeatureCollection): {
    nodes: Map<string, Node>;
    ways: Way[];
    turnRestrictions: TurnRestriction[];
  } {
    this.nodes.clear();
    this.ways = [];
    this.turnRestrictions = [];

    // Map coordinate string "lat,lon" to Node ID to reuse nodes
    const coordToNodeId = new Map<string, string>();

    const getOrCreateNode = (lon: number, lat: number): string => {
      const key = `${lat},${lon}`;
      if (coordToNodeId.has(key)) {
        return coordToNodeId.get(key)!;
      }
      // Generate a deterministic ID if possible, or random
      // For Overture, we might not have stable IDs, so we use coordinate-based or random
      const id = `node-${this.nodes.size + 1}`;
      this.nodes.set(id, { id, lat, lon });
      coordToNodeId.set(key, id);
      return id;
    };

    for (const feature of geojson.features) {
      if (feature.geometry.type === "LineString") {
        const coordinates = feature.geometry.coordinates as number[][];
        if (coordinates.length < 2) continue;

        const nodeIds: string[] = [];
        for (const [lon, lat] of coordinates) {
          nodeIds.push(getOrCreateNode(lon, lat));
        }

        const tags: Record<string, string> = {};
        if (feature.properties) {
          for (const [k, v] of Object.entries(feature.properties)) {
            if (typeof v === "string") tags[k] = v;
            else if (typeof v === "number") tags[k] = String(v);
          }
        }

        // Ensure we have a valid ID
        const wayId =
          typeof feature?.id === "string"
            ? feature.id
            : `way-${this.ways.length + 1}`;

        this.ways.push({
          id: wayId,
          nodes: nodeIds,
          tags,
        });
      }
    }

    debug("GeoJSONParser.parseGeoJSON", {
      nodesCount: this.nodes.size,
      waysCount: this.ways.length,
    });

    return {
      nodes: this.nodes,
      ways: this.ways,
      turnRestrictions: this.turnRestrictions,
    };
  }
}
