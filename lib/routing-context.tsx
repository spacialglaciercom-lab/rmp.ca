import React, { createContext, useContext, useReducer, ReactNode } from "react";
import type {
  StartPoint,
  TurnPenalties,
  RouteStatistics,
  ProcessingLogEntry,
  RouteReport,
  RouteConfiguration,
  TurnStatistics,
} from "@/types/routing";
import type { WeatherAnalysisResult } from "@/services/weatherAnalysis";

export interface PreviewRoutePoint {
  lat: number;
  lon: number;
  /** Optional label for map markers (e.g. VRP stop sequence "#1", "#2"). */
  label?: string;
}

interface RoutingState {
  configuration: RouteConfiguration;
  statistics: RouteStatistics | null;
  processingLog: ProcessingLogEntry[];
  report: RouteReport | null;
  isProcessing: boolean;
  gpxData: string | null;
  /** GPX preview: when set, Map tab shows this route (polyline). Cleared when leaving Map or on clear. */
  previewRoutePoints: PreviewRoutePoint[] | null;
  /** When set, Map shows one polyline per vehicle (VRP multi-vehicle). Each item is one route's points. */
  previewRoutePointsByVehicle: PreviewRoutePoint[][] | null;
  /** Weather analysis along route (segment risks, recommendations). Set when optimization returns with weather. */
  weatherAnalysis: WeatherAnalysisResult | null;
  /** AI-enhanced route statistics from weather analysis */
  aiRouteAnalysis: {
    averageSpeedMph: number;
    totalEstimatedTimeMinutes: number;
    confidenceScore: number;
    weatherImpactSeverity: "none" | "low" | "moderate" | "high";
    reasoning: string;
  } | null;
}

type RoutingAction =
  | { type: "SET_START_POINT"; payload: StartPoint | undefined }
  | { type: "SET_TURN_PENALTIES"; payload: TurnPenalties }
  | { type: "SET_ONEWAY_MODE"; payload: "A" | "B" }
  | { type: "SET_SERVICE_BOTH_SIDES"; payload: boolean }
  | { type: "SET_OUTPUT_FILENAME"; payload: string }
  | { type: "SET_STATISTICS"; payload: RouteStatistics }
  | { type: "ADD_LOG_ENTRY"; payload: ProcessingLogEntry }
  | { type: "CLEAR_LOG" }
  | { type: "SET_REPORT"; payload: RouteReport }
  | { type: "SET_PROCESSING"; payload: boolean }
  | { type: "SET_GPX_DATA"; payload: string }
  | { type: "SET_PREVIEW_ROUTE"; payload: PreviewRoutePoint[] | null }
  | { type: "SET_PREVIEW_ROUTES"; payload: PreviewRoutePoint[][] | null }
  | { type: "SET_WEATHER_ANALYSIS"; payload: WeatherAnalysisResult | null }
  | { type: "SET_AI_ROUTE_ANALYSIS"; payload: {
      averageSpeedMph: number;
      totalEstimatedTimeMinutes: number;
      confidenceScore: number;
      weatherImpactSeverity: "none" | "low" | "moderate" | "high";
      reasoning: string;
    } | null }
  | { type: "RESET" };

const defaultTurnPenalties: TurnPenalties = {
  leftTurn: 50,
  uTurn: 100,
  rightTurn: 0,
};

const initialState: RoutingState = {
  configuration: {
    startPoint: undefined,
    turnPenalties: defaultTurnPenalties,
    onewayMode: "B",
    serviceBothSides: false,
    outputFileName: "trash_route",
  },
  statistics: null,
  processingLog: [],
  report: null,
  isProcessing: false,
  gpxData: null,
  previewRoutePoints: null,
  previewRoutePointsByVehicle: null,
  weatherAnalysis: null,
  aiRouteAnalysis: null,
};

