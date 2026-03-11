/**
 * Google Maps Elevation API — same API key as Google Maps (getGoogleMapsApiKey).
 *
 * Use for:
 * - Enhancing GPX route data with elevation profiles
 * - Calculating grade/slope for route segments
 * - Visualizing elevation changes along collection routes
 * - Determining uphill/downhill segments (vehicle fuel/time estimates)
 *
 * Enable "Elevation API" in Google Cloud Console for the project that has the Maps key.
 * https://developers.google.com/maps/documentation/elevation
 */

import { getGoogleMapsApiKey } from "@/lib/google-maps-config";
import { haversineDistance } from "@/lib/offlineTurnDetection";

const ELEVATION_BASE = "https://maps.googleapis.com/maps/api/elevation/json";
const MAX_POINTS_PER_REQUEST = 512;

// ─── API response types ─────────────────────────────────────────────────────

export interface GoogleElevationResult {
  elevation: number;
  location: { lat: number; lng: number };
  resolution: number;
}

export interface GoogleElevationResponse {
  results?: GoogleElevationResult[];
  status: string;
  error_message?: string;
}

// ─── Enhanced route types (for app use) ──────────────────────────────────────

/** A route point with elevation (meters, LMSL). */
export interface PointWithElevation {
  lat: number;
  lon: number;
  elevationMeters: number;
  /** Data resolution in meters (from API). */
  resolution?: number;
}

/** Grade/slope for a segment between two consecutive points. */
export interface SegmentGrade {
  fromIndex: number;
  toIndex: number;
  /** Horizontal distance in meters. */
  distanceMeters: number;
  /** Elevation gain (uphill) in meters. */
  elevationGainMeters: number;
  /** Elevation loss (downhill) in meters. */
  elevationLossMeters: number;
  /** Grade as percent (rise over run × 100). Positive = uphill, negative = downhill. */
  gradePercent: number;
  /** Segment is net uphill. */
  isUphill: boolean;
  /** Segment is net downhill. */
  isDownhill: boolean;
}

/** Full elevation profile for a route: points + segment grades + summary. */
export interface ElevationProfile {
  /** Route points with elevation. Same length and order as input points. */
  points: PointWithElevation[];
  /** Grade for each segment (points[i] → points[i+1]). Length = points.length - 1. */
  segments: SegmentGrade[];
  /** Summary stats for visualization and fuel/time estimates. */
  summary: ElevationProfileSummary;
}

export interface ElevationProfileSummary {
  /** Total elevation gain (sum of uphill segments) in meters. */
  totalClimbMeters: number;
  /** Total elevation loss (sum of downhill segments) in meters. */
  totalDescentMeters: number;
  /** Maximum grade percent (steepest uphill segment). */
  maxGradePercent: number;
  /** Minimum grade percent (steepest downhill segment, negative). */
  minGradePercent: number;
  /** Total horizontal distance in meters. */
  totalDistanceMeters: number;
  /** Net elevation change (end - start) in meters. */
  netElevationChangeMeters: number;
  /** Whether the route is net uphill (end > start). */
  isNetUphill: boolean;
  /** Whether the route is net downhill (end < start). */
  isNetDownhill: boolean;
}

// ─── API client ─────────────────────────────────────────────────────────────

async function fetchElevationBatch(
  points: Array<{ lat: number; lon: number }>,
  apiKey: string,
): Promise<GoogleElevationResult[]> {
  if (points.length === 0) return [];
  if (points.length > MAX_POINTS_PER_REQUEST) {
    throw new Error(
      `Elevation API: max ${MAX_POINTS_PER_REQUEST} points per request; got ${points.length}. Use getElevationForPoints which batches automatically.`,
    );
  }
  const locations = points.map((p) => `${p.lat},${p.lon}`).join("|");
  const url = `${ELEVATION_BASE}?locations=${encodeURIComponent(locations)}&key=${apiKey}`;
  const res = await fetch(url);
  const data = (await res.json()) as GoogleElevationResponse;
  if (data.status !== "OK") {
    const msg = data.error_message ?? data.status;
    throw new Error(`Elevation API: ${msg}`);
  }
  return data.results ?? [];
}

/**
 * Fetch elevation for a list of points (lat/lon). Batches in chunks of 512.
 * Returns one result per input point in the same order.
 */
