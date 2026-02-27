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
import { routeThroughWaypoints } from "@/lib/mapMatching";
import { getRoutingConfigAsync } from "@/lib/routing-config";
import { getRouteOptionsForRouting } from "@/stores/routeParametersStore";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { useDisplayModeStore } from "@/stores/displayModeStore";
import {
  optimizeRoute as callOptimizer,
  type GeoJSONFeatureCollection,
  type OptimizeResponse,
} from "@/services/overtureOptimizerService";

export interface OvertureOptimizeOptions {
  startLat?: number;
  startLon?: number;
  onewayMode?: string;
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
        const config = state?.configuration;

        const result = await callOptimizer({
          geojson,
          start_lat: options.startLat,
          start_lon: options.startLon,
          oneway_mode: options.onewayMode ?? (config?.onewayMode as string) ?? "A",
          road_classes: options.roadClasses,
          turn_penalties: options.turnPenalties ?? {
            left_turn: config?.turnPenalties?.leftTurn ?? 50,
            u_turn: config?.turnPenalties?.uTurn ?? 100,
            right_turn: config?.turnPenalties?.rightTurn ?? 0,
          },
        });

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

        setOptimizationStatus("Snapping to roads...");
        const routingConfig = await getRoutingConfigAsync();
        if (routingConfig.baseUrl) {
          try {
            const matched = await routeThroughWaypoints(
              gpxPoints,
              routingConfig,
              getRouteOptionsForRouting(),
            );
            if (matched) {
              dispatch({
                type: "SET_PREVIEW_ROUTE",
                payload: matched.matchedGeometry.map((p) => ({
                  lat: p.lat,
                  lon: p.lon,
                })),
              });
              actions.setCachedMatchedRoute(matched);
            }
          } catch (e) {
            console.warn("Snap to roads failed, using raw route:", e);
          }
        }

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
