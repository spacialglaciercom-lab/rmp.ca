/**
 * ElevenLabs TTS Service — High-quality AI voice synthesis.
 *
 * Prefers server proxy when ELEVENLABS_API_KEY is set on the server (Railway env) — no key on client.
 * Otherwise uses client-stored API key (settings) and calls ElevenLabs directly.
 * Falls back to expo-speech if ElevenLabs is unavailable.
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
      log.warn("Server proxy voices failed, trying client key", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const apiKey = await getElevenLabsApiKey();
  if (!apiKey) return [];

  try {
    const [personalResp, sharedResp] = await Promise.all([
      fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } }),
      fetch("https://api.elevenlabs.io/v1/shared-voices?page_size=100&sort=trending&category=professional", {
        headers: { "xi-api-key": apiKey },
      }).catch(() => null),
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
    log.warn("Failed to list voices", { error: err instanceof Error ? err.message : String(err) });
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
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const onStatus = (status: any) => {
        if (!resolved && status.playing === false && status.currentTime > 0) {
          resolved = true;
          _isSpeaking = false;
          _currentAudio = null;
          try { player.remove?.("playbackStatusUpdate", onStatus); } catch {}
          try { player.release?.(); } catch {}
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
          body: JSON.stringify({ text, voice_id: voice, model_id: "eleven_turbo_v2_5" }),
        });
        if (!resp.ok) {
          _isSpeaking = false;
          return false;
        }
        const audioBlob = await resp.blob();
        return await playAudioBlob(audioBlob);
      }
    } catch (err) {
      log.warn("Server proxy TTS failed, trying client key", { error: err instanceof Error ? err.message : String(err) });
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
    log.warn("TTS failed", { error: err instanceof Error ? err.message : String(err) });
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
          try { _currentAudio.remove?.("playbackStatusUpdate", _previewStatusListener); } catch {}
          _previewStatusListener = null;
        }
        try { _currentAudio.pause?.(); } catch {}
        try { _currentAudio.release?.(); } catch {}
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
    _isSpeaking = true;
    const onStatus = (status: any) => {
      if (status.playing === false && status.currentTime > 0) {
        _previewStatusListener = null;
        try { player.remove?.("playbackStatusUpdate", onStatus); } catch {}
        _isSpeaking = false;
        _currentAudio = null;
        try { player.release?.(); } catch {}
      }
    };
    _previewStatusListener = onStatus;
    try {
      player.addListener("playbackStatusUpdate", onStatus);
    } catch {}
    player.play();
  }
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
