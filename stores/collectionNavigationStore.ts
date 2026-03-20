/**
 * Collection Navigation Store
 *
 * Manages the state for in-app collection route navigation:
 * - Segment tracking (pending / active / completed / skipped)
 * - Right-arm awareness (which stops are on the right side of travel)
 * - Live GPS auto-advance via linear reference progress (primary)
 *   with 30m threshold fallback when geometry projection fails
 * - Colored polyline progress (green = done, orange = active, gray = pending)
 * - Grouped street view for split Overture segments (by source_id)
 */

import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";
import { haversineDistance } from "@/lib/offlineTurnDetection";
import type { CollectionPoint } from "@/types";
import type {
  CollectionSegment,
  CollectionRouteState,
  SegmentStatus,
  SegmentGroup,
} from "@/types/navigation";
import { useCircuitStore } from "@/stores/circuitStore";
import { rerouteAfterBreakdown } from "@/lib/onlineReopt/breakdownRerouter";
import { insertEmergencyStop } from "@/lib/onlineReopt/stopInsertion";
import { turnCircuitToRoutePoints } from "@/lib/turnAwareCpp";
import type { TurnNode } from "@/types/turnAware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_AUTO_ADVANCE_RADIUS = 30; // meters
const LINEAR_PROGRESS_ADVANCE_THRESHOLD = 0.95;

/**
 * Determine whether a collection point is on the right side of the direction
 * of travel. Uses the cross product of the travel vector and the vector from
 * the segment start to the point.
 */
function isPointOnRightSide(
  travelFrom: { lat: number; lon: number },
  travelTo: { lat: number; lon: number },
  point: { lat: number; lon: number },
): boolean {
  const dx = travelTo.lon - travelFrom.lon;
  const dy = travelTo.lat - travelFrom.lat;
  const px = point.lon - travelFrom.lon;
  const py = point.lat - travelFrom.lat;
  return dx * py - dy * px < 0;
}

/**
 * Project a GPS coordinate onto a segment polyline using turf.js.
 * Returns a linear progress value (0.0 to 1.0) or null if projection fails.
 */
function computeLinearProgress(
  location: { lat: number; lon: number },
  polyline: Array<{ lat: number; lon: number }>,
): number | null {
  if (polyline.length < 2) return null;

  try {
    const line = lineString(polyline.map((p) => [p.lon, p.lat]));
    const pt = point([location.lon, location.lat]);
    const snapped = nearestPointOnLine(line, pt);

    const locationProp = snapped.properties?.location;
    if (locationProp == null || locationProp < 0) return null;

    let totalLength = 0;
    for (let i = 1; i < polyline.length; i++) {
      totalLength += haversineDistance(polyline[i - 1], polyline[i]);
    }
    if (totalLength <= 0) return null;

    const progress = locationProp / (totalLength / 1000);
    return Math.max(0, Math.min(1, progress));
  } catch {
    return null;
  }
}

/**
 * Build segment groups from segments that share the same source_id.
 * Non-split segments (or segments without source_id) get their own group.
 */
