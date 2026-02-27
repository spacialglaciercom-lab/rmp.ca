/**
 * Co-Pilot Audio Service — Recording + TTS for the AI driving companion.
 *
 * Handles:
 * - Push-to-talk audio recording via expo-audio
 * - Text-to-speech responses via expo-speech (distinct voice from nav announcements)
 * - Audio permission management
 */
import { Platform } from "react-native";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RecordingResult {
  /** URI to the recorded audio file (local file path). */
  uri: string;
  /** Duration in milliseconds. */
  durationMs: number;
}

// ── Recording ───────────────────────────────────────────────────────────────

let activeRecording: any = null; // native: expo-audio AudioRecorder, web: MediaRecorder
let nativeStartTime = 0;
let webChunks: Blob[] = [];
let webStream: MediaStream | null = null;
let webStartTime = 0;

/**
 * Request microphone permissions. Returns true if granted.
 */
export async function requestMicPermission(): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    }
    const { requestRecordingPermissionsAsync } = await import("expo-audio");
    const status = await requestRecordingPermissionsAsync();
    return status.granted;
  } catch {
    return false;
  }
}

/**
 * Start recording audio. Call stopRecording() to get the result.
 */
export async function startRecording(): Promise<void> {
  if (activeRecording) {
    console.warn("[CoPilotAudio] Recording already in progress");
    return;
  }

  try {
    if (Platform.OS === "web") {
      // Web: use native MediaRecorder API
      webStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      webChunks = [];
      webStartTime = Date.now();
      const recorder = new MediaRecorder(webStream, {
        mimeType: "audio/webm;codecs=opus",
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) webChunks.push(e.data);
      };
      recorder.start(250); // collect chunks every 250ms
      activeRecording = recorder;
    } else {
      // Native: use expo-audio AudioRecorder API
      const { AudioModule, setAudioModeAsync } = await import("expo-audio");

      // iOS requires allowsRecording before recording. allowsBackgroundRecording lets recording
      // continue if app goes to background (expo-audio 1.1.0+ requirement).
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: true,
      });

      const recorder = new AudioModule.AudioRecorder({
        extension: ".m4a",
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 64000,
        ios: {
          outputFormat: "aac",
          audioQuality: 0.5,
        },
        android: {
          outputFormat: "mpeg4",
          audioEncoder: "aac",
        },
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      nativeStartTime = Date.now();
      activeRecording = recorder;
    }
  } catch (error) {
    activeRecording = null;
    webStream?.getTracks().forEach((t) => t.stop());
    webStream = null;
    console.error("[CoPilotAudio] Failed to start recording:", error);
    throw error;
  }
}

/**
 * Stop recording and return the audio file URI.
 */
export async function stopRecording(): Promise<RecordingResult | null> {
  if (!activeRecording) {
    console.warn("[CoPilotAudio] No active recording to stop");
    return null;
  }

  try {
    if (Platform.OS === "web") {
      const recorder = activeRecording as MediaRecorder;
      const durationMs = Date.now() - webStartTime;

      return new Promise<RecordingResult | null>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(webChunks, { type: "audio/webm" });
          const uri = URL.createObjectURL(blob);
          webStream?.getTracks().forEach((t) => t.stop());
          webStream = null;
          activeRecording = null;
          webChunks = [];
          resolve({ uri, durationMs });
        };
        recorder.stop();
      });
    } else {
      // Native: expo-audio AudioRecorder
      await activeRecording.stop();
      const uri = activeRecording.uri;
      const durationMs = Date.now() - nativeStartTime;
      activeRecording = null;

      // Restore audio mode for playback
      try {
        const { setAudioModeAsync } = await import("expo-audio");
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch {}

      if (!uri) {
        console.warn("[CoPilotAudio] Recording produced no URI");
        return null;
      }
      return { uri, durationMs };
    }
  } catch (error) {
    activeRecording = null;
    webStream?.getTracks().forEach((t) => t.stop());
    webStream = null;
    console.error("[CoPilotAudio] Failed to stop recording:", error);
    return null;
  }
}

/**
 * Check if currently recording.
 */
export function isRecording(): boolean {
  return activeRecording !== null;
}

// ── Text-to-Speech ──────────────────────────────────────────────────────────

let isSpeakingNow = false;

/**
 * Speak a co-pilot response via TTS.
 *
 * Priority: ElevenLabs (if enabled + key set) → expo-speech fallback.
 * ElevenLabs gives high-quality AI voices the user can choose from.
 * expo-speech uses a slightly lower pitch so the driver can distinguish
 * the co-pilot from nav instructions.
 */
export async function speakResponse(text: string): Promise<void> {
  try {
    // Try ElevenLabs first (if enabled and API key is set)
    try {
      const { speakWithElevenLabs } = await import("@/services/elevenLabsTtsService");
      const handled = await speakWithElevenLabs(text);
      if (handled) {
        isSpeakingNow = false;
        return;
      }
    } catch {
      // ElevenLabs unavailable, fall through to expo-speech
    }

    // Fallback: expo-speech (uses user-selected system voice from route params)
    const Speech = await import("expo-speech");
    const { getExpoSpeechOptions } = await import("@/lib/expoSpeechVoice");
    const opts = await getExpoSpeechOptions({ rate: 1.0, pitch: 0.95 });

    await Speech.stop();

    return new Promise<void>((resolve) => {
      isSpeakingNow = true;
      Speech.speak(text, {
        ...opts,
        onDone: () => {
          isSpeakingNow = false;
          resolve();
        },
        onError: () => {
          isSpeakingNow = false;
          resolve();
        },
      });
    });
  } catch {
    isSpeakingNow = false;
  }
}

/**
 * Stop any ongoing TTS speech.
 */
export async function stopSpeaking(): Promise<void> {
  try {
    // Stop ElevenLabs if active
    try {
      const { stopElevenLabsSpeaking } = await import("@/services/elevenLabsTtsService");
      await stopElevenLabsSpeaking();
    } catch {
      // ignore
    }

    // Stop expo-speech
    const Speech = await import("expo-speech");
    await Speech.stop();
    isSpeakingNow = false;
  } catch {
    isSpeakingNow = false;
  }
}

/**
 * Check if the co-pilot is currently speaking.
 */
export function isSpeaking(): boolean {
  return isSpeakingNow;
}
