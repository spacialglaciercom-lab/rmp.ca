/**
 * Server-side speech-to-text via the Moonshine Python sidecar.
 *
 * This is a drop-in alternative to `voiceTranscription.ts` (Whisper).
 * The Node backend POSTs base64 audio to the sidecar and receives a
 * Whisper-compatible response.
 *
 * Falls back to the existing Whisper path when the sidecar is unavailable.
 */
import { ENV } from "./env";
import {
  type TranscribeOptions,
  type TranscriptionResponse,
  type TranscriptionError,
  transcribeAudio,
  transcribeAudioFromBase64,
} from "./voiceTranscription";

/**
 * Transcribe audio via the Moonshine Python sidecar.
 *
 * @param options — same shape as Whisper transcribeAudio for easy swap.
 * @returns WhisperResponse-compatible result, or TranscriptionError.
 */
export async function transcribeAudioMoonshine(
  options: TranscribeOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  const sidecarUrl = ENV.moonshineSidecarUrl;
  if (!sidecarUrl) {
    return { error: "Moonshine sidecar not configured", code: "SERVICE_ERROR", details: "MOONSHINE_SIDECAR_URL is not set" };
  }

  try {
    // Step 1: Download audio from URL and convert to base64
    const response = await fetch(options.audioUrl);
    if (!response.ok) {
      return { error: "Failed to download audio file", code: "INVALID_FORMAT", details: `HTTP ${response.status}` };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") || "audio/mpeg";

    // Size check (16 MB)
    if (audioBuffer.length > 16 * 1024 * 1024) {
      return { error: "Audio file exceeds 16MB limit", code: "FILE_TOO_LARGE" };
    }

    const audioBase64 = audioBuffer.toString("base64");

    // Step 2: POST to sidecar
    return await callSidecar(sidecarUrl, audioBase64, mimeType, options.language);
  } catch (error) {
    return {
      error: "Moonshine transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Transcribe base64 audio directly via the Moonshine sidecar.
 */
export async function transcribeBase64Moonshine(
  base64Data: string,
  mimeType: string = "audio/m4a",
  language?: string,
): Promise<TranscriptionResponse | TranscriptionError> {
  const sidecarUrl = ENV.moonshineSidecarUrl;
  if (!sidecarUrl) {
    return { error: "Moonshine sidecar not configured", code: "SERVICE_ERROR", details: "MOONSHINE_SIDECAR_URL is not set" };
  }

  // Size check
  const sizeBytes = Math.ceil(base64Data.length * 0.75);
  if (sizeBytes > 16 * 1024 * 1024) {
    return { error: "Audio file exceeds 16MB limit", code: "FILE_TOO_LARGE" };
  }

  try {
    return await callSidecar(sidecarUrl, base64Data, mimeType, language);
  } catch (error) {
    return {
      error: "Moonshine transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Transcribe using Moonshine with automatic fallback to Whisper.
 */
export async function transcribeWithFallback(
  options: TranscribeOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  if (ENV.moonshineSttEnabled && ENV.moonshineSidecarUrl) {
    const result = await transcribeAudioMoonshine(options);
    if (!("error" in result)) return result;

    // Moonshine failed — fall through to Whisper
    console.warn("[moonshine] Sidecar failed, falling back to Whisper:", (result as TranscriptionError).details);
  }

  return transcribeAudio(options);
}

/**
 * Transcribe base64 using Moonshine with automatic fallback to Whisper.
 */
export async function transcribeBase64WithFallback(
  base64Data: string,
  mimeType?: string,
  language?: string,
  prompt?: string,
): Promise<TranscriptionResponse | TranscriptionError> {
  if (ENV.moonshineSttEnabled && ENV.moonshineSidecarUrl) {
    const result = await transcribeBase64Moonshine(base64Data, mimeType, language);
    if (!("error" in result)) return result;

    console.warn("[moonshine] Sidecar failed, falling back to Whisper:", (result as TranscriptionError).details);
  }

  return transcribeAudioFromBase64(base64Data, mimeType, language, prompt);
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function callSidecar(
  sidecarUrl: string,
  audioBase64: string,
  mimeType: string,
  language?: string,
): Promise<TranscriptionResponse | TranscriptionError> {
  const endpoint = sidecarUrl.replace(/\/$/, "") + "/transcribe";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_base64: audioBase64,
      mime_type: mimeType,
      language: language || null,
    }),
    signal: AbortSignal.timeout(60_000), // 60s timeout for large files
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    return {
      error: "Moonshine sidecar request failed",
      code: "TRANSCRIPTION_FAILED",
      details: `${res.status} ${res.statusText}${errorText ? `: ${errorText}` : ""}`,
    };
  }

  const data = await res.json();

  // Map sidecar response to WhisperResponse shape
  return {
    task: "transcribe",
    language: data.language || "en",
    duration: data.duration || 0,
    text: data.text || "",
    segments: (data.segments || []).map((seg: { id: number; start: number; end: number; text: string }) => ({
      id: seg.id,
      seek: 0,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      tokens: [],
      temperature: 0,
      avg_logprob: 0,
      compression_ratio: 0,
      no_speech_prob: 0,
    })),
  };
}
