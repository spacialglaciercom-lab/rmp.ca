/**
 * Core GPS track recording hook.
 * Manages start/pause/resume/stop/discard lifecycle.
 * Reuses watchPositionAsync pattern from NavigationEngine.ts.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Platform } from "react-native";
import { haversineDistance } from "@/lib/offlineTurnDetection";
import { trackStorage, type TrackPoint } from "@/lib/track-storage";
import { createLogger } from "@/lib/logger";
import {
  useRecordingSettingsStore,
  loggingIntervalSecondsToDistanceMeters,
} from "@/stores/recordingSettingsStore";

const log = createLogger("TrackRecorder");

export type RecorderStatus = "idle" | "recording" | "paused";

export interface RecorderState {
  status: RecorderStatus;
  points: TrackPoint[];
  startTime: number | null;
  elapsedMs: number;
  totalDistanceMeters: number;
  currentPosition: TrackPoint | null;
  /** Direction of travel in degrees (0–360), when available from GPS. */
  currentHeading: number | null;
}

const INITIAL_STATE: RecorderState = {
  status: "idle",
  points: [],
  startTime: null,
  elapsedMs: 0,
  totalDistanceMeters: 0,
  currentPosition: null,
  currentHeading: null,
};

/** How often we push point array updates to React state (ms). */
const UI_BATCH_INTERVAL = 2000;

