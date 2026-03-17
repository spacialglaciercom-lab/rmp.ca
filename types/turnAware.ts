/**
 * Phase 1 turn-aware CPP types and default static penalties.
 */

export interface StreetEdge {
  id: string;
  from: string; // node id
  to: string; // node id
  coordinates: [number, number][];
  length: number; // meters
  speed: number; // km/h
  oneWay: boolean;
  streetName?: string;
  /** OSM way id (for ML edge penalties keyed by way). */
  wayId?: string;
}

export interface TurnNode {
  edgeId: string;
  direction: "forward" | "backward";
  intersectionId: string; // where this orientation enters/exits
}

export interface TurnEdge {
  id: string;
  from: TurnNode;
  to: TurnNode;
  turnType: "straight" | "right" | "left" | "u-turn";
  staticPenalty: number; // seconds
  baseTime: number; // time to traverse target edge
  totalCost: number; // baseTime + penalty (for CPP weight)
  /** True when this edge was added to make the graph Eulerian (deadhead traversal). */
  deadhead?: boolean;
  /** True when this edge bridges two SCCs (synthetic connector). */
  bridge?: boolean;
}

export interface BetaFeatures {
  enabled: boolean;
  turnAwareCpp: boolean;
  learnedPenalties: boolean;
  /** Weather-enhanced routing: fetch weather, apply penalties, show recommendations */
  weatherOptimizedRouting: boolean;
  /** AI co-pilot: voice/text companion for drivers (Genkit + Leap fallback) */
  voiceCoPilot: boolean;
  /** RouteMaster Constraints: parse natural language into route constraints via Gemini */
  routeMasterConstraints: boolean;
  /** Moonshine Voice: on-device streaming STT replacing cloud Whisper */
  moonshineVoice: boolean;
  /** Vehicle Breakdown Rerouting: re-solve remaining circuit when a truck goes out of service */
  vehicleBreakdown: boolean;
  /** Emergency Stop Insertion: cheapest-insertion of unscheduled pickups into active circuit */
  emergencyStopInsertion: boolean;
  /** Real-time Traffic Feed: pull live speed data and re-weight edges before CPP solve */
  realTimeTrafficFeed: boolean;
  crashCount: number; // safety fallback
}

export const DEFAULT_STATIC_PENALTIES = {
  straight: 2, // seconds (rolling through)
  right: 8, // rolling stop
  left: 45, // wait for gap + turn
  "u-turn": 120, // maneuver + safety
} as const;
