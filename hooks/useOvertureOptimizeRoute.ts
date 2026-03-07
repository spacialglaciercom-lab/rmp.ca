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
import {
  optimizeRoute as callOptimizer,
  buildOvertureOptimizeRequest,
  type GeoJSONFeatureCollection,
  type OptimizeResponse,
} from "@/services/overtureOptimizerService";

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

        const gpxPoints = result.route.map((p) => ({
          lat: p.latitude,
          lon: p.longitude,
        }));

        // Snap to roads is now optional - user can press "Fix to roads" button manually
        // This reduces API requests and gives user control
        dispatch({
          type: "SET_PREVIEW_ROUTE",
          payload: gpxPoints,
        });

        actions.setRoutePoints(gpxPoints);
        const gpxString = generateGPXString("overture-optimized-route", gpxPoints);
        dispatch({ type: "SET_GPX_DATA", payload: gpxString });

        // Switch to Minimal route view to display the optimized route
        setDisplayMode("minimal");

        closeOSMExtractor();
        actions.clearOsmExtraction();

        return result;
      } catch (err) {
        console.error("Overture optimize failed:", err);
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
    [state?.configuration, actions, dispatch, closeOSMExtractor, setDisplayMode],
  );

  return {
    handleOvertureOptimizeRoute,
    optimizing,
    optimizationStatus,
    lastResult,
  };
}