export async function getElevationForPoints(
  points: Array<{ lat: number; lon: number }>,
): Promise<PointWithElevation[]> {
  if (points.length === 0) return [];
  const apiKey = await getGoogleMapsApiKey();
  if (!apiKey) throw new Error("Google API key not configured");

  const out: PointWithElevation[] = [];
  for (let i = 0; i < points.length; i += MAX_POINTS_PER_REQUEST) {
    const batch = points.slice(i, i + MAX_POINTS_PER_REQUEST);
    const results = await fetchElevationBatch(batch, apiKey);
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      out.push({
        lat: r.location.lat,
        lon: r.location.lng,
        elevationMeters: r.elevation,
        resolution: r.resolution,
      });
    }
  }
  return out;
}

/**
 * Compute segment grades between consecutive points with elevation.
 * Grade % = (elevation change / horizontal distance) × 100.
 */
export function computeSegmentGrades(
  points: PointWithElevation[],
): SegmentGrade[] {
  const segments: SegmentGrade[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const distanceMeters = haversineDistance(a, b);
    const elevDiff = b.elevationMeters - a.elevationMeters;
    const elevationGainMeters = Math.max(0, elevDiff);
    const elevationLossMeters = Math.max(0, -elevDiff);
    const gradePercent =
      distanceMeters > 0 ? (elevDiff / distanceMeters) * 100 : 0;
    segments.push({
      fromIndex: i,
      toIndex: i + 1,
      distanceMeters,
      elevationGainMeters,
      elevationLossMeters,
      gradePercent,
      isUphill: elevDiff > 0,
      isDownhill: elevDiff < 0,
    });
  }
  return segments;
}

/**
 * Compute summary stats from points and segments.
 */
export function computeElevationSummary(
  points: PointWithElevation[],
  segments: SegmentGrade[],
): ElevationProfileSummary {
  const totalClimbMeters = segments.reduce(
    (s, seg) => s + seg.elevationGainMeters,
    0,
  );
  const totalDescentMeters = segments.reduce(
    (s, seg) => s + seg.elevationLossMeters,
    0,
  );
  const totalDistanceMeters = segments.reduce(
    (s, seg) => s + seg.distanceMeters,
    0,
  );
  const grades = segments.map((s) => s.gradePercent);
  const maxGradePercent = grades.length ? Math.max(...grades) : 0;
  const minGradePercent = grades.length ? Math.min(...grades) : 0;
  const netElevationChangeMeters =
    points.length >= 2
      ? points[points.length - 1].elevationMeters - points[0].elevationMeters
      : 0;
  return {
    totalClimbMeters,
    totalDescentMeters,
    maxGradePercent,
    minGradePercent,
    totalDistanceMeters,
    netElevationChangeMeters,
    isNetUphill: netElevationChangeMeters > 0,
    isNetDownhill: netElevationChangeMeters < 0,
  };
}

/**
 * Fetch elevation for a route and compute segment grades and summary.
 * Use this to enhance GPX route data and for elevation profile visualization.
 */
export async function getElevationProfile(
  points: Array<{ lat: number; lon: number }>,
): Promise<ElevationProfile | null> {
  if (points.length < 2) return null;
  const pointsWithElevation = await getElevationForPoints(points);
  if (pointsWithElevation.length === 0) return null;
  const segments = computeSegmentGrades(pointsWithElevation);
  const summary = computeElevationSummary(pointsWithElevation, segments);
  return {
    points: pointsWithElevation,
    segments,
    summary,
  };
}

/**
 * Whether the Elevation API can be used (same key as Maps).
 * Enable "Elevation API" in Google Cloud Console.
 */
export async function isGoogleElevationConfigured(): Promise<boolean> {
  const key = await getGoogleMapsApiKey();
  return !!key?.trim();
}

// ─── GPX enhancement ────────────────────────────────────────────────────────

/**
 * Format a single track point as GPX <trkpt> with <ele> for use when building
 * or augmenting GPX route data.
 */
export function toGPXTrkptWithElevation(
  point: PointWithElevation,
  time?: string,
): string {
  const ele = `<ele>${point.elevationMeters.toFixed(1)}</ele>`;
  const timeTag = time ? `\n        <time>${time}</time>` : "";
  return `      <trkpt lat="${point.lat}" lon="${point.lon}">\n        ${ele}${timeTag}\n      </trkpt>`;
}

/**
 * Augment an array of route points (lat, lon) with elevation data for GPX export
 * or display. Returns points with elevation; if API fails, returns null.
 */
export async function enhanceRoutePointsWithElevation(
  points: Array<{ lat: number; lon: number }>,
): Promise<PointWithElevation[] | null> {
  if (points.length < 2) return null;
  try {
    return await getElevationForPoints(points);
  } catch {
    return null;
  }
}
