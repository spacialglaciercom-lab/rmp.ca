/**
 * Shared OSM Extractor "Optimize Route" handler so the sheet can be rendered in tab layout
 * and work from any tab (Map, Record, etc.).
 */
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useRouting } from "@/lib/routing-context";
import { generateGPXString } from "@/lib/routing-context";
import { overpassToOsmData } from "@/lib/overpassToOsmData";
import { useRouteOptimization } from "@/hooks/useRouteOptimization";
import { useMapActions } from "@/stores/mapStateStore";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import type { OverpassElement } from "@/lib/overpassService";

export function useOsmOptimizeRoute() {
  const { state, dispatch } = useRouting();
  const { optimizeRoute } = useRouteOptimization();
  const actions = useMapActions();
  const closeOSMExtractor = useMapSidebarStore((s) => s.closeOSMExtractor);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationStatus, setOptimizationStatus] = useState("");

  const handleOsmOptimizeRoute = useCallback(
    async (rawElements: OverpassElement[]) => {
      setOptimizing(true);
      setOptimizationStatus("Converting OSM data...");
      try {
        const { nodes, ways } = overpassToOsmData(rawElements);
        if (ways.length === 0) {
          Alert.alert(
            "No roads found",
            "The extracted area has no road data to optimize. Make sure 'Roads' category is selected.",
          );
          return;
        }

        const config = state?.configuration;
        const result = await optimizeRoute(nodes, ways, {
          turnPenalties: config?.turnPenalties,
          onewayMode: (config?.onewayMode as "A" | "B") ?? "B",
          turnRestrictions: [],
          onProgress: (_step, detail) =>
            setOptimizationStatus(detail || "Optimizing..."),
        });

        if (!result.route?.length) {
          Alert.alert("Optimization failed", result.message || "No route produced.");
          return;
        }

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
        const gpxString = generateGPXString("osm-optimized-route", gpxPoints);
        dispatch({ type: "SET_GPX_DATA", payload: gpxString });
        closeOSMExtractor();
        actions.clearOsmExtraction();
      } catch (err) {
        console.error("OSM optimize failed:", err);
        Alert.alert(
          "Optimization Failed",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        setOptimizing(false);
        setOptimizationStatus("");
      }
    },
    [optimizeRoute, state?.configuration, actions, dispatch, closeOSMExtractor],
  );

  return { handleOsmOptimizeRoute, optimizing, optimizationStatus };
}
