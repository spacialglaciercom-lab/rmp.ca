/**
 * Route optimizer v2 debugging.
 * Logs when DEBUG_ROUTE_OPTIMIZER is true (default: __DEV__).
 * Set window.__DEBUG_ROUTE_OPTIMIZER = true in console to enable on web.
 */

const isDev =
  typeof __DEV__ !== "undefined"
    ? __DEV__
    : typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

function isEnabled(): boolean {
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as any).__DEBUG_ROUTE_OPTIMIZER === true
  ) {
    return true;
  }
  if (
    typeof window !== "undefined" &&
    (window as any).__DEBUG_ROUTE_OPTIMIZER === true
  ) {
    return true;
  }
  return isDev;
}

const PREFIX = "[RouteOptimizer]";

export function debug(stage: string, data: Record<string, unknown>): void {
  if (!isEnabled()) return;
  console.log(`${PREFIX} ${stage}`, data);
}

export function warn(
  stage: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  console.warn(`${PREFIX} ${stage}: ${message}`, data ?? {});
}

export function sampleIds(
  ids: string[] | Iterable<string>,
  max: number = 5,
): string[] {
  const arr = Array.isArray(ids) ? ids : Array.from(ids);
  if (arr.length <= max) return arr;
  return [...arr.slice(0, 2), `...${arr.length - 4} more...`, ...arr.slice(-2)];
}
