/**
 * Shared hook so any screen with a map can add OSM extraction points when the OSM Extractor is open.
 * Use for Map tab, Record tab, and any other screen that renders RouteMap.
 */
import { useCallback, useRef } from "react";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";

const DEBOUNCE_MS = 500;

/**
 * Returns an onMapPress handler. When OSM Extractor is visible, map taps add extraction points
 * (with debounce and haptic). Otherwise the optional fallback is called.
 */
export function useOSMMapPress(
  fallback?: (lat: number, lon: number) => void,
): (lat: number, lon: number) => void {
  const osmExtractorVisible = useMapSidebarStore((s) => s.osmExtractorVisible);
  const actions = useMapActions();
  const lastAddTimeRef = useRef(0);

  return useCallback(
    (lat: number, lon: number) => {
      if (osmExtractorVisible) {
        const now = Date.now();
        if (now - lastAddTimeRef.current < DEBOUNCE_MS) return;
        lastAddTimeRef.current = now;
        hapticImpact();
        actions.addOsmExtractionPoint({ latitude: lat, longitude: lon });
        return;
      }
      fallback?.(lat, lon);
    },
    [osmExtractorVisible, actions, fallback],
  );
}
