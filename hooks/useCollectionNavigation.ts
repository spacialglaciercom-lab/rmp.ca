/**
 * Hook for collection route navigation with live GPS tracking.
 *
 * Manages the GPS subscription lifecycle, feeds location updates into the
 * collectionNavigationStore, and provides voice announcements for segment
 * transitions and right-arm collection points.
 *
 * For split Overture segments, voice announcements use grouped street view:
 * the full street name is announced once when entering the first sub-segment
 * of a source_id group, not repeated for every sub-segment transition.
 */

import { useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import { useShallow } from "zustand/shallow";
import { useCollectionNavigationStore } from "@/stores/collectionNavigationStore";
import type { CollectionPoint } from "@/types";

interface UseCollectionNavigationOptions {
  routePoints: Array<{ lat: number; lon: number }>;
  collectionPoints: CollectionPoint[];
  autoStart?: boolean;
  voiceEnabled?: boolean;
}

export function useCollectionNavigation(
  options: UseCollectionNavigationOptions,
) {
  const {
    routePoints,
    collectionPoints,
    autoStart = false,
    voiceEnabled = true,
  } = options;

  const activeSegmentIndex = useCollectionNavigationStore(
    (s) => s.activeSegmentIndex,
  );
  const segments = useCollectionNavigationStore(useShallow((s) => s.segments));
  const isTracking = useCollectionNavigationStore((s) => s.isTracking);
  const segmentGroups = useCollectionNavigationStore((s) => s.segmentGroups);

  const locationSubRef = useRef<{ remove: () => void } | null>(null);
  const prevActiveIdx = useRef<number>(0);
  const prevSourceGroupKey = useRef<string | null>(null);
  const initialized = useRef(false);

  // Initialize route segments when inputs change
  useEffect(() => {
    if (routePoints.length < 2) return;
    useCollectionNavigationStore
      .getState()
      .initRoute(routePoints, collectionPoints);
    initialized.current = true;
    prevActiveIdx.current = 0;
    prevSourceGroupKey.current = null;

    if (autoStart) {
      useCollectionNavigationStore.getState().startTracking();
    }
  }, [routePoints, collectionPoints, autoStart]);

  // Voice announcement on segment change
  useEffect(() => {
    if (activeSegmentIndex === prevActiveIdx.current) return;
    prevActiveIdx.current = activeSegmentIndex;

    if (!voiceEnabled) return;

    const segment = segments[activeSegmentIndex];
    if (!segment) return;

    const currentSourceKey = segment.source_id ?? `__single_${segment.index}`;

    const isNewStreetGroup = currentSourceKey !== prevSourceGroupKey.current;
    prevSourceGroupKey.current = currentSourceKey;

    const segmentGroups = useCollectionNavigationStore.getState().segmentGroups;
    const group = segmentGroups?.find((g) =>
      g.segmentIndices.includes(activeSegmentIndex),
    );

    const cp = segment.collectionPoint;
    let text = "";

    const shouldAnnounceStreet = !segment.was_split || isNewStreetGroup;

    if (shouldAnnounceStreet) {
      if (group && segment.was_split && group.subSegmentCount > 1) {
        text = `Turning onto ${group.streetName}.`;
      } else {
        text = `Segment ${activeSegmentIndex + 1} of ${segments.length}.`;
      }
    }

    // Always announce collection points regardless of split segment position
    if (cp) {
      const side = segment.isRightSide ? "right" : "left";
      text += ` Collection point on the ${side}: ${cp.address || "upcoming stop"}.`;
      if (cp.specialInstructions) {
        text += ` Note: ${cp.specialInstructions}`;
      }
    }

    if (text.trim()) {
      try {
        speak(text);
      } catch (err) {
        console.warn("[CollectionNav] Voice announcement failed:", err);
      }
    }
  }, [activeSegmentIndex, segments, voiceEnabled]);

  // GPS subscription lifecycle
  const startGPS = useCallback(async () => {
    if (Platform.OS === "web") return;

    try {
      const Location = await import("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (loc) => {
          useCollectionNavigationStore.getState().updateLocation({
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            bearing: loc.coords.heading ?? undefined,
            speed: loc.coords.speed ?? undefined,
          });
        },
      );

      useCollectionNavigationStore.getState().startTracking();
    } catch (err) {
      console.warn("[CollectionNav] GPS start failed:", err);
    }
  }, []);

  const stopGPS = useCallback(() => {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
    useCollectionNavigationStore.getState().stopTracking();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
    };
  }, []);

  return {
    segments,
    activeSegmentIndex,
    isTracking,
    initRoute: useCollectionNavigationStore.getState().initRoute,
    startTracking: useCollectionNavigationStore.getState().startTracking,
    startGPS,
    stopGPS,
    isInitialized: initialized.current,
  };
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

function speak(text: string): void {
  const { speakNavigation } = require("@/lib/expoSpeechVoice");
  speakNavigation(text);
}
