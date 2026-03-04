/**
 * Unified Speech-to-Text service — abstracts over Moonshine (on-device) and
 * Whisper (cloud) so callers get a single interface regardless of platform.
 *
 * Provider selection:
 *  1. If `moonshineVoice` beta flag is ON **and** the native module is available
 *     **and** a model is loaded → use Moonshine (streaming, on-device).
 *  2. Otherwise → fall back to the server-side tRPC `voice.transcribe` endpoint
 *     (Whisper or Moonshine sidecar depending on server config).
 */
import { Platform } from "react-native";
import { createLogger } from "@/lib/logger";

const log = createLogger("SpeechToText");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SttPartialEvent = {
  text: string;
  isComplete: boolean;
  lineId: number;
};

export type SttResult = {
  text: string;
  duration: number;
  segments: Array<{
    text: string;
    startTime: number;
    duration: number;
  }>;
  /** Which provider produced the result. */
  provider: "moonshine" | "whisper";
};

export type SttStreamCallbacks = {
  /** Called with partial (and final) transcripts during streaming. */
  onPartial?: (event: SttPartialEvent) => void;
  /** Called when an error occurs. */
  onError?: (error: Error) => void;
};

// ---------------------------------------------------------------------------
// Moonshine (on-device) provider
// ---------------------------------------------------------------------------

let _moonshineModule: typeof import("@/modules/moonshine-voice").default | null = null;

/**
 * Lazily load the native Moonshine module.
 * Returns null on web or if the module isn't linked.
 */
function getMoonshineModule() {
  if (_moonshineModule !== null) return _moonshineModule;
  if (Platform.OS === "web") return null;
  try {
    // Dynamic require so the web bundle never touches native code
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@/modules/moonshine-voice");
    _moonshineModule = mod.default;
    return _moonshineModule;
  } catch {
    log.debug("Moonshine native module not available");
    return null;
  }
}

/** Whether the on-device Moonshine engine is ready to transcribe. */
export function isMoonshineAvailable(): boolean {
  const mod = getMoonshineModule();
  return mod?.isAvailable() === true && mod?.isModelLoaded() === true;
}

/**
 * Start streaming transcription from the device microphone using Moonshine.
 * Returns a `stop()` function that finalises and returns the full transcript.
 *
 * @throws if Moonshine is not available — caller should check `isMoonshineAvailable()`.
 */
export async function startMoonshineStream(
  callbacks?: SttStreamCallbacks,
): Promise<{ stop: () => Promise<SttResult> }> {
  const mod = getMoonshineModule();
  if (!mod || !mod.isAvailable() || !mod.isModelLoaded()) {
    throw new Error("Moonshine is not available or no model loaded");
  }

  // Subscribe to events
  const partialSub = mod.addListener("onPartialTranscript", (event) => {
    callbacks?.onPartial?.({
      text: event.text,
      isComplete: event.isComplete,
      lineId: event.lineId,
    });
  });

  await mod.startStreaming();
  log.debug("Moonshine streaming started");

  return {
    stop: async (): Promise<SttResult> => {
      const text = await mod.stopStreaming();
      partialSub.remove();
      log.debug("Moonshine streaming stopped", { textLength: text.length });
      return {
        text,
        duration: 0, // Streaming doesn't report total duration
        segments: [{ text, startTime: 0, duration: 0 }],
        provider: "moonshine",
      };
    },
  };
}

/**
 * Transcribe an audio file using Moonshine (non-streaming).
 * Useful for pre-recorded audio or when streaming isn't needed.
 */
export async function transcribeFileMoonshine(filePath: string): Promise<SttResult> {
  const mod = getMoonshineModule();
  if (!mod || !mod.isAvailable() || !mod.isModelLoaded()) {
    throw new Error("Moonshine is not available or no model loaded");
  }

  const result = await mod.transcribeFile(filePath);
  return {
    text: result.text,
    duration: result.duration,
    segments: result.segments,
    provider: "moonshine",
  };
}

// ---------------------------------------------------------------------------
// Whisper (server-side) provider — uses existing tRPC voice.transcribe
// ---------------------------------------------------------------------------

/**
 * Transcribe audio via the server-side Whisper/Moonshine-sidecar endpoint.
 * This is the fallback for web and when on-device transcription is unavailable.
 *
 * @param trpcClient  The tRPC client (passed in to avoid circular deps)
 * @param audio       Either a URL or base64-encoded audio data
 */
export async function transcribeServerSide(
  trpcClient: {
    voice: {
      transcribe: {
        mutate: (input: {
          audioUrl?: string;
          audioBase64?: string;
          mimeType?: string;
          language?: string;
          prompt?: string;
        }) => Promise<{ text: string; duration: number; language: string; segments: unknown[] }>;
      };
    };
  },
  audio: { url: string } | { base64: string; mimeType: string },
  language?: string,
): Promise<SttResult> {
  const input =
    "url" in audio
      ? { audioUrl: audio.url, language }
      : { audioBase64: audio.base64, mimeType: audio.mimeType, language };

  const result = await trpcClient.voice.transcribe.mutate(input);

  return {
    text: result.text,
    duration: result.duration,
    segments: (result.segments as Array<{ text: string; start: number; end: number }>).map(
      (seg) => ({
        text: seg.text,
        startTime: seg.start ?? 0,
        duration: (seg.end ?? 0) - (seg.start ?? 0),
      }),
    ),
    provider: "whisper",
  };
}

// ---------------------------------------------------------------------------
// Unified API
// ---------------------------------------------------------------------------

export type TranscribeSource =
  | { type: "mic" }
  | { type: "file"; path: string }
  | { type: "url"; url: string }
  | { type: "base64"; data: string; mimeType: string };

/**
 * High-level entry point: pick the best available provider and transcribe.
 *
 * - mic source → Moonshine streaming if available, otherwise throw (caller
 *   should record first, then send base64 to server).
 * - file source → Moonshine file transcription if available, else server.
 * - url/base64 → always server-side.
 */
export async function transcribe(
  source: TranscribeSource,
  opts: {
    moonshineEnabled: boolean;
    trpcClient?: Parameters<typeof transcribeServerSide>[0];
    callbacks?: SttStreamCallbacks;
    language?: string;
  },
): Promise<SttResult | { stop: () => Promise<SttResult> }> {
  const useMoonshine = opts.moonshineEnabled && isMoonshineAvailable();

  switch (source.type) {
    case "mic": {
      if (useMoonshine) {
        return startMoonshineStream(opts.callbacks);
      }
      throw new Error(
        "Mic streaming requires on-device Moonshine. Record audio first and use base64/url source.",
      );
    }

    case "file": {
      if (useMoonshine) {
        return transcribeFileMoonshine(source.path);
      }
      // No server-side file transcription path — would need to upload first
      throw new Error("File transcription requires Moonshine or uploading to server.");
    }

    case "url": {
      if (!opts.trpcClient) throw new Error("tRPC client required for server-side transcription");
      return transcribeServerSide(opts.trpcClient, { url: source.url }, opts.language);
    }

    case "base64": {
      if (!opts.trpcClient) throw new Error("tRPC client required for server-side transcription");
      return transcribeServerSide(
        opts.trpcClient,
        { base64: source.data, mimeType: source.mimeType },
        opts.language,
      );
    }
  }
}