function routingReducer(state: RoutingState, action: RoutingAction): RoutingState {
  switch (action.type) {
    case "SET_START_POINT":
      return {
        ...state,
        configuration: { ...state.configuration, startPoint: action.payload },
      };
    case "SET_TURN_PENALTIES":
      return {
        ...state,
        configuration: { ...state.configuration, turnPenalties: action.payload },
      };
    case "SET_ONEWAY_MODE":
      return {
        ...state,
        configuration: { ...state.configuration, onewayMode: action.payload },
      };
    case "SET_SERVICE_BOTH_SIDES":
      return {
        ...state,
        configuration: { ...state.configuration, serviceBothSides: action.payload },
      };
    case "SET_OUTPUT_FILENAME":
      return {
        ...state,
        configuration: { ...state.configuration, outputFileName: action.payload },
      };
    case "SET_STATISTICS": {
      const MAX_ESTIMATED_MINUTES = 24 * 60;
      const MIN_AVG_SPEED_KMH = 10; // Reject estimates implying slower than 10 km/h
      const stats = action.payload;
      let estimatedTime = stats.estimatedTime;
      // Sanity check: if time implies < 10 km/h average, recalculate from distance
      if (stats.totalDistance > 0 && estimatedTime > 0) {
        const impliedSpeedKmh = (stats.totalDistance / estimatedTime) * 60;
        if (impliedSpeedKmh < MIN_AVG_SPEED_KMH) {
          estimatedTime = Math.round((stats.totalDistance / 25) * 60); // 25 km/h typical
        }
      }
      const capped =
        estimatedTime > MAX_ESTIMATED_MINUTES
          ? { ...stats, estimatedTime: MAX_ESTIMATED_MINUTES }
          : { ...stats, estimatedTime };
      return { ...state, statistics: capped };
    }
    case "ADD_LOG_ENTRY":
      return {
        ...state,
        processingLog: [...state.processingLog, action.payload],
      };
    case "CLEAR_LOG":
      return { ...state, processingLog: [] };
    case "SET_REPORT":
      return { ...state, report: action.payload };
    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };
    case "SET_GPX_DATA":
      return { ...state, gpxData: action.payload };
    case "SET_PREVIEW_ROUTE":
      return { ...state, previewRoutePoints: action.payload, previewRoutePointsByVehicle: null };
    case "SET_PREVIEW_ROUTES":
      return { ...state, previewRoutePointsByVehicle: action.payload, previewRoutePoints: null };
    case "SET_WEATHER_ANALYSIS":
      return { ...state, weatherAnalysis: action.payload };
    case "SET_AI_ROUTE_ANALYSIS":
      return { ...state, aiRouteAnalysis: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

const RoutingContext = createContext<{
  state: RoutingState;
  dispatch: React.Dispatch<RoutingAction>;
} | null>(null);

export function RoutingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(routingReducer, initialState);

  return (
    <RoutingContext.Provider value={{ state, dispatch }}>
      {children}
    </RoutingContext.Provider>
  );
}

export function useRouting() {
  const context = useContext(RoutingContext);
  if (!context) {
    throw new Error("useRouting must be used within a RoutingProvider");
  }
  return context;
}

// Helper functions
export function validateCoordinates(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function generateLogEntry(
  message: string,
  type: ProcessingLogEntry["type"] = "info"
): ProcessingLogEntry {
  return {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: new Date(),
    message,
    type,
  };
}

export function generateSampleStatistics(): RouteStatistics {
  return {
    totalDistance: 24.7,
    estimatedTime: 98,
    totalTraversals: 156,
    turns: {
      rightTurns: 45,
      leftTurns: 12,
      uTurns: 3,
      straightAhead: 96,
    },
    segmentsRouted: 142,
    segmentsExcluded: 8,
  };
}

export function generateSampleReport(stats: RouteStatistics): RouteReport {
  return {
    title: "Generated trash_route.gpx from OSM extract",
    generatedAt: new Date(),
    guarantees: {
      singleContinuousTrack: true,
      rightSideArmLogic: true,
      turnOptimization: "Right-turn bias applied with U-turn penalty of 500+",
    },
    dataSummary: {
      includedTags: ["residential", "unclassified", "service", "tertiary", "secondary"],
      excludedTags: ["parking_aisle", "private", "footway", "cycleway", "steps", "path"],
      connectedComponents: 1,
      segmentsRouted: stats.segmentsRouted,
      segmentsExcluded: stats.segmentsExcluded,
    },
    routeStats: stats,
    operationalNotes: [
      "Dead-ends handled with turnaround maneuvers",
      "3 unavoidable U-turns due to network topology",
    ],
  };
}

/** Parse GPX string and return track points (lat, lon) from trkpt elements */
export function parseGpxTrackPoints(gpxData: string): PreviewRoutePoint[] {
  const points: PreviewRoutePoint[] = [];
  const trkptRegex = /<trkpt[^>]+>/g;
  let match;
  while ((match = trkptRegex.exec(gpxData)) !== null) {
    const tag = match[0];
    const latMatch = tag.match(/lat="([^"]+)"/);
    const lonMatch = tag.match(/lon="([^"]+)"/);
    if (latMatch && lonMatch) {
      const lat = parseFloat(latMatch[1]);
      const lon = parseFloat(lonMatch[1]);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        points.push({ lat, lon });
      }
    }
  }
  return points;
}

