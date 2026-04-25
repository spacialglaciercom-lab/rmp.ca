/**
 * Hook for Overture GeoJSON → Chinese Postman route optimization.
 *
 * Calls the Python/FastAPI backend to:
 * 1. Validate and filter the Overture GeoJSON
 * 2. Build a NetworkX graph and solve the Chinese Postman Problem
 * 3. Return optimized route for display on react-native-maps
 */

import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useRouting, generateGPXString } from "@/lib/routing-context";
import { useMapActions } from "@/stores/mapStateStore";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { useDisplayModeStore } from "@/stores/displayModeStore";
import { usePluginStore } from "@/stores/pluginStore";
import {
  optimizeRoute as callOptimizer,
  buildOvertureOptimizeRequest,
  type GeoJSONFeatureCollection,
  type OptimizeResponse,
} from "@/services/overtureOptimizerService";

type LatLon = { lat: number; lon: number };

// Cartesian Douglas-Peucker in degree-space.
// toleranceDeg ≈ 0.00005° ≈ 5 m — eliminates sub-pixel bridge jitter without
// clipping intersection corners on a dense Eulerian circuit.
function simplifyLatLon(points: LatLon[], toleranceDeg: number): LatLon[] {
  if (points.length <= 2) return points;
  const s = points[0];
  const e = points[points.length - 1];
  const dx = e.lon - s.lon;
  const dy = e.lat - s.lat;
  const len = Math.sqrt(dx * dx + dy * dy);
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dist =
      len === 0
        ? Math.sqrt((p.lon - s.lon) ** 2 + (p.lat - s.lat) ** 2)
        : Math.abs(dy * p.lon - dx * p.lat + e.lon * s.lat - e.lat * s.lon) /
          len;
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }
  if (maxDist > toleranceDeg) {
    const left = simplifyLatLon(points.slice(0, maxIdx + 1), toleranceDeg);
    const right = simplifyLatLon(points.slice(maxIdx), toleranceDeg);
    return [...left.slice(0, -1), ...right];
  }
  return [s, e];
}

const DISPLAY_TOLERANCE_DEG = 0.00005; // ~5 m

export interface OvertureOptimizeOptions {
  startLat?: number;
  startLon?: number;
  onewayMode?: string;
  serviceBothSides?: boolean;
  roadClasses?: string[];
  turnPenalties?: { left_turn?: number; u_turn?: number; right_turn?: number };
}

export function useOvertureOptimizeRoute() {
  const { state, dispatch } = useRouting();
  const actions = useMapActions();
  const closeOSMExtractor = useMapSidebarStore((s) => s.closeOSMExtractor);
  const setDisplayMode = useDisplayModeStore((s) => s.setMode);
  const useTurnPenaltyPlugin = usePluginStore((s) =>
    s.isPluginEnabled("turn-penalty", false),
  );
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationStatus, setOptimizationStatus] = useState("");
  const [lastResult, setLastResult] = useState<OptimizeResponse | null>(null);

  const handleOvertureOptimizeRoute = useCallback(
    async (
      geojson: GeoJSONFeatureCollection,
      options: OvertureOptimizeOptions = {},
    ) => {
      setOptimizing(true);
      setOptimizationStatus("Sending to route optimizer...");
      try {
        const requestParams = buildOvertureOptimizeRequest({
          geojson,
          start_lat: options.startLat,
          start_lon: options.startLon,
          config: state?.configuration,
          useTurnPenaltyPlugin,
          overrides: {
            oneway_mode: options.onewayMode,
            service_both_sides: options.serviceBothSides,
            road_classes: options.roadClasses,
            turn_penalties: options.turnPenalties,
          },
        });
        const result = await callOptimizer(requestParams);

        if (!result.route?.length) {
          Alert.alert(
            "Optimization failed",
            result.message || "No route produced.",
          );
          return null;
        }

        setLastResult(result);
        setOptimizationStatus("Route optimized! Processing...");

        const rawPoints = result.route.map((p) => ({
          lat: p.latitude,
          lon: p.longitude,
        }));
        const gpxPoints = simplifyLatLon(rawPoints, DISPLAY_TOLERANCE_DEG);

        // Snap to roads is now optional - user can press "Fix to roads" button manually
        // This reduces API requests and gives user control
        dispatch({
          type: "SET_PREVIEW_ROUTE",
          payload: gpxPoints,
        });

        actions.setRoutePoints(gpxPoints);
        const gpxString = generateGPXString(
          "overture-optimized-route",
          rawPoints,
        );
        dispatch({ type: "SET_GPX_DATA", payload: gpxString });

        // Switch to Minimal route view to display the optimized route
        setDisplayMode("minimal");

        closeOSMExtractor();
        actions.clearOsmExtraction();

        return result;
      } catch (err) {
        console.error("Overture optimize failed:", err);
        // Clear any previous route so a failed run doesn’t leave a stale/grid on the map
        dispatch({ type: "SET_PREVIEW_ROUTE", payload: null });
        Alert.alert(
          "Optimization Failed",
          err instanceof Error ? err.message : "Unknown error",
        );
        return null;
      } finally {
        setOptimizing(false);
        setOptimizationStatus("");
      }
    },
    [
      state?.configuration,
      useTurnPenaltyPlugin,
      actions,
      dispatch,
      closeOSMExtractor,
      setDisplayMode,
    ],
  );

  return {
    handleOvertureOptimizeRoute,
    optimizing,
    optimizationStatus,
    lastResult,
  };
}
