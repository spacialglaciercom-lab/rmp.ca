import { NativeModule, requireNativeModule } from "expo-modules-core";

/** Model architecture constants matching Moonshine C API. */
export const ModelArch = {
  TINY: 0,
  BASE: 1,
  TINY_STREAMING: 2,
  BASE_STREAMING: 3,
  SMALL_STREAMING: 4,
  MEDIUM_STREAMING: 5,
} as const;

export type ModelArchType = (typeof ModelArch)[keyof typeof ModelArch];

/** Emitted during streaming transcription with partial/final text. */
export type PartialTranscriptEvent = {
  text: string;
  isComplete: boolean;
  lineId: number;
  startTime: number;
};

/** Emitted when a transcript line is finalized. */
export type LineCompletedEvent = {
  text: string;
  startTime: number;
  duration: number;
  lineId: number;
};

/** Emitted when a registered voice command is recognized. */
export type IntentRecognizedEvent = {
  intent: string;
  utterance: string;
  similarity: number;
};

/** Result from non-streaming file transcription. */
export type TranscriptResult = {
  text: string;
  duration: number;
  segments: Array<{
    text: string;
    startTime: number;
    duration: number;
  }>;
};

/** Events emitted by the native module. */
export type MoonshineVoiceModuleEvents = {
  onPartialTranscript: (event: PartialTranscriptEvent) => void;
  onLineCompleted: (event: LineCompletedEvent) => void;
  onIntentRecognized: (event: IntentRecognizedEvent) => void;
};

declare class MoonshineVoiceNativeModule extends NativeModule<MoonshineVoiceModuleEvents> {
  /** Whether the native Moonshine engine is available on this platform. */
  isAvailable(): boolean;

  /** Load a Moonshine model from disk. Returns true on success. */
  loadModel(modelPath: string, modelArch: ModelArchType): Promise<boolean>;

  /** Load the bundled model from app assets. */
  loadBundledModel(modelArch: ModelArchType): Promise<boolean>;

  /** Unload the current model to free memory. */
  unloadModel(): Promise<void>;

  /** Whether a model is currently loaded. */
  isModelLoaded(): boolean;

  /** Start streaming transcription from the microphone. */
  startStreaming(): Promise<void>;

  /** Stop streaming and return the final transcript. */
  stopStreaming(): Promise<string>;

  /** Transcribe an audio file (non-streaming). */
  transcribeFile(filePath: string): Promise<TranscriptResult>;

  /** Register a voice command intent for recognition. */
  registerIntent(triggerPhrase: string, intentName: string): Promise<void>;

  /** Remove a registered intent. */
  unregisterIntent(intentName: string): Promise<void>;

  /** Remove all registered intents. */
  clearIntents(): Promise<void>;
}

export default requireNativeModule<MoonshineVoiceNativeModule>("MoonshineVoice");
