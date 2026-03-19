/**
 * Stub for vitest so modules that import "react-native" (e.g. route-ml-enhancement) run in Node.
 * Use Platform.OS === "android" so getEdgePenaltiesFromLeap returns empty map without calling Leap.
 */
export const Platform = { OS: "android" };
export default { Platform };