function buildSegmentGroups(segments: CollectionSegment[]): SegmentGroup[] {
  const groupMap = new Map<string, number[]>();
  const ordered: string[] = [];

  for (const seg of segments) {
    const key = seg.source_id ?? `__single_${seg.index}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
      ordered.push(key);
    }
    groupMap.get(key)!.push(seg.index);
  }

  return ordered.map((key) => {
    const indices = groupMap.get(key)!;
    let streetName = `Segment ${indices[0] + 1}`;
    for (const idx of indices) {
      const seg = segments[idx];
      if (seg?.collectionPoint?.address) {
        streetName = seg.collectionPoint.address;
        break;
      }
    }

    return {
      sourceId: key,
      streetName,
      segmentIndices: indices,
      subSegmentCount: indices.length,
      isCompleted: indices.every((i) => segments[i]?.status === "completed"),
      isActive: indices.some((i) => segments[i]?.status === "active"),
    };
  });
}

/**
 * Recompute street-level completion counts from segment groups.
 */
function computeStreetCounts(groups: SegmentGroup[]) {
  let completed = 0;
  for (const g of groups) {
    if (g.isCompleted) completed++;
  }
  return { total: groups.length, completed };
}

/**
 * Build collection segments from route points and collection points.
 * Each segment connects consecutive route waypoints. Collection points
 * are assigned to the nearest segment endpoint.
 */
function buildSegments(
  routePoints: Array<{ lat: number; lon: number }>,
  collectionPoints: CollectionPoint[],
): CollectionSegment[] {
  if (routePoints.length < 2) return [];

  const pointsBySegmentEnd = new Map<number, CollectionPoint>();
  for (const cp of collectionPoints) {
    let minDist = Infinity;
    let bestIdx = 1;
    for (let i = 1; i < routePoints.length; i++) {
      const d = haversineDistance(
        { lat: cp.latitude, lon: cp.longitude },
        routePoints[i],
      );
      if (d < minDist) {
        minDist = d;
        bestIdx = i;
      }
    }
    if (
      !pointsBySegmentEnd.has(bestIdx) ||
      minDist <
        haversineDistance(
          {
            lat: pointsBySegmentEnd.get(bestIdx)!.latitude,
            lon: pointsBySegmentEnd.get(bestIdx)!.longitude,
          },
          routePoints[bestIdx],
        )
    ) {
      pointsBySegmentEnd.set(bestIdx, cp);
    }
  }

  const segments: CollectionSegment[] = [];

  for (let i = 0; i < routePoints.length - 1; i++) {
    const from = routePoints[i];
    const to = routePoints[i + 1];
    const cp = pointsBySegmentEnd.get(i + 1);
    const dist = haversineDistance(from, to);

    const rightSide = cp
      ? isPointOnRightSide(from, to, { lat: cp.latitude, lon: cp.longitude })
      : false;

    segments.push({
      index: i,
      from,
      to,
      polyline: [from, to],
      status: i === 0 ? "active" : "pending",
      distance: dist,
      collectionPoint: cp,
      isRightSide: rightSide,
      linearProgress: 0,
    });
  }

  return segments;
}

/**
 * Build collection segments from pre-split backend data that already contains
 * polyline, source_id, start_lr, end_lr, was_split fields.
 */
function buildSegmentsFromSplitData(
  splitSegments: Array<{
    from: { lat: number; lon: number };
    to: { lat: number; lon: number };
    polyline: Array<{ lat: number; lon: number }>;
    distance: number;
    start_lr?: number;
    end_lr?: number;
    source_id?: string;
    was_split?: boolean;
    collectionPoint?: CollectionPoint;
    isRightSide?: boolean;
  }>,
): CollectionSegment[] {
  return splitSegments.map((s, i) => ({
    index: i,
    from: s.from,
    to: s.to,
    polyline: s.polyline,
    status: (i === 0 ? "active" : "pending") as SegmentStatus,
    distance: s.distance,
    collectionPoint: s.collectionPoint,
    isRightSide: s.isRightSide ?? false,
    start_lr: s.start_lr,
    end_lr: s.end_lr,
    source_id: s.source_id,
    was_split: s.was_split,
    linearProgress: 0,
  }));
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface CollectionNavigationActions {
  /** Initialize the collection route from route points and collection points. */
  initRoute: (
    routePoints: Array<{ lat: number; lon: number }>,
    collectionPoints: CollectionPoint[],
  ) => void;

  /**
   * Re-solve the remaining circuit after a vehicle breakdown and re-initialize
   * navigation from the current position. Requires a circuit to be present in
   * circuitStore (populated by useRouteOptimization after a turn-aware solve).
   */
  rerouteFromBreakdown: () => Promise<void>;

  /**
   * Insert an emergency (unscheduled) pickup at the given coordinates using
   * cheapest-insertion and re-initialize the remaining segments.
   * Requires a circuit in circuitStore.
   */
  insertEmergencyStopAt: (coords: [number, number]) => Promise<void>;

  /** Initialize from pre-split backend segment data. */
  initRouteFromSplitSegments: (
    splitSegments: Array<{
      from: { lat: number; lon: number };
      to: { lat: number; lon: number };
      polyline: Array<{ lat: number; lon: number }>;
      distance: number;
      start_lr?: number;
      end_lr?: number;
      source_id?: string;
      was_split?: boolean;
      collectionPoint?: CollectionPoint;
      isRightSide?: boolean;
    }>,
  ) => void;

  /** Update current GPS location and auto-advance if within radius. */
  updateLocation: (location: {
    lat: number;
    lon: number;
    bearing?: number;
    speed?: number;
  }) => void;

  /** Manually advance to the next segment. */
  advanceSegment: () => void;

  /** Skip the current segment. */
  skipSegment: () => void;

  /** Mark a specific segment as completed. */
  completeSegment: (index: number) => void;

  /** Mark a specific segment as skipped by index (counts toward distance progress but not completedStops). */
  skipSegmentByIndex: (index: number) => void;

  /** Go back to a previous segment (undo advance). */
  goBackToSegment: (index: number) => void;

  /** Start GPS tracking. */
  startTracking: () => void;

  /** Stop GPS tracking. */
  stopTracking: () => void;

  /** Reset everything. */
  resetNavigation: () => void;

  /** Set the auto-advance radius in meters. */
  setAutoAdvanceRadius: (meters: number) => void;
}

type CollectionNavigationStore = CollectionRouteState &
  CollectionNavigationActions;

export const useCollectionNavigationStore = create<CollectionNavigationStore>()(
  (set, get) => ({
    segments: [],
    activeSegmentIndex: 0,
    totalDistance: 0,
    completedDistance: 0,
    completedStops: 0,
    totalStops: 0,
    isTracking: false,
    currentLocation: null,
    autoAdvanceRadius: DEFAULT_AUTO_ADVANCE_RADIUS,
    segmentGroups: [],
    totalStreets: 0,
    completedStreets: 0,
    activeCollectionPoints: [],

    initRoute: (routePoints, collectionPoints) => {
      const segments = buildSegments(routePoints, collectionPoints);
      const totalDistance = segments.reduce((sum, s) => sum + s.distance, 0);
      const totalStops = segments.filter((s) => s.collectionPoint).length;
      const groups = buildSegmentGroups(segments);
      const streets = computeStreetCounts(groups);

      set({
        segments,
        activeSegmentIndex: 0,
        totalDistance,
        completedDistance: 0,
        completedStops: 0,
        totalStops,
        isTracking: false,
        currentLocation: null,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
        activeCollectionPoints: collectionPoints,
      });
    },

    initRouteFromSplitSegments: (splitSegments) => {
      const segments = buildSegmentsFromSplitData(splitSegments);
      const totalDistance = segments.reduce((sum, s) => sum + s.distance, 0);
      const totalStops = segments.filter((s) => s.collectionPoint).length;
      const groups = buildSegmentGroups(segments);
      const streets = computeStreetCounts(groups);

      set({
        segments,
        activeSegmentIndex: 0,
        totalDistance,
        completedDistance: 0,
        completedStops: 0,
        totalStops,
        isTracking: false,
        currentLocation: null,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
      });
    },

    updateLocation: (location) => {
      const state = get();
      if (!state.isTracking || state.segments.length === 0) {
        set({ currentLocation: location });
        return;
      }

      const activeIdx = state.activeSegmentIndex;
      const activeSegment = state.segments[activeIdx];
      if (!activeSegment) {
        set({ currentLocation: location });
        return;
      }

      const newSegments = [...state.segments];
      let shouldAdvance = false;

      const progress = computeLinearProgress(location, activeSegment.polyline);

      if (progress !== null) {
        newSegments[activeIdx] = {
          ...newSegments[activeIdx],
          linearProgress: progress,
        };

        if (
          progress >= LINEAR_PROGRESS_ADVANCE_THRESHOLD &&
          activeIdx < state.segments.length - 1
        ) {
          shouldAdvance = true;
        }
      } else {
        // Fallback: binary 30m threshold for segments without good geometry
        const distToEnd = haversineDistance(location, activeSegment.to);
        if (
          distToEnd <= state.autoAdvanceRadius &&
          activeIdx < state.segments.length - 1
        ) {
          shouldAdvance = true;
        }

        // Estimate linear progress from distance even when projection fails
        if (activeSegment.distance > 0) {
          const distFromStart = haversineDistance(location, activeSegment.from);
          const estimated = Math.max(
            0,
            Math.min(1, distFromStart / activeSegment.distance),
          );
          newSegments[activeIdx] = {
            ...newSegments[activeIdx],
            linearProgress: estimated,
          };
        }
      }

      if (shouldAdvance) {
        newSegments[activeIdx] = {
          ...newSegments[activeIdx],
          status: "completed",
          linearProgress: 1,
        };

        // Lookahead: skip over already-completed/skipped segments and any
        // segments the driver has already passed through.
        let advanceTo = activeIdx;
        for (let i = activeIdx + 1; i < newSegments.length; i++) {
          const seg = newSegments[i];
          if (seg.status === "skipped") {
            advanceTo = i;
            continue;
          }
          const segProgress = computeLinearProgress(location, seg.polyline);
          if (
            segProgress !== null &&
            segProgress >= LINEAR_PROGRESS_ADVANCE_THRESHOLD
          ) {
            newSegments[i] = {
              ...newSegments[i],
              status: "completed",
              linearProgress: 1,
            };
            advanceTo = i;
          } else {
            const distToEnd = haversineDistance(location, seg.to);
            if (distToEnd <= state.autoAdvanceRadius) {
              newSegments[i] = {
                ...newSegments[i],
                status: "completed",
                linearProgress: 1,
              };
              advanceTo = i;
            } else {
              break;
            }
          }
        }

        // Activate the next pending segment after the furthest completed one
        const nextIdx = Math.min(advanceTo + 1, newSegments.length - 1);
        if (
          nextIdx !== activeIdx &&
          newSegments[nextIdx].status === "pending"
        ) {
          newSegments[nextIdx] = { ...newSegments[nextIdx], status: "active" };
        }

        const completedDistance = newSegments
          .filter((s) => s.status === "completed")
          .reduce((sum, s) => sum + s.distance, 0);
        const completedStops = newSegments.filter(
          (s) => s.status === "completed" && s.collectionPoint,
        ).length;
        const groups = buildSegmentGroups(newSegments);
        const streets = computeStreetCounts(groups);

        set({
          segments: newSegments,
          activeSegmentIndex: nextIdx,
          completedDistance,
          completedStops,
          currentLocation: location,
          segmentGroups: groups,
          totalStreets: streets.total,
          completedStreets: streets.completed,
        });
      } else {
        set({ segments: newSegments, currentLocation: location });
      }
    },

    advanceSegment: () => {
      const state = get();
      const activeIdx = state.activeSegmentIndex;
      if (activeIdx >= state.segments.length) return;

      const newSegments = [...state.segments];
      newSegments[activeIdx] = {
        ...newSegments[activeIdx],
        status: "completed",
        linearProgress: 1,
      };

      const isLastSegment = activeIdx >= state.segments.length - 1;
      let nextIdx = activeIdx;
      if (!isLastSegment) {
        nextIdx = activeIdx + 1;
        newSegments[nextIdx] = { ...newSegments[nextIdx], status: "active" };
      }

      const completedDistance = newSegments
        .filter((s) => s.status === "completed")
        .reduce((sum, s) => sum + s.distance, 0);
      const completedStops = newSegments.filter(
        (s) => s.status === "completed" && s.collectionPoint,
      ).length;
      const groups = buildSegmentGroups(newSegments);
      const streets = computeStreetCounts(groups);

      set({
        segments: newSegments,
        activeSegmentIndex: nextIdx,
        completedDistance,
        completedStops,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
      });
    },

    skipSegment: () => {
      const state = get();
      const activeIdx = state.activeSegmentIndex;
      if (activeIdx >= state.segments.length) return;

      const newSegments = [...state.segments];
      newSegments[activeIdx] = { ...newSegments[activeIdx], status: "skipped" };

      const isLastSegment = activeIdx >= state.segments.length - 1;
      let nextIdx = activeIdx;
      if (!isLastSegment) {
        nextIdx = activeIdx + 1;
        newSegments[nextIdx] = { ...newSegments[nextIdx], status: "active" };
      }

      const groups = buildSegmentGroups(newSegments);
      const streets = computeStreetCounts(groups);

      set({
        segments: newSegments,
        activeSegmentIndex: nextIdx,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
      });
    },

    completeSegment: (index) => {
      const state = get();
      if (index < 0 || index >= state.segments.length) return;

      const newSegments = [...state.segments];
      newSegments[index] = {
        ...newSegments[index],
        status: "completed",
        linearProgress: 1,
      };

      const completedDistance = newSegments
        .filter((s) => s.status === "completed")
        .reduce((sum, s) => sum + s.distance, 0);
      const completedStops = newSegments.filter(
        (s) => s.status === "completed" && s.collectionPoint,
      ).length;
      const groups = buildSegmentGroups(newSegments);
      const streets = computeStreetCounts(groups);

      set({
        segments: newSegments,
        completedDistance,
        completedStops,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
      });
    },

    skipSegmentByIndex: (index) => {
      const state = get();
      if (index < 0 || index >= state.segments.length) return;

      const newSegments = [...state.segments];
      newSegments[index] = {
        ...newSegments[index],
        status: "skipped",
        linearProgress: 1,
      };

      // skipped distance counts toward progress % so the bar advances
      const completedDistance = newSegments
        .filter((s) => s.status === "completed" || s.status === "skipped")
        .reduce((sum, s) => sum + s.distance, 0);
      const completedStops = newSegments.filter(
        (s) => s.status === "completed" && s.collectionPoint,
      ).length;
      const groups = buildSegmentGroups(newSegments);
      const streets = computeStreetCounts(groups);

      set({
        segments: newSegments,
        completedDistance,
        completedStops,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
      });
    },

    goBackToSegment: (index) => {
      const state = get();
      if (index < 0 || index >= state.segments.length) return;

      const newSegments = state.segments.map((seg, i) => {
        if (i < index)
          return {
            ...seg,
            status: "completed" as SegmentStatus,
            linearProgress: 1,
          };
        if (i === index)
          return {
            ...seg,
            status: "active" as SegmentStatus,
            linearProgress: 0,
          };
        return {
          ...seg,
          status: "pending" as SegmentStatus,
          linearProgress: 0,
        };
      });

      const completedDistance = newSegments
        .filter((s) => s.status === "completed")
        .reduce((sum, s) => sum + s.distance, 0);
      const completedStops = newSegments.filter(
        (s) => s.status === "completed" && s.collectionPoint,
      ).length;
      const groups = buildSegmentGroups(newSegments);
      const streets = computeStreetCounts(groups);

      set({
        segments: newSegments,
        activeSegmentIndex: index,
        completedDistance,
        completedStops,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
      });
    },

    startTracking: () => set({ isTracking: true }),
    stopTracking: () => set({ isTracking: false }),

    resetNavigation: () =>
      set({
        segments: [],
        activeSegmentIndex: 0,
        totalDistance: 0,
        completedDistance: 0,
        completedStops: 0,
        totalStops: 0,
        isTracking: false,
        currentLocation: null,
        segmentGroups: [],
        totalStreets: 0,
        completedStreets: 0,
        activeCollectionPoints: [],
      }),

    setAutoAdvanceRadius: (meters) => set({ autoAdvanceRadius: meters }),

    rerouteFromBreakdown: async () => {
      const state = get();
      const { circuit, streetEdges } = useCircuitStore.getState();
      if (circuit.length === 0) return;

      // Approximate which circuit edge the truck is currently at using the
      // distance-ratio. The re-solve is forgiving of small offsets.
      const ratio =
        state.totalDistance > 0
          ? state.completedDistance / state.totalDistance
          : 0;
      const breakdownIdx = Math.max(
        0,
        Math.floor(ratio * circuit.length) - 1,
      );

      const result = await rerouteAfterBreakdown(circuit, breakdownIdx);
      if (result.circuit.length === 0) return;

      const newRoutePoints = turnCircuitToRoutePoints(
        streetEdges,
        result.circuit,
      );

      // Update circuit store with the re-solved remainder
      useCircuitStore.getState().setCircuit(result.circuit, streetEdges);

      // Re-initialize navigation with the new route, preserving isTracking so
      // the driver's GPS session continues without interruption.
      const wasTracking = state.isTracking;
      const currentLocation = state.currentLocation;
      const collectionPoints = state.activeCollectionPoints;

      const newSegments = buildSegments(
        newRoutePoints.map((p) => ({ lat: p.latitude, lon: p.longitude })),
        collectionPoints,
      );
      const totalDistance = newSegments.reduce((sum, s) => sum + s.distance, 0);
      const totalStops = newSegments.filter((s) => s.collectionPoint).length;
      const groups = buildSegmentGroups(newSegments);
      const streets = computeStreetCounts(groups);

      set({
        segments: newSegments,
        activeSegmentIndex: 0,
        totalDistance,
        completedDistance: 0,
        completedStops: 0,
        totalStops,
        isTracking: wasTracking,
        currentLocation,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
        activeCollectionPoints: collectionPoints,
      });
    },

    insertEmergencyStopAt: async (coords) => {
      const state = get();
      const { circuit, streetEdges } = useCircuitStore.getState();
      if (circuit.length === 0) return;

      // Build a lookup for TurnNode → [lat, lon] using street edge coordinates.
      const edgeLookup = new Map(streetEdges.map((e) => [e.id, e]));
      const coordFn = (node: TurnNode): [number, number] | null => {
        // Detour nodes encode coordinates in their edgeId
        if (node.edgeId.startsWith("detour:")) {
          const parts = node.edgeId.split(":");
          if (parts.length >= 3) {
            return [parseFloat(parts[1]!), parseFloat(parts[2]!)];
          }
          return null;
        }
        const edge = edgeLookup.get(node.edgeId);
        if (!edge || !edge.coordinates.length) return null;
        // The intersection is at the end of the edge in the given direction
        const coord =
          node.direction === "forward"
            ? edge.coordinates[edge.coordinates.length - 1]
            : edge.coordinates[0];
        return coord ? [coord[0], coord[1]] : null;
      };

      const ratio =
        state.totalDistance > 0
          ? state.completedDistance / state.totalDistance
          : 0;
      const currentEdgeIdx = Math.max(
        0,
        Math.floor(ratio * circuit.length) - 1,
      );

      const result = insertEmergencyStop(
        circuit,
        currentEdgeIdx,
        coords,
        coordFn,
      );

      const newRoutePoints = turnCircuitToRoutePoints(
        streetEdges,
        result.circuit,
      );

      // Update circuit store with the updated circuit
      useCircuitStore.getState().setCircuit(result.circuit, streetEdges);

      const wasTracking = state.isTracking;
      const currentLocation = state.currentLocation;
      const collectionPoints = state.activeCollectionPoints;

      const newSegments = buildSegments(
        newRoutePoints.map((p) => ({ lat: p.latitude, lon: p.longitude })),
        collectionPoints,
      );
      const totalDistance = newSegments.reduce((sum, s) => sum + s.distance, 0);
      const totalStops = newSegments.filter((s) => s.collectionPoint).length;
      const groups = buildSegmentGroups(newSegments);
      const streets = computeStreetCounts(groups);

      set({
        segments: newSegments,
        activeSegmentIndex: 0,
        totalDistance,
        completedDistance: 0,
        completedStops: 0,
        totalStops,
        isTracking: wasTracking,
        currentLocation,
        segmentGroups: groups,
        totalStreets: streets.total,
        completedStreets: streets.completed,
        activeCollectionPoints: collectionPoints,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useCollectionSegments = () =>
  useCollectionNavigationStore(useShallow((s) => s.segments));

export const useActiveSegment = () =>
  useCollectionNavigationStore(
    useShallow((s) => s.segments[s.activeSegmentIndex] ?? null),
  );

export const useSegmentGroups = () =>
  useCollectionNavigationStore(useShallow((s) => s.segmentGroups));

export const useCollectionProgress = () =>
  useCollectionNavigationStore(
    useShallow((s) => ({
      completedDistance: s.completedDistance,
      totalDistance: s.totalDistance,
      completedStops: s.completedStops,
      totalStops: s.totalStops,
      activeSegmentIndex: s.activeSegmentIndex,
      totalSegments: s.segments.length,
      completedStreets: s.completedStreets,
      totalStreets: s.totalStreets,
      percentage:
        s.totalDistance > 0
          ? Math.round((s.completedDistance / s.totalDistance) * 100)
          : 0,
    })),
  );

export const useIsCollectionActive = () =>
  useCollectionNavigationStore((s) => s.segments.length > 0 && s.isTracking);
