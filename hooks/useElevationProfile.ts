/**
 * Hook to fetch and hold elevation profile for a route (GPX/collection route).
 * Use for: elevation profile chart, grade display, climb/descent summary, uphill/downhill estimates.
 */

import { useState, useCallback } from "react";
import {
  getElevationProfile,
  type ElevationProfile,
} from "@/services/googleElevationService";

export interface UseElevationProfileResult {
  /** Fetched profile (points + segments + summary). */
  profile: ElevationProfile | null;
  /** True while fetching. */
  loading: boolean;
  /** Error message if fetch failed. */
  error: string | null;
  /** Call to fetch elevation for the given points. Resets error and sets loading. */
  fetchProfile: (points: Array<{ lat: number; lon: number }>) => Promise<ElevationProfile | null>;
  /** Clear profile and error. */
  clear: () => void;
}

export function useElevationProfile(): UseElevationProfileResult {
  const [profile, setProfile] = useState<ElevationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(
    async (points: Array<{ lat: number; lon: number }>) => {
      setError(null);
      setLoading(true);
      try {
        const result = await getElevationProfile(points);
        setProfile(result);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Elevation request failed";
        setError(msg);
        setProfile(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clear = useCallback(() => {
    setProfile(null);
    setError(null);
  }, []);

  return { profile, loading, error, fetchProfile, clear };
}