export function useTrackRecorder() {
  const [state, setState] = useState<RecorderState>(INITIAL_STATE);

  // Internal mutable refs so the GPS callback doesn't need React state
  const internalPoints = useRef<TrackPoint[]>([]);
  const internalDistance = useRef(0);
  const lastPoint = useRef<TrackPoint | null>(null);
  const locationSub = useRef<{ remove: () => void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedBase = useRef(0); // accumulated ms before current resume
  const resumeTimestamp = useRef(0); // when current recording/resume started
  const bgTrackingRef = useRef<{ start: () => Promise<void>; stop: () => Promise<void> } | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        locationSub.current?.remove();
      } catch {
        // expo-location removeSubscription not available on web
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (batchTimerRef.current) clearInterval(batchTimerRef.current);
    };
  }, []);

  const onLocationUpdate = useCallback((loc: {
    coords: {
      latitude: number;
      longitude: number;
      altitude?: number | null;
      heading?: number | null;
      speed?: number | null;
      accuracy?: number | null;
    };
    timestamp?: number;
  }) => {
    const point: TrackPoint = {
      lat: loc.coords.latitude,
      lon: loc.coords.longitude,
      altitude: loc.coords.altitude ?? null,
      timestamp: loc.timestamp ?? Date.now(),
      speed: loc.coords.speed ?? null,
      accuracy: loc.coords.accuracy ?? null,
    };

    // Accumulate distance
    if (lastPoint.current) {
      internalDistance.current += haversineDistance(lastPoint.current, point);
    }
    lastPoint.current = point;
    internalPoints.current.push(point);

    // Update currentPosition and heading immediately for the map
    const heading = loc.coords.heading != null && !Number.isNaN(loc.coords.heading) ? loc.coords.heading : null;
    setState((prev) => ({
      ...prev,
      currentPosition: point,
      currentHeading: heading ?? prev.currentHeading,
    }));
  }, []);

  const startTimers = useCallback(() => {
    resumeTimestamp.current = Date.now();

    // Elapsed time ticker (1s)
    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = elapsedBase.current + (now - resumeTimestamp.current);
      setState((prev) => ({ ...prev, elapsedMs: elapsed }));
    }, 1000);

    // Batch UI update for points/distance (2s)
    batchTimerRef.current = setInterval(() => {
      setState((prev) => ({
        ...prev,
        points: [...internalPoints.current],
        totalDistanceMeters: internalDistance.current,
      }));
    }, UI_BATCH_INTERVAL);
  }, []);

  const stopTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (batchTimerRef.current) {
      clearInterval(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    // Freeze elapsed
    const now = Date.now();
    elapsedBase.current = elapsedBase.current + (now - resumeTimestamp.current);
  }, []);

  const startLocationWatch = useCallback(async () => {
    if (Platform.OS === "web") {
      // Use browser Geolocation API directly — expo-location's web
      // implementation has a broken removeSubscription method.
      if (!navigator.geolocation) {
        throw new Error("Geolocation not supported in this browser");
      }
      const handlePos = (pos: GeolocationPosition) => {
        onLocationUpdate({
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            accuracy: pos.coords.accuracy,
          },
          timestamp: pos.timestamp,
        });
      };
      const watchId = navigator.geolocation.watchPosition(
        handlePos,
        (err) => log.error("Geolocation error", err instanceof Error ? err : new Error(String(err))),
        { enableHighAccuracy: true, maximumAge: 1000 }
      );
      // Poll every 3s so points accumulate even when stationary
      // (watchPosition only fires on position change)
      const pollId = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          handlePos,
          () => {},
          { enableHighAccuracy: true, maximumAge: 0 }
        );
      }, 3000);
      locationSub.current = {
        remove: () => {
          navigator.geolocation.clearWatch(watchId);
          clearInterval(pollId);
        },
      };
    } else {
      try {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          throw new Error("Location permission required");
        }

        const { loggingIntervalSeconds } = useRecordingSettingsStore.getState();
        const distanceInterval = loggingIntervalSecondsToDistanceMeters(loggingIntervalSeconds);
        const watchOptions: Parameters<typeof Location.watchPositionAsync>[0] = {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval,
          timeInterval: loggingIntervalSeconds * 1000,
        };
        locationSub.current = await Location.watchPositionAsync(
          watchOptions,
          (loc: any) => onLocationUpdate(loc)
        );
      } catch (err) {
        log.error("Failed to start location watch", err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    }
  }, [onLocationUpdate]);

  const stopLocationWatch = useCallback(() => {
    try {
      locationSub.current?.remove();
    } catch (err) {
      log.warn("stopLocationWatch: remove() failed, clearing ref", { error: err instanceof Error ? err.message : String(err) });
    }
    locationSub.current = null;
  }, []);

  // Load background tracking module lazily on native
  const ensureBgTracking = useCallback(async () => {
    if (Platform.OS === "web" || bgTrackingRef.current) return;
    try {
      const mod = await import("@/hooks/useBackgroundTracking");
      bgTrackingRef.current = {
        start: mod.startBackgroundTracking,
        stop: mod.stopBackgroundTracking,
      };
    } catch {
      // expo-task-manager not available, skip background
    }
  }, []);

  const start = useCallback(async () => {
    // Reset state
    internalPoints.current = [];
    internalDistance.current = 0;
    lastPoint.current = null;
    elapsedBase.current = 0;
    await trackStorage.clearBgBuffer();

    await startLocationWatch();
    startTimers();

    // Start background tracking on native
    await ensureBgTracking();
    bgTrackingRef.current?.start();

    setState({
      status: "recording",
      points: [],
      startTime: Date.now(),
      elapsedMs: 0,
      totalDistanceMeters: 0,
      currentPosition: null,
      currentHeading: null,
    });
  }, [startLocationWatch, startTimers, ensureBgTracking]);

  const pause = useCallback(() => {
    stopLocationWatch();
    stopTimers();
    bgTrackingRef.current?.stop();

    // Flush latest points to state
    setState((prev) => ({
      ...prev,
      status: "paused",
      points: [...internalPoints.current],
      totalDistanceMeters: internalDistance.current,
      elapsedMs: elapsedBase.current,
    }));
  }, [stopLocationWatch, stopTimers]);

  const resume = useCallback(async () => {
    // Merge any points from background buffer
    const bgPoints = await trackStorage.readBgBuffer();
    if (bgPoints.length > 0) {
      for (const p of bgPoints) {
        if (lastPoint.current) {
          internalDistance.current += haversineDistance(lastPoint.current, p);
        }
        lastPoint.current = p;
        internalPoints.current.push(p);
      }
      await trackStorage.clearBgBuffer();
    }

    await startLocationWatch();
    startTimers();
    await ensureBgTracking();
    bgTrackingRef.current?.start();

    setState((prev) => ({
      ...prev,
      status: "recording",
      points: [...internalPoints.current],
      totalDistanceMeters: internalDistance.current,
    }));
  }, [startLocationWatch, startTimers, ensureBgTracking]);

  const stop = useCallback(async (): Promise<RecorderState> => {
    stopLocationWatch();
    stopTimers();
    bgTrackingRef.current?.stop();

    // Merge background buffer
    const bgPoints = await trackStorage.readBgBuffer();
    if (bgPoints.length > 0) {
      for (const p of bgPoints) {
        if (lastPoint.current) {
          internalDistance.current += haversineDistance(lastPoint.current, p);
        }
        lastPoint.current = p;
        internalPoints.current.push(p);
      }
      await trackStorage.clearBgBuffer();
    }

    const finalState: RecorderState = {
      status: "idle",
      points: [...internalPoints.current],
      startTime: null,
      elapsedMs: elapsedBase.current,
      totalDistanceMeters: internalDistance.current,
      currentPosition: lastPoint.current,
      currentHeading: null,
    };

    setState(INITIAL_STATE);
    return finalState;
  }, [stopLocationWatch, stopTimers]);

  const discard = useCallback(() => {
    stopLocationWatch();
    stopTimers();
    bgTrackingRef.current?.stop();
    trackStorage.clearBgBuffer();

    internalPoints.current = [];
    internalDistance.current = 0;
    lastPoint.current = null;
    elapsedBase.current = 0;

    setState(INITIAL_STATE);
  }, [stopLocationWatch, stopTimers]);

  return { state, start, pause, resume, stop, discard };
}
