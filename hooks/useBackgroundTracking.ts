/**
 * Background location tracking for GPS track recording (native only).
 * Uses expo-task-manager + expo-location startLocationUpdatesAsync.
 * On web this module exports no-op functions.
 */

import { Platform } from "react-native";
import { trackStorage, type TrackPoint } from "@/lib/track-storage";
import {
  useRecordingSettingsStore,
  loggingIntervalSecondsToDistanceMeters,
} from "@/stores/recordingSettingsStore";

const TASK_NAME = "TRACK_RECORDING_TASK";

// Register background task at module scope (required by TaskManager)
if (Platform.OS !== "web") {
  try {
    const TaskManager = require("expo-task-manager");
    TaskManager.defineTask(
      TASK_NAME,
      ({
        data,
        error,
      }: {
        data?: { locations?: Array<{ coords: any; timestamp: number }> };
        error?: any;
      }) => {
        if (error) {
          console.error("[BgTracking] Task error:", error);
          return;
        }
        const locations = data?.locations;
        if (!locations || locations.length === 0) return;

        const points: TrackPoint[] = locations.map((loc) => ({
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          altitude: loc.coords.altitude ?? null,
          timestamp: loc.timestamp ?? Date.now(),
          speed: loc.coords.speed ?? null,
          accuracy: loc.coords.accuracy ?? null,
        }));

        // Write to buffer (async, fire-and-forget in background task)
        trackStorage.appendBgBuffer(points).catch(() => {});
      },
    );
  } catch {
    // expo-task-manager not available
  }
}

export async function startBackgroundTracking(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const { loggingIntervalSeconds } = useRecordingSettingsStore.getState();
    const distanceInterval = loggingIntervalSecondsToDistanceMeters(
      loggingIntervalSeconds,
    );
    const Location = await import("expo-location");
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== "granted") {
      console.warn("[BgTracking] Background location permission denied");
      return;
    }

    const isRegistered = await (
      await import("expo-task-manager")
    ).isTaskRegisteredAsync(TASK_NAME);
    if (isRegistered) return; // already running

    const options: Parameters<typeof Location.startLocationUpdatesAsync>[1] = {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "RouteMasterPro",
        notificationBody: "Recording track...",
        notificationColor: "#2196F3",
      },
    };
    if (Platform.OS === "android") {
      (options as any).timeInterval = loggingIntervalSeconds * 1000;
    }
    await Location.startLocationUpdatesAsync(TASK_NAME, options);
  } catch (err) {
    console.warn("[BgTracking] Failed to start:", err);
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const Location = await import("expo-location");
    const TaskManager = await import("expo-task-manager");
    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch (err) {
    console.warn("[BgTracking] Failed to stop:", err);
  }
}
