/**
 * Web stub — Moonshine runs on-device (iOS/Android only).
 * All methods return sensible defaults or throw unavailable errors.
 */

const UNAVAILABLE = "Moonshine Voice is not available on web. Use server-side transcription.";

export default {
  isAvailable: () => false,
  loadModel: async () => {
    throw new Error(UNAVAILABLE);
  },
  loadBundledModel: async () => {
    throw new Error(UNAVAILABLE);
  },
  unloadModel: async () => {},
  isModelLoaded: () => false,
  startStreaming: async () => {
    throw new Error(UNAVAILABLE);
  },
  stopStreaming: async () => {
    throw new Error(UNAVAILABLE);
  },
  transcribeFile: async () => {
    throw new Error(UNAVAILABLE);
  },
  registerIntent: async () => {
    throw new Error(UNAVAILABLE);
  },
  unregisterIntent: async () => {
    throw new Error(UNAVAILABLE);
  },
  clearIntents: async () => {},
  addListener: () => ({ remove: () => {} }),
  removeListeners: () => {},
};
