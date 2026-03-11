/**
 * ElevenLabs TTS & STT Service — High-quality AI voice synthesis and transcription.
 *
 * Prefers server proxy when ELEVENLABS_API_KEY is set on the server (Railway env) — no key on client.
 * Otherwise uses client-stored API key (settings) and calls ElevenLabs directly.
 * Falls back to expo-speech (TTS) or server Whisper (STT) if ElevenLabs is unavailable.
 */
import { Platform } from "react-native";
import {
  getElevenLabsApiKey,
  getElevenLabsVoiceId,
  isElevenLabsEnabled,
} from "@/lib/elevenlabs-config";
import { createLogger } from "@/lib/logger";

const log = createLogger("ElevenLabs");

/** Get API base URL for server proxy (same as AI Gateway). */
function getApiBaseUrl(): string {
  try {
    const { getApiBaseUrl: get } = require("@/shared/oauth");
    return get();
  } catch {
    return "";
  }
}

/** Check if server has ElevenLabs key (proxy available). */
async function isServerProxyConfigured(): Promise<boolean> {
  const base = getApiBaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/elevenlabs/status`);
    if (!res.ok) return false;
    const data = (await res.json()) as { configured?: boolean };
    return data.configured === true;
  } catch {
    return false;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string; // "premade", "cloned", "generated"
  labels: Record<string, string>; // e.g. { accent: "american", age: "young", gender: "male" }
  preview_url: string | null;
}

// ── Voice listing ───────────────────────────────────────────────────────────

let _voiceCache: { voices: ElevenLabsVoice[]; ts: number } | null = null;
const VOICE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch available voices from ElevenLabs.
 * Uses server proxy when ELEVENLABS_API_KEY is set on server; otherwise uses client API key.
 */
export async function listVoices(): Promise<ElevenLabsVoice[]> {
  if (_voiceCache && Date.now() - _voiceCache.ts < VOICE_CACHE_TTL) {
    return _voiceCache.voices;
  }

  const base = getApiBaseUrl();
  if (base) {
    try {
      const res = await fetch(`${base}/api/elevenlabs/voices`);
      if (res.ok) {
        const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
        const voices = data.voices ?? [];
        log.debug("Voices via server proxy", { count: voices.length });
        _voiceCache = { voices, ts: Date.now() };
        return voices;
      }
    } catch (err) {
      log.warn("Server proxy voices failed, trying client key", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const apiKey = await getElevenLabsApiKey();
  if (!apiKey) return [];

  try {
    const [personalResp, sharedResp] = await Promise.all([
      fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
      }),
      fetch(
        "https://api.elevenlabs.io/v1/shared-voices?page_size=100&sort=trending&category=professional",
        {
          headers: { "xi-api-key": apiKey },
        },
      ).catch(() => null),
    ]);
    const allVoices: ElevenLabsVoice[] = [];
    const seenIds = new Set<string>();
    if (personalResp.ok) {
      const data = await personalResp.json();
      for (const v of data.voices ?? []) {
        if (!seenIds.has(v.voice_id)) {
          seenIds.add(v.voice_id);
          allVoices.push({
            voice_id: v.voice_id,
            name: v.name,
            category: v.category ?? "premade",
            labels: v.labels ?? {},
            preview_url: v.preview_url ?? null,
          });
        }
      }
    }
    if (sharedResp?.ok) {
      const sharedData = await sharedResp.json();
      for (const v of sharedData.voices ?? []) {
        const id = v.voice_id ?? v.public_owner_id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allVoices.push({
            voice_id: id,
            name: v.name,
            category: v.category ?? "shared",
            labels: v.labels ?? {},
            preview_url: v.preview_url ?? null,
          });
        }
      }
    }
    _voiceCache = { voices: allVoices, ts: Date.now() };
    return allVoices;
  } catch (err) {
    log.warn("Failed to list voices", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── TTS Playback ────────────────────────────────────────────────────────────

let _currentAudio: any = null; // HTMLAudioElement (web) or expo-audio AudioPlayer (native)
let _isSpeaking = false;
/** Stored reference to voice-preview playback listener so it can be removed on stop or end. */
let _previewStatusListener: ((status: any) => void) | null = null;

/** Play an audio blob (web: HTML5 Audio; native: expo-audio). Returns true when done. */
async function playAudioBlob(audioBlob: Blob): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audio.volume = 1.0;
      _currentAudio = audio;
      return new Promise<boolean>((resolve) => {
        audio.onended = () => {
          _isSpeaking = false;
          _currentAudio = null;
          URL.revokeObjectURL(url);
          resolve(true);
        };
        audio.onerror = () => {
          _isSpeaking = false;
          _currentAudio = null;
          URL.revokeObjectURL(url);
          resolve(false);
        };
        audio.play().catch(() => {
          _isSpeaking = false;
          _currentAudio = null;
          URL.revokeObjectURL(url);
          resolve(false);
        });
      });
    }
    const { createAudioPlayer } = await import("expo-audio");
    const uri = await blobToFileUri(audioBlob);
    const player = createAudioPlayer(uri);
    _currentAudio = player;
    try {
      if (typeof (player as { volume?: number }).volume === "number") {
        (player as { volume: number }).volume = 1.0;
      }
    } catch {
      // volume may not exist on all platforms
    }
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const onStatus = (status: any) => {
        if (!resolved && status.playing === false && status.currentTime > 0) {
          resolved = true;
          _isSpeaking = false;
          _currentAudio = null;
          try {
            player.remove?.("playbackStatusUpdate", onStatus);
          } catch {}
          try {
            player.release?.();
          } catch {}
          resolve(true);
        }
      };
      try {
        player.addListener("playbackStatusUpdate", onStatus);
      } catch {}
      player.play();
    });
  } catch (err) {
    _isSpeaking = false;
    return false;
  }
}

/**
 * Speak text using ElevenLabs TTS.
 * Returns true if ElevenLabs handled it, false if caller should fall back.
 */
export async function speakWithElevenLabs(text: string): Promise<boolean> {
  const enabled = await isElevenLabsEnabled();
  if (!enabled) return false;

  const voiceId = await getElevenLabsVoiceId();
  const voice = voiceId ?? "21m00Tcm4TlvDq8ikWAM";

  const base = getApiBaseUrl();
  if (base) {
    try {
      const serverOk = await isServerProxyConfigured();
      if (serverOk) {
        await stopElevenLabsSpeaking();
        _isSpeaking = true;
        const resp = await fetch(`${base}/api/elevenlabs/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice_id: voice,
            model_id: "eleven_turbo_v2_5",
          }),
        });
        if (!resp.ok) {
          _isSpeaking = false;
          return false;
        }
        const audioBlob = await resp.blob();
        return await playAudioBlob(audioBlob);
      }
    } catch (err) {
      log.warn("Server proxy TTS failed, trying client key", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const apiKey = await getElevenLabsApiKey();
  if (!apiKey) return false;

  try {
    await stopElevenLabsSpeaking();
    _isSpeaking = true;

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!resp.ok) {
      log.warn("TTS returned error status", { status: resp.status });
      _isSpeaking = false;
      return false;
    }

    const audioBlob = await resp.blob();
    return await playAudioBlob(audioBlob);
  } catch (err) {
    log.warn("TTS failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    _isSpeaking = false;
    return false;
  }
}

/**
 * Stop current ElevenLabs audio playback.
 */
export async function stopElevenLabsSpeaking(): Promise<void> {
  try {
    if (_currentAudio) {
      if (Platform.OS === "web") {
        (_currentAudio as HTMLAudioElement).pause();
        (_currentAudio as HTMLAudioElement).currentTime = 0;
      } else {
        // expo-audio AudioPlayer: remove listener before release to avoid leaks
        if (_previewStatusListener) {
          try {
            _currentAudio.remove?.(
              "playbackStatusUpdate",
              _previewStatusListener,
            );
          } catch {}
          _previewStatusListener = null;
        }
        try {
          _currentAudio.pause?.();
        } catch {}
        try {
          _currentAudio.release?.();
        } catch {}
      }
    }
  } catch {
    // ignore cleanup errors
  }
  _currentAudio = null;
  _isSpeaking = false;
}

/**
 * Check if ElevenLabs is currently speaking.
 */
export function isElevenLabsSpeaking(): boolean {
  return _isSpeaking;
}

/**
 * Play a voice preview sample.
 */
export async function playVoicePreview(previewUrl: string): Promise<void> {
  await stopElevenLabsSpeaking();

  if (Platform.OS === "web") {
    const audio = new Audio(previewUrl);
    audio.volume = 1.0;
    _currentAudio = audio;
    _isSpeaking = true;
    audio.onended = () => {
      _isSpeaking = false;
      _currentAudio = null;
    };
    await audio.play().catch(() => {
      _isSpeaking = false;
      _currentAudio = null;
    });
  } else {
    // Native: expo-audio createAudioPlayer
    const { createAudioPlayer } = await import("expo-audio");
    const player = createAudioPlayer(previewUrl);
    _currentAudio = player;
    try {
      if (typeof (player as { volume?: number }).volume === "number") {
        (player as { volume: number }).volume = 1.0;
      }
    } catch {}
    _isSpeaking = true;
    const onStatus = (status: any) => {
      if (status.playing === false && status.currentTime > 0) {
        _previewStatusListener = null;
        try {
          player.remove?.("playbackStatusUpdate", onStatus);
        } catch {}
        _isSpeaking = false;
        _currentAudio = null;
        try {
          player.release?.();
        } catch {}
      }
    };
    _previewStatusListener = onStatus;
    try {
      player.addListener("playbackStatusUpdate", onStatus);
    } catch {}
    player.play();
  }
}

// ── Speech-to-Text ───────────────────────────────────────────────────────────

export interface TranscriptionResult {
  text: string;
  languageCode?: string;
}

/**
 * Transcribe audio using ElevenLabs Speech-to-Text.
 * Returns null if ElevenLabs is not available (caller should fall back to Whisper).
 *
 * @param audioBase64 - Base64-encoded audio data
 * @param mimeType - Audio MIME type (e.g., "audio/m4a", "audio/webm")
 */
export async function transcribeWithElevenLabs(
  audioBase64: string,
  mimeType: string = "audio/m4a",
): Promise<TranscriptionResult | null> {
  const base = getApiBaseUrl();

  // Try server proxy first
  if (base) {
    try {
      const serverOk = await isServerProxyConfigured();
      if (serverOk) {
        const resp = await fetch(`${base}/api/elevenlabs/stt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64, mimeType }),
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.text) {
            log.debug("Transcription via server proxy", {
              textLength: data.text.length,
            });
            return {
              text: data.text,
              languageCode: data.language_code,
            };
          }
        } else {
          log.warn("Server STT returned error", { status: resp.status });
        }
      }
    } catch (err) {
      log.warn("Server proxy STT failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Try client API key
  const apiKey = await getElevenLabsApiKey();
  if (!apiKey) {
    log.debug("No ElevenLabs API key, STT unavailable");
    return null;
  }

  try {
    // Convert base64 to Blob for multipart upload
    const byteCharacters = atob(audioBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const audioBlob = new Blob([byteArray], { type: mimeType });

    const formData = new FormData();
    const extension = mimeType.split("/")[1] || "m4a";
    formData.append("file", audioBlob, `recording.${extension}`);
    formData.append("model_id", "scribe_v1");

    const resp = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: formData,
    });

    if (!resp.ok) {
      log.warn("ElevenLabs STT returned error", { status: resp.status });
      return null;
    }

    const data = await resp.json();
    if (data.text) {
      log.debug("Transcription via client API", {
        textLength: data.text.length,
      });
      return {
        text: data.text,
        languageCode: data.language_code,
      };
    }
    return null;
  } catch (err) {
    log.warn("ElevenLabs STT failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Check if ElevenLabs STT is available (server proxy or client key).
 */
export async function isElevenLabsSttAvailable(): Promise<boolean> {
  const base = getApiBaseUrl();
  if (base) {
    const serverOk = await isServerProxyConfigured();
    if (serverOk) return true;
  }
  const apiKey = await getElevenLabsApiKey();
  return !!apiKey;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a Blob to a local file URI (native only).
 */
async function blobToFileUri(blob: Blob): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  const reader = new FileReader();
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip data URL prefix to get pure base64
      const base64Data = result.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const fileUri = `${FileSystem.cacheDirectory}elevenlabs_tts_${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}
