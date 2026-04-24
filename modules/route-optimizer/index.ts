/**
 * Route Optimizer — on-device TSP solver backed by Rust (via UniFFI).
 *
 * Usage:
 *   import RouteOptimizer, { isNativeAvailable } from "@/modules/route-optimizer";
 *
 *   if (isNativeAvailable()) {
 *     const result = await RouteOptimizer.solveRoute(points, 0, { algorithm: "2-opt" });
 *   }
 */
import NativeModule from "./src/RouteOptimizerModule";

export default NativeModule;

export type {
  SolverPoint,
  SolverAlgorithm,
  SolverOptions,
  RouteSegment,
  SolverResult,
} from "./src/RouteOptimizerModule";

/**
 * Whether the Rust-backed native module is available on the current platform.
 *
 * Returns `false` on web/Node (vitest), or when `requireNativeModule` failed
 * because the Expo autolinking step hasn't found the compiled library.
 */
export function isNativeAvailable(): boolean {
  try {
    // `solveRoute` exists on both real and web stub; only the real native
    // module exposes it as a bridged AsyncFunction.  We probe for the
    // Expo internal `__expo_module_name__` marker which is present on the
    // real bridge object and absent on the web shim.
    return (
      typeof NativeModule === "object" &&
      NativeModule !== null &&
      typeof (NativeModule as { solveRoute?: unknown }).solveRoute ===
        "function" &&
      "__expo_module_name__" in (NativeModule as object)
    );
  } catch {
    return false;
  }
}
