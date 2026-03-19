/**
 * Expo Speech voice selection — list device voices and build options for speak().
 * Used by navigation announcements and Co-Pilot fallback TTS.
 */

import { useRouteParametersStore } from "@/stores/routeParametersStore";
import { recordErrorToCrashlytics } from "@/lib/crashlytics-report";

export interface ExpoSpeechVoice {
  identifier?: string;
  name?: string;
  language?: string;
  quality?: number;
}

/** Options to pass to Speech.speak(text, options). */
export interface ExpoSpeechOptions {
  language: string;
  rate: number;
  pitch: number;
  voiceIndex?: number;
}

/**
 * Returns available system TTS voices (iOS/Android/Web).
 * Returns [] on web if unsupported or on error.
 */
export async function getAvailableExpoVoicesAsync(): Promise<
  ExpoSpeechVoice[]
> {
  try {
    const Speech = await import("expo-speech");
    if (typeof Speech.getAvailableVoicesAsync !== "function") return [];
    const list = await Speech.getAvailableVoicesAsync();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Returns speak options including the user-selected voice index (clamped to available voices).
 * Use when calling Speech.speak(text, await getExpoSpeechOptions()).
 */
export async function getExpoSpeechOptions(options?: {
  rate?: number;
  pitch?: number;
  language?: string;
}): Promise<ExpoSpeechOptions> {
  const store = useRouteParametersStore.getState();
  const voiceIndex = store.expoVoiceIndex ?? 0;
  const voices = await getAvailableExpoVoicesAsync();
  const clampedIndex =
    voices.length > 0 && voiceIndex >= 0 && voiceIndex < voices.length
      ? voiceIndex
      : undefined;

  return {
    language: options?.language ?? "en-US",
    rate: options?.rate ?? 0.9,
    pitch: options?.pitch ?? 1.0,
    ...(clampedIndex !== undefined && { voiceIndex: clampedIndex }),
  };
}

/**
 * Shared TTS speak function for navigation announcements.
 * Checks voiceAssistanceEnabled, uses expo-speech, and reports errors to Crashlytics.
 */
export function speakNavigation(text: string): void {
  try {
    if (!useRouteParametersStore.getState().voiceAssistanceEnabled) return;

    getExpoSpeechOptions({ rate: 0.9, pitch: 1.0 })
      .then((opts) =>
        import("expo-speech").then((Speech) => Speech.speak(text, opts)),
      )
      .catch((err) => {
        recordErrorToCrashlytics(
          err instanceof Error ? err : new Error(String(err)),
          "tts_speak_error",
          { text: text.slice(0, 100) },
        );
      });
  } catch (err) {
    recordErrorToCrashlytics(
      err instanceof Error ? err : new Error(String(err)),
      "tts_init_error",
    );
  }
}
