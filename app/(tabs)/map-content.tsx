import React, { Suspense, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  useWindowDimensions,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import type { CollectionPoint } from "@/types";
import { useRouting } from "@/lib/routing-context";
import { parseGPXForNavigation } from "@/lib/gpxNavParser";
import { buildOfflineMatchedRoute, matchGPXToRoads, routeBetweenPoints, routeThroughWaypoints } from "@/lib/mapMatching";
import { getRoutingConfigAsync } from "@/lib/routing-config";
import type { MatchedRoute } from "@/lib/mapMatching";

import { RouteMap } from "@/components/route-map";
import NavigationView, { type OffRoutePayload } from "@/components/NavigationView";
import { useOSMMapPress } from "@/hooks/useOSMMapPress";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { getPlugin } from "@/lib/plugins/registry";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { usePluginStore } from "@/stores/pluginStore";

// --- Optimized store selectors ---
import {
  useMapStateStore,
  useMapActions,
} from "@/stores/mapStateStore";

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, dispatch } = useRouting();

  // ---------------------------------------------------------------------------
  // Zustand store subscriptions (replaces 16 useState calls)
  // ---------------------------------------------------------------------------
  const collectionPoints = useMapStateStore((s) => s.collectionPoints);
  const routePoints = useMapStateStore((s) => s.routePoints);
  const navigationMode = useMapStateStore((s) => s.navigationMode);
  const matchedRoute = useMapStateStore((s) => s.matchedRoute);
  const cachedMatchedRoute = useMapStateStore((s) => s.cachedMatchedRoute);
  const navLoading = useMapStateStore((s) => s.navLoading);
  const fixToRoadsLoading = useMapStateStore((s) => s.fixToRoadsLoading);
  const directionsLoading = useMapStateStore((s) => s.directionsLoading);
  const tapDestination = useMapStateStore((s) => s.tapDestination);
  const roadClosureHandlingOn = useMapStateStore((s) => s.roadClosureHandlingOn);

  // Stable action references
  const actions = useMapActions();

  const setTapDestinationFallback = useCallback(
    (lat: number, lon: number) => actions.setTapDestination({ lat, lon }),
    [actions],
  );
  const onMapPress = useOSMMapPress(setTapDestinationFallback);
  const osmExtractionPoints = useMapStateStore((s) => s.osmExtractionPoints);
  const osmExtractedData = useMapStateStore((s) => s.osmExtractedData);
  const osmExtractorVisible = useMapSidebarStore((s) => s.osmExtractorVisible);
  const activeOverlays = useMapLayerStore((s) => s.activeOverlays);
  const weatherPluginEnabled = usePluginStore((s) => s.isPluginEnabled("weather", true));

  const fixToRoadsJustRan = useRef(false);
  const previewPoints = state?.previewRoutePoints ?? null;

  // Initialize store data on mount
  useEffect(() => {
    actions.loadRoute();
    actions.loadImportedPoints();
  }, [actions]);

  const displayRoutePoints = previewPoints?.length ? previewPoints : routePoints;

  const isPreviewMode = !!previewPoints && previewPoints.length > 0;

  // Refresh route from storage when tab gains focus so optimized route from Planner is visible
  useFocusEffect(
    useCallback(() => {
      actions.loadRoute();
      actions.loadImportedPoints();
      return () => {
        dispatch({ type: "SET_PREVIEW_ROUTE", payload: null });
        actions.setCachedMatchedRoute(null);
        actions.setTapDestination(null);
      };
    }, [dispatch, actions])
  );

  // When map has no route but routing context has GPX (e.g. just generated in Planner), hydrate so user can navigate
  useEffect(() => {
    if (routePoints.length > 0 || !state?.gpxData) return;
    let cancelled = false;
    (async () => {
      try {
        const parsed = await parseGPXForNavigation(state.gpxData as string);
        if (cancelled || parsed.points.length < 2) return;
        const points = parsed.points.map((p) => ({ lat: p.lat, lon: p.lon }));
        actions.setRoutePoints(points);
        const asCollection: CollectionPoint[] = parsed.points.map((p, i) => ({
          id: `gpx-${i}`,
          address: `Stop ${i + 1}`,
          latitude: p.lat,
          longitude: p.lon,
          collectionType: "residential",
          status: "pending",
        }));
        actions.setCollectionPoints(asCollection);
        const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
        const avgLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
        actions.setMapCenter({ lat: avgLat, lon: avgLon });
      } catch (_) {
        // ignore parse errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state?.gpxData, routePoints.length, actions]);

  // Invalidate cached match when the route changes so we don't use a stale match
  // Skip invalidation when Fix to Roads just set the cache + dispatched preview
  useEffect(() => {
    if (fixToRoadsJustRan.current) {
      fixToRoadsJustRan.current = false;
      return;
    }
    actions.setCachedMatchedRoute(null);
  }, [previewPoints?.length, routePoints.length, actions]);

  const handlePointPress = useCallback((point: CollectionPoint) => {
    hapticImpact();
    actions.setSelectedPoint(point);
    actions.setMapCenter({ lat: point.latitude, lon: point.longitude });
  }, [actions]);

  const startNavigation = useCallback(async () => {
    if (cachedMatchedRoute) {
      actions.setMatchedRoute(cachedMatchedRoute);
      actions.setCachedMatchedRoute(null);
      actions.setNavigationMode(true);
      return;
    }
    let points: Array<{ lat: number; lon: number }> = [];
    if ((previewPoints?.length ?? 0) >= 2) {
      points = previewPoints!.map((p) => ({ lat: p.lat, lon: p.lon }));
    } else if (state?.gpxData) {
      const parsed = await parseGPXForNavigation(state.gpxData as string);
      points = parsed.points;
    } else if ((displayRoutePoints?.length ?? 0) >= 2) {
      points = displayRoutePoints!;
    }
    if (points.length < 2) {
      Alert.alert(
        "No route to navigate",
        "Import or preview a GPX route with at least 2 points first."
      );
      return;
    }
    actions.setNavLoading(true);
    try {
      let matched: MatchedRoute | null = null;
      const routingConfig = await getRoutingConfigAsync();
      if (routingConfig.baseUrl) {
        matched = await matchGPXToRoads(points, routingConfig);
      }
      if (!matched) {
        matched = buildOfflineMatchedRoute(points);
      }
      actions.setMatchedRoute(matched);
      actions.setNavigationMode(true);
    } catch (e) {
      console.warn("Navigation setup failed:", e);
      Alert.alert("Navigation", "Could not start navigation. Try again.");
    } finally {
      actions.setNavLoading(false);
    }
  }, [
    cachedMatchedRoute,
    previewPoints,
    displayRoutePoints,
    state?.gpxData,
    actions,
  ]);

  // On native, use useWindowDimensions and account for tab bar so the map fills the visible content area (no gray strip at bottom).
  const windowDims = useWindowDimensions();
  const tabBarHeight = Platform.OS !== "web" ? 56 + Math.max(insets.bottom, 8) : 0;
  const contentHeight = Platform.OS !== "web" ? Math.max(200, windowDims.height - tabBarHeight) : windowDims.height;
  const { width, height } =
    Platform.OS === "web" && typeof window !== "undefined"
      ? Dimensions.get("window")
      : Platform.OS !== "web"
        ? { width: windowDims.width, height: contentHeight }
        : { width: 800, height: 600 };

  const canStartNavigation =
    (previewPoints?.length ?? 0) >= 2 ||
    (displayRoutePoints?.length ?? 0) >= 2 ||
    !!(state?.gpxData);

  const handleFixToRoads = useCallback(async () => {
    let points: Array<{ lat: number; lon: number }> = [];
    if ((previewPoints?.length ?? 0) >= 2) {
      points = previewPoints!.map((p) => ({ lat: p.lat, lon: p.lon }));
    } else if ((displayRoutePoints?.length ?? 0) >= 2) {
      points = displayRoutePoints!;
    } else if (state?.gpxData) {
      const parsed = await parseGPXForNavigation(state.gpxData as string);
      points = parsed.points;
    }
    if (points.length < 2) {
      Alert.alert(
        "Not enough points",
        "Load a route or GPX preview with at least 2 points first."
      );
      return;
    }
    actions.setFixToRoadsLoading(true);
    try {
      let matched: MatchedRoute | null = null;
      const routingConfig = await getRoutingConfigAsync();
      if (routingConfig.baseUrl) {
        matched = await routeThroughWaypoints(points, routingConfig);
      }
      if (!matched) {
        matched = buildOfflineMatchedRoute(points);
      }
      actions.setCachedMatchedRoute(matched);
      // Flag so the cache-invalidation useEffect skips this update
      fixToRoadsJustRan.current = true;
      // Show the road-following geometry on the map
      dispatch({
        type: "SET_PREVIEW_ROUTE",
        payload: matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })),
      });
    } catch (e) {
      console.warn("Fix to roads failed:", e);
      Alert.alert("Fix to roads", "Could not snap route to roads. Try again.");
    } finally {
      actions.setFixToRoadsLoading(false);
    }
  }, [previewPoints, displayRoutePoints, state?.gpxData, dispatch, actions]);

  const handleRecalculate = useCallback(
    async (payload: OffRoutePayload) => {
      if (!matchedRoute) {
        console.log("[Recalculate] Skip: no matched route");
        return;
      }
      const geom = matchedRoute.matchedGeometry;
      const fromIdx =
        typeof payload.segmentIndex === "number"
          ? payload.segmentIndex
          : payload.currentStepIndex;
      const remaining = geom
        .slice(fromIdx + 1)
        .map((p) => ({ lat: p.lat, lon: p.lon }));
      const points = [payload.location, ...remaining];
      if (points.length < 2) {
        console.log("[Recalculate] Skip: need at least 2 points, got", points.length);
        return;
      }
      console.log("[Recalculate] Starting: fromIdx=" + fromIdx + ", points=" + points.length);
      actions.setNavLoading(true);
      try {
        const routingConfig = await getRoutingConfigAsync();
        console.log("[Recalculate] Config: provider=" + routingConfig.provider + ", baseUrl=" + !!routingConfig.baseUrl + ", hasKey=" + !!routingConfig.googleApiKey);
        const maxWaypoints = 25;
        const waypoints =
          points.length <= maxWaypoints
            ? points
            : (() => {
                const step = (points.length - 1) / (maxWaypoints - 1);
                const out: Array<{ lat: number; lon: number }> = [];
                for (let i = 0; i < maxWaypoints; i++) {
                  out.push(points[Math.min(Math.round(i * step), points.length - 1)]);
                }
                return out;
              })();
        let newMatch: MatchedRoute | null = null;
        if (waypoints.length >= 2) {
          newMatch = await routeThroughWaypoints(waypoints, routingConfig);
        }
        if (newMatch) {
          console.log("[Recalculate] OK: route pts=" + newMatch.matchedGeometry.length + ", dist=" + (newMatch.totalDistance | 0) + "m");
        } else {
          console.log("[Recalculate] Fallback: using offline straight-line route");
          newMatch = buildOfflineMatchedRoute(points);
        }
        actions.setMatchedRoute(newMatch);
      } finally {
        actions.setNavLoading(false);
      }
    },
    [matchedRoute, actions]
  );

  const getStartForDirections = useCallback((): Promise<{ lat: number; lon: number } | null> => {
    if (displayRoutePoints?.length) {
      const first = displayRoutePoints[0];
      const lat = "lat" in first ? first.lat : (first as { latitude: number }).latitude;
      const lon = "lon" in first ? first.lon : (first as { longitude: number }).longitude;
      return Promise.resolve({ lat, lon });
    }
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
        );
      });
    }
    return (async () => {
      try {
        const Loc = await import("expo-location");
        const { status } = await Loc.requestForegroundPermissionsAsync();
        if (status !== "granted") return null;
        const getPos = (Loc as { getCurrentPositionAsync?: (opts: object) => Promise<{ coords: { latitude: number; longitude: number } }> }).getCurrentPositionAsync;
        if (!getPos) return null;
        const pos = await getPos({});
        return { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch {
        return null;
      }
    })();
  }, [displayRoutePoints]);

  const handleDirectionsHere = useCallback(async () => {
    if (!tapDestination) return;
    hapticImpact();
    actions.setDirectionsLoading(true);
    try {
      const from = await getStartForDirections();
      if (!from) {
        Alert.alert(
          "Directions",
          "Allow location access or load a route so we can route from your position or the route start."
        );
        return;
      }
      let matched: MatchedRoute | null = null;
      const routingConfig = await getRoutingConfigAsync();
      if (routingConfig.baseUrl) {
        matched = await routeBetweenPoints(from, tapDestination, routingConfig);
      }
      if (!matched) {
        matched = buildOfflineMatchedRoute([from, tapDestination]);
      }
      dispatch({
        type: "SET_PREVIEW_ROUTE",
        payload: matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })),
      });
      actions.setCachedMatchedRoute(matched);
      actions.setTapDestination(null);
    } catch (e) {
      console.warn("Directions here failed:", e);
      Alert.alert("Directions", "Could not get route. Try again.");
    } finally {
      actions.setDirectionsLoading(false);
    }
  }, [tapDestination, getStartForDirections, dispatch, actions]);

  const mapContent = (
    <RouteMap
      collectionPoints={isPreviewMode ? [] : collectionPoints}
      routePoints={displayRoutePoints}
      segmentRisks={state.weatherAnalysis?.segmentRisks}
      height={height}
      width={width}
      onPointClick={handlePointPress}
      onMapPress={onMapPress}
      tapDestination={osmExtractorVisible ? null : tapDestination}
      osmExtractionPolygon={
        osmExtractionPoints.length >= 3 ? osmExtractionPoints : undefined
      }
      osmExtractionPoints={osmExtractionPoints}
      osmExtractedFeatures={osmExtractedData?.features}
      osmExtractorVisible={osmExtractorVisible}
    />
  );

  if (navigationMode && matchedRoute) {
    return (
      <View style={styles.container}>
        <NavigationView
          matchedRoute={matchedRoute}
          fullRoutePoints={displayRoutePoints?.length ? displayRoutePoints : undefined}
          onClose={() => {
            actions.setNavigationMode(false);
            actions.setMatchedRoute(null);
          }}
          onRecalculate={handleRecalculate}
          autoRecalculateOnOffRoute={!roadClosureHandlingOn}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { width, height },
          styles.mapWrapper,
        ]}
      >
        {mapContent}
      </View>

      {/* Compact overlay: actions only */}
      <View
        style={[
          styles.headerOverlay,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.background + "E6",
          },
        ]}
      >
        <View style={styles.buttonRow}>
          {tapDestination != null && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={handleDirectionsHere}
              disabled={directionsLoading}
            >
              {directionsLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.actionButtonText}>Directions here</Text>
              )}
            </TouchableOpacity>
          )}
          {canStartNavigation && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary, marginLeft: tapDestination ? 8 : 0 }]}
              onPress={startNavigation}
              disabled={navLoading}
            >
              {navLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.actionButtonText}>Start Navigation</Text>
              )}
            </TouchableOpacity>
          )}
          {canStartNavigation && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.muted + "CC", marginLeft: 8 }]}
              onPress={handleFixToRoads}
              disabled={fixToRoadsLoading}
            >
              {fixToRoadsLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.actionButtonText}>Fix to roads</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
        {!canStartNavigation && (
          <Text style={[styles.hintText, { color: colors.muted }]}>
            Import OSM in Planner and generate a route, or open a GPX preview, then return here.
          </Text>
        )}
      </View>

      {/* Weather overlay when plugin enabled and layer toggled on */}
      {weatherPluginEnabled && activeOverlays.includes("weather-overlay") && (() => {
        const wp = getPlugin("weather");
        const MapOverlay = wp?.getFeatures().mapOverlay as React.ComponentType | undefined;
        return MapOverlay ? (
          <Suspense fallback={null}>
            <MapOverlay />
          </Suspense>
        ) : null;
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapWrapper: {
    pointerEvents: "auto",
  },
  mapPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
  },
  mapPlaceholderText: {
    color: "#888",
    fontSize: 16,
  },
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  hintText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 320,
  },
});
