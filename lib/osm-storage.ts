/**
 * Serialization helpers for OSM parse data (for re-optimization with custom start point).
 * Allows storing OSM data so we can re-run the optimizer when start point changes.
 */

import type { Node, Way, TurnRestriction } from "@/lib/route-optimizer-v2/types";

export const OSM_DATA_STORAGE_KEY = "trashroute_osm_data";

export interface StoredOSMData {
  /** nodes as [id, {id, lat, lon}][] for JSON serialization */
  nodesArray: [string, Node][];
  ways: Way[];
  turnRestrictions: TurnRestriction[];
}

/** Convert nodes Map to serializable array */
export function osmDataToStored(
  nodes: Map<string, Node>,
  ways: Way[],
  turnRestrictions: TurnRestriction[]
): StoredOSMData {
  return {
    nodesArray: Array.from(nodes.entries()),
    ways,
    turnRestrictions,
  };
}

/** Rebuild nodes Map from stored data */
export function storedToOsmData(
  stored: StoredOSMData
): { nodes: Map<string, Node>; ways: Way[]; turnRestrictions: TurnRestriction[] } {
  const nodes = new Map<string, Node>(stored.nodesArray);
  return {
    nodes,
    ways: stored.ways,
    turnRestrictions: stored.turnRestrictions,
  };
}