/** Escape string for safe use inside GPX XML attributes and text. */
function escapeGpxXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generate GPX string from route points with optional simplification.
 * Export uses the full point list (no simplification) unless simplify=true.
 * All call sites currently pass only (name, points), so no segments are dropped at serialization.
 *
 * @param routeName Name of the route
 * @param points Array of latitude/longitude points
 * @param simplify Whether to simplify the route using Douglas-Peucker algorithm
 * @param tolerance Simplification tolerance in kilometers (default 0.01 = 10 meters)
 * @returns GPX XML string
 */
export function generateGPXString(
  routeName: string,
  points: Array<{ lat: number; lon: number }>,
  simplify: boolean = false,
  tolerance: number = 0.01
): string {
  // Import Douglas-Peucker - only if simplification is needed
  let douglasPeucker: any = null;
  if (simplify) {
    try {
      const module = require("@/lib/douglas-peucker");
      douglasPeucker = module.douglasPeucker;
    } catch (e) {
      console.warn("Douglas-Peucker module not available, skipping simplification");
      simplify = false;
    }
  }

  let processedPoints = points;

  // Apply simplification if requested and available
  if (simplify && douglasPeucker && points.length > 2) {
    try {
      // Convert to collection points for simplification
      const collectionPoints = points.map((p, i) => ({
        id: `point-${i}`,
        latitude: p.lat,
        longitude: p.lon,
        address: "",
        collectionType: "residential" as const,
        status: "pending" as const,
        scheduledTime: new Date().toISOString(),
      }));

      // Simplify using Douglas-Peucker
      const simplified = douglasPeucker(collectionPoints, tolerance);

      // Convert back to lat/lon points
      processedPoints = simplified.map((p: any) => ({
        lat: p.latitude,
        lon: p.longitude,
      }));
    } catch (e) {
      console.warn("Error during simplification, using original points", e);
      processedPoints = points;
    }
  }

  const timestamp = new Date().toISOString();
  const safeName = escapeGpxXml(routeName);
  const trackPoints = processedPoints
    .map((p: any) => `      <trkpt lat="${p.lat}" lon="${p.lon}"><time>${timestamp}</time></trkpt>`)
    .join("\n");

  const simplificationNote = simplify
    ? `\n    <desc>Route generated by RouteMasterPro (simplified with ${points.length - processedPoints.length} points removed)</desc>`
    : `\n    <desc>Route generated by RouteMasterPro</desc>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteMasterPro"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>
    <time>${timestamp}</time>${simplificationNote}
  </metadata>
  <trk>
    <name>${safeName}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * Generate a single GPX file with multiple tracks (one per vehicle).
 * Use when VRP returns multiple routes so each driver gets a distinct track in one file.
 */
export function generateMultiTrackGPXString(
  routeNameBase: string,
  routes: Array<{ name: string; points: Array<{ lat: number; lon: number }> }>
): string {
  const timestamp = new Date().toISOString();
  const safeBase = escapeGpxXml(routeNameBase);
  const trackParts = routes
    .filter((r) => r.points.length >= 2)
    .map((r) => {
      const trackPoints = r.points
        .map((p) => `      <trkpt lat="${p.lat}" lon="${p.lon}"><time>${timestamp}</time></trkpt>`)
        .join("\n");
      return `  <trk>
    <name>${escapeGpxXml(r.name)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteMasterPro"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeBase}</name>
    <time>${timestamp}</time>
    <desc>VRP multi-vehicle routes (${routes.length} tracks)</desc>
  </metadata>
${trackParts}
</gpx>`;
}
