export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface StartPoint {
  coordinates: Coordinates;
  name?: string;
  isValid: boolean;
}

export interface TurnPenalties {
  leftTurn: number; // 0-100 penalty weight
  uTurn: number; // 0-100 penalty weight
  rightTurn: number; // 0-100 penalty weight (usually 0 or low)
}

export interface TurnStatistics {
  rightTurns: number;
  leftTurns: number;
  uTurns: number;
  straightAhead: number;
}

export interface RouteStatistics {
  totalDistance: number; // in kilometers
  estimatedTime: number; // in minutes
  totalTraversals: number;
  turns: TurnStatistics;
  segmentsRouted: number;
  segmentsExcluded: number;
  // Backend optimizer stats
  efficiency?: number; // percentage
  deadEndsIdentified?: number;
  onewayViolations?: number; // count of violations
  uTurnsAvoided?: number;
}

export interface ProcessingLogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: "info" | "warning" | "error" | "success";
}

export interface RouteReport {
  title: string;
  generatedAt: Date;
  guarantees: {
    singleContinuousTrack: boolean;
    rightSideArmLogic: boolean;
    turnOptimization: string;
  };
  dataSummary: {
    includedTags: string[];
    excludedTags: string[];
    connectedComponents: number;
    segmentsRouted: number;
    segmentsExcluded: number;
  };
  routeStats: RouteStatistics;
  operationalNotes: string[];
}

export interface RouteConfiguration {
  startPoint?: StartPoint;
  turnPenalties: TurnPenalties;
  onewayMode: "A" | "B"; // A: Ignore oneways, B: Respect oneways
  /** When true, route traverses each street twice (left and right side / both curbs). */
  serviceBothSides: boolean;
  outputFileName: string;
}

export interface GPXTrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

export interface GPXData {
  name: string;
  trackPoints: GPXTrackPoint[];
  metadata: {
    creator: string;
    time: string;
    description?: string;
  };
}
