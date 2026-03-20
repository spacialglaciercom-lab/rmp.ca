/**
 * Hook for custom start point configuration in route generation.
 * Provides getStartPoint() to retrieve coordinates (either custom or undefined for centroid fallback).
 * Use with StartPointConfig component for the UI.
 */

import { useCallback, useMemo } from "react";
import { useRouting } from "@/lib/routing-context";
import type { StartPoint } from "@/types/routing";

export interface UseCustomStartPointReturn {
  /** Get the current start point coordinates if valid, or undefined to use graph centroid */
  getStartPoint: () => { latitude: number; longitude: number } | undefined;
  /** Whether a valid custom start point is set */
  hasStartPoint: boolean;
  /** Current start point from configuration (for passing to StartPointConfig) */
  startPoint: StartPoint | undefined;
  /** Dispatch from routing context - for StartPointConfig if needed */
  dispatch: ReturnType<typeof useRouting>["dispatch"];
  /** Full routing state - for StartPointConfig */
  state: ReturnType<typeof useRouting>["state"];
}

export function useCustomStartPoint(): UseCustomStartPointReturn {
  const { state, dispatch } = useRouting();

  const getStartPoint = useCallback(():
    | { latitude: number; longitude: number }
    | undefined => {
    const sp = state.configuration.startPoint;
    if (sp?.isValid && sp?.coordinates) {
      const { latitude, longitude } = sp.coordinates;
      if (
        typeof latitude === "number" &&
        typeof longitude === "number" &&
        !Number.isNaN(latitude) &&
        !Number.isNaN(longitude)
      ) {
        return { latitude, longitude };
      }
    }
    return undefined;
  }, [state.configuration.startPoint]);

  return useMemo(
    () => ({
      getStartPoint,
      hasStartPoint: !!state.configuration.startPoint?.isValid,
      startPoint: state.configuration.startPoint,
      dispatch,
      state,
    }),
    [getStartPoint, state.configuration.startPoint, dispatch, state],
  );
}
