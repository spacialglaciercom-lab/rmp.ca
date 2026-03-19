/**
 * Shared hook that computes route display stats consumed by both Minimal and Full modes.
 *
 * Returns: distance (km), stops remaining, completed stops, ETA (minutes),
 *          next stop, completion percentage, and the full stop list.
 */

import { useMemo } from "react";
import { useMapStateStore } from "@/stores/mapStateStore";
import { useShallow } from "zustand/shallow";
import type { CollectionPoint } from "@/types";
import { haversineDistance } from "@/lib/route-calculator";

export interface RouteDisplayStats {
  totalStops: number;
  completedStops: number;
  remainingStops: number;
  completionPct: number;
  /** Estimated remaining distance in km (straight-line sum between pending stops). */
  distanceKm: number;
  /** Estimated time remaining in minutes. */
  etaMinutes: number;
  /** The next pending stop (first non-completed stop in order). */
  nextStop: CollectionPoint | null;
  /** Index of the next pending stop in the full list. */
  nextStopIndex: number;
  /** All stops in route order. */
  stops: CollectionPoint[];
  /** Route polyline coordinates (from backend/optimization). */
  routeCoords: Array<{ lat: number; lon: number }>;
  hasRoute: boolean;
}

const AVG_SPEED_KMH = 25;

export function formatEta(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function useRouteDisplayData(): RouteDisplayStats {
  const { route, collectionPoints, routePoints } = useMapStateStore(
    useShallow((s) => ({
      route: s.route,
      collectionPoints: s.collectionPoints,
      routePoints: s.routePoints,
    })),
  );

  return useMemo(() => {
    const stops: CollectionPoint[] = route?.points ?? collectionPoints ?? [];
    const totalStops = stops.length;
    const completedStops = stops.filter((s) => s.status === "completed").length;
    const remainingStops = totalStops - completedStops;
    const completionPct =
      totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0;

    let nextStop: CollectionPoint | null = null;
    let nextStopIndex = -1;
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].status !== "completed") {
        nextStop = stops[i];
        nextStopIndex = i;
        break;
      }
    }

    let distanceKm = 0;
    if (route?.estimatedDuration && totalStops > 0) {
      distanceKm = (route.estimatedDuration / 60) * AVG_SPEED_KMH;
      if (completedStops > 0 && totalStops > 0) {
        distanceKm *= remainingStops / totalStops;
      }
    } else if (nextStopIndex >= 0) {
      for (let i = nextStopIndex; i < stops.length - 1; i++) {
        distanceKm += haversineDistance(
          stops[i].latitude,
          stops[i].longitude,
          stops[i + 1].latitude,
          stops[i + 1].longitude,
        );
      }
    }
    distanceKm = Math.round(distanceKm * 10) / 10;

    let etaMinutes: number;
    if (route?.estimatedDuration && totalStops > 0 && remainingStops > 0) {
      etaMinutes = Math.round(
        route.estimatedDuration * (remainingStops / totalStops),
      );
    } else {
      etaMinutes = Math.round((distanceKm / AVG_SPEED_KMH) * 60);
    }

    return {
      totalStops,
      completedStops,
      remainingStops,
      completionPct,
      distanceKm,
      etaMinutes,
      nextStop,
      nextStopIndex,
      stops,
      routeCoords: routePoints,
      hasRoute: totalStops > 0 || routePoints.length > 0,
    };
  }, [route, collectionPoints, routePoints]);
}
