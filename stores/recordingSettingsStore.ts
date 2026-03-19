import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Logging interval: time in seconds (1–60). Shown in UI; on Android used as timeInterval; on iOS we use a derived distanceInterval. */
export const LOGGING_INTERVAL_SEC_MIN = 1;
export const LOGGING_INTERVAL_SEC_MAX = 60;
export const LOGGING_INTERVAL_SEC_DEFAULT = 5;

/** Convert seconds to a distance interval for iOS (distanceInterval only; timeInterval is Android-only). Rough: ~2 m/s walking, ~10 m/s driving. */
export function loggingIntervalSecondsToDistanceMeters(
  seconds: number,
): number {
  return Math.max(5, Math.min(100, Math.round(seconds * 3)));
}

export interface RecordingSettingsState {
  /** Log a point every this many seconds (UI and Android timeInterval). */
  loggingIntervalSeconds: number;
  /** When true, don't show "START TRIP RECORDING" modal when opening REC; use saved settings. */
  rememberMyChoice: boolean;
  /** When true, show a REC indicator on the map while recording. */
  showRecOnMapWhenRecording: boolean;
}

interface RecordingSettingsStore extends RecordingSettingsState {
  setLoggingIntervalSeconds: (v: number) => void;
  setRememberMyChoice: (v: boolean) => void;
  setShowRecOnMapWhenRecording: (v: boolean) => void;
}

const initialState: RecordingSettingsState = {
  loggingIntervalSeconds: LOGGING_INTERVAL_SEC_DEFAULT,
  rememberMyChoice: false,
  showRecOnMapWhenRecording: true,
};

export const useRecordingSettingsStore = create<RecordingSettingsStore>()(
  persist(
    (set) => ({
      ...initialState,
      setLoggingIntervalSeconds: (v) =>
        set({
          loggingIntervalSeconds: Math.max(
            LOGGING_INTERVAL_SEC_MIN,
            Math.min(LOGGING_INTERVAL_SEC_MAX, Math.round(v)),
          ),
        }),
      setRememberMyChoice: (v) => set({ rememberMyChoice: v }),
      setShowRecOnMapWhenRecording: (v) =>
        set({ showRecOnMapWhenRecording: v }),
    }),
    {
      name: "trashroute-recording-settings",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        loggingIntervalSeconds: s.loggingIntervalSeconds,
        rememberMyChoice: s.rememberMyChoice,
        showRecOnMapWhenRecording: s.showRecOnMapWhenRecording,
      }),
    },
  ),
);
