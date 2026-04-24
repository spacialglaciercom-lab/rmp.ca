// Web / Node fallback — the native Rust module is iOS/Android only.
// Returning `null` from isAvailable() lets callers dispatch to the
// pure-TypeScript implementation in lib/routeSolverLocal.ts.
const UNAVAILABLE = "RouteOptimizer native module is not available on web.";

export default {
  solveRoute: async () => {
    throw new Error(UNAVAILABLE);
  },
  haversineMeters: (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6_371_000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const a =
      sinLat * sinLat +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        sinLon *
        sinLon;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
};
