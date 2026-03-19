/**
 * Default Leap (Liquid AI) model and quantization for on-device inference.
 * Use these when loading the model in native iOS code (e.g. Leap.load(...)).
 *
 * @see https://leap.liquid.ai/docs/edge-sdk/ios
 */

/** Default model: LFM2-1.2B-Extract (extract/structured output). */
export const LEAP_DEFAULT_MODEL = "LFM2-1.2B-Extract";

/** Default quantization: Q5_K_M (good quality/size tradeoff). */
export const LEAP_DEFAULT_QUANTIZATION = "Q5_K_M";
