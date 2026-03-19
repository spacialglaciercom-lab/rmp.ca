/**
 * Shared store middleware and utilities for consistent Zustand store patterns.
 *
 * Provides:
 * - AsyncStorage-backed JSON persistence config
 * - Development-only logging middleware
 * - Typed store creation helpers
 */

import { createJSONStorage, devtools } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StateCreator, StoreMutatorIdentifier } from "zustand";

/** Reusable AsyncStorage-backed JSON storage for Zustand persist middleware. */
export const asyncStorage = createJSONStorage(() => AsyncStorage);

/**
 * Development-only logging middleware.
 * Logs state changes with action names when __DEV__ is true.
 */
export const withDevtools = <T extends object>(
  name: string,
  fn: StateCreator<T, [], []>,
): StateCreator<T, [], [["zustand/devtools", never]]> =>
  devtools(fn, { name, enabled: __DEV__ });

/**
 * Equality check for coordinate arrays to prevent unnecessary re-renders.
 * Returns true if arrays are structurally equal.
 */
export function coordArrayEquals(
  a: ReadonlyArray<{ lat: number; lon: number }>,
  b: ReadonlyArray<{ lat: number; lon: number }>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].lat !== b[i].lat || a[i].lon !== b[i].lon) return false;
  }
  return true;
}
