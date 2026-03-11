/**
 * Navigation type definitions.
 *
 * Two completely separate navigation systems:
 *
 * 1. **Collection Route** — custom in-app navigator with segment tracking,
 *    right-arm awareness, live GPS auto-advance, and colored polyline map.
 *
 * 2. **Normal Navigation** — deep link to Google Maps / Apple Maps / Waze.
 *    The app hands off the destination and steps aside.
 */

import type { CollectionPoint } from "./index";

// ---------------------------------------------------------------------------
// Collection Route Navigation
// ---------------------------------------------------------------------------

export type SegmentStatus = "pending" | "active" | "completed" | "skipped";

export interface CollectionSegment {
  index: number;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  /** Polyline coordinates for this segment (from matched geometry). */
  polyline: Array<{ lat: number; lon: number }>;
  status: SegmentStatus;
  /** Distance in meters. */
  distance: number;
  /** The collection point at the end of this segment (if any). */
  collectionPoint?: CollectionPoint;
  /** Whether the collection point is on the right side of the direction of travel. */
  isRightSide: boolean;
  /** Linear reference start (0.0–1.0) within the original Overture segment. */
  start_lr?: number;
  /** Linear reference end (0.0–1.0) within the original Overture segment. */
  end_lr?: number;
  /** Original Overture GERS ID before splitting. */
  source_id?: string;
  /** Whether this segment was produced by the road splitter. */
  was_split?: boolean;
  /** Linear progress (0.0–1.0) of the truck along this segment. */
  linearProgress: number;
}

/**
 * A visual grouping of sub-segments that share the same source_id.
 * Used to present one "street" entry when the backend splits a road
 * into multiple sub-segments.
 */
export interface SegmentGroup {
  /** The shared source_id (original Overture GERS ID). */
  sourceId: string;
  /** Display name derived from the first sub-segment's collection point address. */
  streetName: string;
  /** Indices into the segments array. */
  segmentIndices: number[];
  /** Number of sub-segments in this group. */
  subSegmentCount: number;
  /** Whether all sub-segments in this group are completed. */
  isCompleted: boolean;
  /** Whether any sub-segment in this group is active. */
  isActive: boolean;
}

export interface CollectionRouteState {
  /** All segments that make up the collection route. */
  segments: CollectionSegment[];
  /** Index of the currently active segment. */
  activeSegmentIndex: number;
  /** Total distance of the route in meters. */
  totalDistance: number;
  /** Distance completed so far in meters. */
  completedDistance: number;
  /** Number of collection points completed. */
  completedStops: number;
  /** Total collection points on route. */
  totalStops: number;
  /** Whether the navigator is actively tracking GPS. */
  isTracking: boolean;
  /** Current GPS position. */
  currentLocation: {
    lat: number;
    lon: number;
    bearing?: number;
    speed?: number;
  } | null;
  /** Auto-advance threshold in meters (advance to next segment when within this range). */
  autoAdvanceRadius: number;
  /** Segment groups by source_id for split-segment street grouping. */
  segmentGroups: SegmentGroup[];
  /** Number of unique original streets (by source_id). */
  totalStreets: number;
  /** Number of completed original streets. */
  completedStreets: number;
}

// ---------------------------------------------------------------------------
// Normal Navigation (external deep link)
// ---------------------------------------------------------------------------

export type ExternalNavApp = "google_maps" | "apple_maps" | "waze";

export type NormalNavPurpose =
  | "depot_to_route_start"
  | "last_stop_to_depot"
  | "special_pickup"
  | "custom";

export interface NormalNavDestination {
  lat: number;
  lon: number;
  label?: string;
  address?: string;
  purpose: NormalNavPurpose;
}

export interface ExternalNavAppInfo {
  id: ExternalNavApp;
  name: string;
  icon: string;
  available: boolean;
}
