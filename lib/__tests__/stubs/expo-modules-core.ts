/**
 * Stub for expo-modules-core in Vitest.  The real package expects a native
 * host (JSI / TurboModules) that doesn't exist in Node, so tests pretend
 * every native module is unavailable and call sites fall back to
 * pure-TypeScript implementations.
 */
export class NativeModule<_Events = unknown> {}

export function requireNativeModule<T>(_name: string): T {
  // Return an empty object deliberately missing the internal Expo markers,
  // so isNativeAvailable() in consumer modules reports `false`.
  return {} as T;
}
