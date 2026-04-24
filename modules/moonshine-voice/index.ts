/**
 * Moonshine Voice — on-device streaming speech-to-text for RouteMasterPro.
 *
 * Usage:
 *   import MoonshineVoice, { ModelArch } from "@/modules/moonshine-voice";
 *
 *   if (MoonshineVoice.isAvailable()) {
 *     await MoonshineVoice.loadBundledModel(ModelArch.TINY_STREAMING);
 *     MoonshineVoice.addListener("onPartialTranscript", (e) => console.log(e.text));
 *     await MoonshineVoice.startStreaming();
 *   }
 */
export { default } from "./src/MoonshineVoiceModule";
export {
  ModelArch,
  type ModelArchType,
  type PartialTranscriptEvent,
  type LineCompletedEvent,
  type IntentRecognizedEvent,
  type TranscriptResult,
  type MoonshineVoiceModuleEvents,
} from "./src/MoonshineVoiceModule";
