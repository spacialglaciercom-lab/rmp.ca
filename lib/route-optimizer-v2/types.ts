/**
 * Types for v2 route optimizer (from route-optimizer-mobile-v2)
 */

export interface Node {
  id: string;
  lat: number;
  lon: number;
  /** Optional elevation (m). Used by FuelAwarePlugin when GeoJSON has [lon, lat, z]. */
  z?: number;
}

export interface Way {
  id: string;
  nodes: string[];
  tags: Record<string, string>;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  /** OSM node ID for this point (used as collection point id in exports) */
  nodeId?: string;
}

export interface RouteStats {
  total_traversals: number;
  total_distance_km: number;
  right_turns: number;
  left_turns: number;
  u_turns: number;
  straight: number;
  oneway_violations: Array<[string, string]>;
  single_pass_segments: Array<[string, string]>;
  dead_ends_identified: number;
  u_turns_avoided: number;
  efficiency: number;
}

export interface OptimizationResult {
  route: RoutePoint[];
  totalDistance: number;
  message: string;
  stats?: RouteStats;
}

/** OSM turn restriction relation: no_u_turn at via when coming from from_way toward to_way */
export interface TurnRestriction {
  fromWayId: string;
  viaNodeId: string;
  toWayId: string;
  restriction: string; // e.g. "no_u_turn"
  /** restriction:hgv=no_u_turn etc. */
  hgv?: boolean;
}

/** Turn penalty weights (0-100) used when choosing next edge in Hierholzer */
export interface TurnPenaltyWeights {
  leftTurn: number;
  uTurn: number;
  rightTurn: number;
}

/** Precomputed sets for U-turn restriction enforcement */
export interface UturnRestrictionSet {
  /** Nodes where U-turn is forbidden (mid-block: degree 2, same way both sides) */
  midBlockNoUturnNodes: Set<string>;
  /** Nodes where U-turn is forbidden by OSM restriction relation */
  relationNoUturnNodes: Set<string>;
  /** Way IDs with u_turn=no / no_u_turn=yes (no U-turn when on this way) */
  noUturnWayIds: Set<string>;
}
