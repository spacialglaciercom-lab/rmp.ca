/**
 * AbortSignal that aborts after a delay. Use instead of AbortSignal.timeout()
 * in React Native / Hermes where AbortSignal.timeout may be undefined.
 */
export function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
