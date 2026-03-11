/**
 * Turn-by-turn navigation — NATIVE ONLY (iOS/Android).
 * Uses native MapView with rotation: when moving, map follows direction of travel;
 * when stationary, map follows device compass so you can look around.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Switch,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, Polyline, UrlTile } from "react-native-maps";
import { useColors } from "@/hooks/use-colors";
import { getLeafletNavigationMapHTML } from "@/lib/leaflet-map-html";
import { getLeafletNavigationMapHTMLLocal } from "@/lib/leaflet-map-html-local";
import { useMapType } from "@/lib/map-type-preference";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { NavigationEngine } from "@/lib/NavigationEngine";
import type { MatchedRoute } from "@/lib/mapMatching";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useRouteParametersStore } from "@/stores/routeParametersStore";

/** Speed below this (m/s) = stationary → use compass to look around. */
const STATIONARY_SPEED_THRESHOLD = 0.5;

let ManeuverIcon: React.ComponentType<{
  name: string;
  size: number;
  color: string;
}> | null = null;
try {
  ManeuverIcon = require("@expo/vector-icons/MaterialCommunityIcons").default;
} catch {
  // optional
}

let WebView: any;
try {
  WebView = require("react-native-webview").WebView;
} catch {
  // web or not installed
}

function getManeuverIcon(type?: string, modifier?: string): string {
  if (type === "arrive") return "flag-checkered";
  if (type === "depart") return "navigation";
  if (type === "roundabout" || type === "rotary") return "rotate-right";
  const m = (modifier ?? "").toLowerCase();
  if (m.includes("left")) {
    if (m.includes("sharp")) return "arrow-bottom-left";
    if (m.includes("slight")) return "arrow-top-left";
    return "arrow-left";
  }
  if (m.includes("right")) {
    if (m.includes("sharp")) return "arrow-bottom-right";
    if (m.includes("slight")) return "arrow-top-right";
    return "arrow-right";
  }
  return "arrow-up";
}

function getManeuverDescription(type?: string, modifier?: string): string {
  if (type === "arrive") return "Arriving at destination";
  if (type === "depart") return "Starting navigation";
  if (type === "roundabout" || type === "rotary") return "Enter roundabout";

  const m = (modifier ?? "").toLowerCase();
  if (m.includes("left")) {
    if (m.includes("sharp")) return "Make a sharp left turn";
    if (m.includes("slight")) return "Make a slight left turn";
    return "Turn left";
  }
  if (m.includes("right")) {
    if (m.includes("sharp")) return "Make a sharp right turn";
    if (m.includes("slight")) return "Make a slight right turn";
    return "Turn right";
  }
  if (type === "turn" && m.includes("uturn")) return "Make a U-turn";
  if (type === "merge") return "Merge onto road";
  if (type === "fork") return "Keep on the fork";
  if (type === "on ramp") return "Take the ramp";

  return "Continue straight";
}

export interface OffRoutePayload {
  location: { lat: number; lon: number };
  currentStepIndex: number;
  /** Point index on matchedGeometry; use this to slice "remaining" route (exclude done segments). */
  segmentIndex?: number;
  distance: number;
}

export interface NavigationViewProps {
  matchedRoute: MatchedRoute;
  /** When set, draw this full route for display so segments don't disappear (matched route is downsampled). */
  fullRoutePoints?: { lat: number; lon: number }[];
  onClose: () => void;
  onOffRoute?: (payload: OffRoutePayload) => void;
  onRecalculate?: (payload: OffRoutePayload) => void;
  /** When true, automatically call onRecalculate when off-route (no banner). When false, show banner and require user to tap Recalculate. */
  autoRecalculateOnOffRoute?: boolean;
  /** Meters from route before triggering off-route (from Route parameters). Default 50. */
  offRouteThresholdMeters?: number;
}

export default function NavigationView({
  matchedRoute,
  fullRoutePoints: _fullRoutePoints,
  onClose,
  onOffRoute,
  onRecalculate,
  autoRecalculateOnOffRoute = false,
  offRouteThresholdMeters = 50,
}: NavigationViewProps) {
  const colors = useColors();
  const showSpeed = useMapDisplayStore((s) => s.showSpeed);
  const offRouteAlertEnabled = useRouteParametersStore(
    (s) => s.offRouteAlertEnabled,
  );
  const insets = useSafeAreaInsets();
  const [mapTypePreference] = useMapType();
  const [navState, setNavState] = useState<ReturnType<
    NavigationEngine["getState"]
  > | null>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [simulationMode, setSimulationMode] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [offRoutePayload, setOffRoutePayload] =
    useState<OffRoutePayload | null>(null);
  /** Device compass heading (degrees). Used when stationary so user can look around. */
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  // Only use offline fallback if the WebView fails to load — don't default to it on any platform.
  const [useFallback, setUseFallback] = useState(false);
  const [hasError, setHasError] = useState(false);
  const engineRef = useRef<NavigationEngine | null>(null);
  const webViewRef = useRef<any>(null);
  const mapRef = useRef<MapView>(null);
  const zoomRef = useRef(17);

  /** When moving: use direction of travel. When stationary: use device compass so you can look around. */
  const displayHeading = useMemo(() => {
    const loc = navState?.currentLocation;
    const speed = loc?.speed ?? -1;
    const bearing =
      loc?.bearing != null && loc.bearing >= 0 && loc.bearing < 360
        ? loc.bearing
        : null;
    const compass =
      deviceHeading != null && deviceHeading >= 0 && deviceHeading < 360
        ? deviceHeading
        : null;
    const isStationary = speed < STATIONARY_SPEED_THRESHOLD;
    if (isStationary) return compass ?? bearing ?? 0;
    return bearing ?? compass ?? 0;
  }, [
    navState?.currentLocation?.speed,
    navState?.currentLocation?.bearing,
    deviceHeading,
  ]);

  const injectUserLocation = useCallback(
    (lat: number, lon: number, follow: boolean) => {
      try {
        const script = `(function(){ if (typeof window.setUserLocation === 'function') { window.setUserLocation(${lat}, ${lon}, ${follow}); } })(); true;`;
        webViewRef.current?.injectJavaScript?.(script);
      } catch (error) {
        console.error(
          "[NavigationView] Failed to inject user location:",
          error,
        );
        setHasError(true);
      }
    },
    [],
  );

  // Device compass: when navigation is active, watch heading so map can rotate when stationary (look around).
  useEffect(() => {
    if (!isStarted || Platform.OS === "web") return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        sub = await Location.watchHeadingAsync((e) => {
          const h = e.trueHeading;
          if (h >= 0 && h < 360) setDeviceHeading(h);
        });
        if (cancelled) {
          sub.remove();
          sub = null;
        }
      } catch {
        // watchHeadingAsync not available
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, [isStarted]);

  useEffect(() => {
    setOffRoutePayload(null);
    engineRef.current = new NavigationEngine(matchedRoute, {
      simulationMode,
      offRouteThreshold: offRouteThresholdMeters,
    });

    const unsubUpdate = engineRef.current.on("update", (state) => {
      setNavState(state);

      if (state.currentLocation) {
        injectUserLocation(
          state.currentLocation.lat,
          state.currentLocation.lon,
          true,
        );
      }
    });

    const unsubArrived = engineRef.current.on("arrived", () => {
      setNavState((s) => (s ? { ...s, isNavigating: false } : null));
    });

    const unsubOffRoute = engineRef.current.on(
      "offRoute",
      (payload: OffRoutePayload) => {
        onOffRoute?.(payload);
        if (autoRecalculateOnOffRoute && onRecalculate) {
          onRecalculate(payload);
          setOffRoutePayload(null);
        } else {
          setOffRoutePayload(payload);
        }
      },
    );

    return () => {
      unsubUpdate();
      unsubArrived();
      unsubOffRoute();
      engineRef.current?.stop();
    };
  }, [
    matchedRoute,
    onOffRoute,
    onRecalculate,
    autoRecalculateOnOffRoute,
    injectUserLocation,
    simulationMode,
    offRouteThresholdMeters,
  ]);

  const startNavigation = async () => {
    if (isStarting) return;
    setIsStarting(true);
    const t0 = performance.now();
    console.log("[Navigation] Start button pressed");
    try {
      await engineRef.current?.start();
      console.log(
        `[Navigation] Engine started in ${(performance.now() - t0).toFixed(0)}ms`,
      );
      setIsStarted(true);
      console.log(
        `[Navigation] UI ready in ${(performance.now() - t0).toFixed(0)}ms`,
      );
    } catch (e) {
      console.warn(
        `[Navigation] Start failed after ${(performance.now() - t0).toFixed(0)}ms:`,
        e,
      );
    } finally {
      setIsStarting(false);
    }
  };

  const SIM_SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;

  const handleSimSpeedChange = (speed: number) => {
    setSimSpeed(speed);
    engineRef.current?.setSpeedMultiplier(speed);
  };

  const formatDistance = (meters: number) => {
    if (meters >= 1609) return `${(meters / 1609).toFixed(1)} mi`;
    if (meters >= 160) return `${Math.round(meters / 160) * 160} ft`;
    return `${Math.round(meters)} ft`;
  };

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins} min`;
  };

  const routeCoords = useMemo(
    () =>
      matchedRoute.matchedGeometry.map((p) => ({
        latitude: p.lat,
        longitude: p.lon,
      })),
    [matchedRoute.matchedGeometry],
  );

  // Use bright orange for route line visibility on map (theme primary is near-white in dark mode)
  const primary = "#F97316";

  const SEGMENT_COLOR_COMPLETED = "#9CA3AF"; // gray
  const SEGMENT_COLOR_CURRENT = "#22c55e"; // green
  const SEGMENT_COLOR_UPCOMING = "#FFFFFF"; // white

  const currentSegIdx =
    navState &&
    isStarted &&
    typeof (navState as { segmentIndex?: number }).segmentIndex === "number"
      ? (navState as { segmentIndex: number }).segmentIndex
      : -1;

  const segmentPolylines = useMemo(() => {
    if (!isStarted || currentSegIdx < 0 || routeCoords.length < 2) return null;

    const completed =
      currentSegIdx > 0 ? routeCoords.slice(0, currentSegIdx + 1) : null;

    const current =
      currentSegIdx < routeCoords.length - 1
        ? routeCoords.slice(currentSegIdx, currentSegIdx + 2)
        : null;

    const upcoming =
      currentSegIdx + 1 < routeCoords.length - 1
        ? routeCoords.slice(currentSegIdx + 1)
        : null;

    return { completed, current, upcoming };
  }, [isStarted, currentSegIdx, routeCoords]);

  const navPayload = useMemo(
    () => ({
      mapType: mapTypePreference,
      routeCoords,
      primaryColor: primary,
      mutedColor: colors.muted ?? "#71717a",
      traveledSegmentIndex: currentSegIdx,
    }),
    [mapTypePreference, routeCoords, primary, colors.muted, currentSegIdx],
  );

  const injectNavPayload = useCallback(() => {
    try {
      const script = `(function(){ if (typeof window.setMapData === 'function') { window.setMapData(${JSON.stringify(navPayload)}); } })(); true;`;
      webViewRef.current?.injectJavaScript?.(script);
    } catch (error) {
      console.error("[NavigationView] Failed to inject nav payload:", error);
      setHasError(true);
    }
  }, [navPayload]);

  useEffect(() => {
    injectNavPayload();
  }, [injectNavPayload]);

  // Native map: follow user and rotate map (course when moving, compass when stationary).
  const userLoc = navState?.currentLocation;
  useEffect(() => {
    if (!mapRef.current || !userLoc || !isStarted) return;
    mapRef.current.animateCamera(
      {
        center: { latitude: userLoc.lat, longitude: userLoc.lon },
        heading: displayHeading,
        zoom: zoomRef.current,
        pitch: 0,
      },
      { duration: 800 },
    );
  }, [userLoc?.lat, userLoc?.lon, displayHeading, isStarted]);

  const navHtml = useMemo(() => {
    if (useFallback || hasError) {
      console.log("[NavigationView] Using fallback HTML");
      return getLeafletNavigationMapHTMLLocal();
    }
    return getLeafletNavigationMapHTML();
  }, [useFallback, hasError]);

  const activeBaseLayer = useMapLayerStore((s) => s.activeBaseLayer);

  if (!WebView) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.unavailableText, { color: colors.muted }]}>
          Live turn-by-turn isn&apos;t available here. Close to return to the
          map.
        </Text>
        <TouchableOpacity
          style={[styles.closeButton, { backgroundColor: primary }]}
          onPress={onClose}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const OSM_STANDARD = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const OSM_DARK = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
  const tileUrl = mapTypePreference === "dark" ? OSM_DARK : OSM_STANDARD;

  return (
    <View style={styles.container}>
      {/* Native map with rotation: when moving, map follows direction of travel; when stationary, compass so you can look around. */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: routeCoords[0]?.latitude ?? 0,
          longitude: routeCoords[0]?.longitude ?? 0,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        mapType={
          activeBaseLayer === "google-maps"
            ? "standard"
            : activeBaseLayer === "google-satellite"
              ? "satellite"
              : activeBaseLayer === "google-hybrid"
                ? "hybrid"
                : activeBaseLayer === "google-terrain"
                  ? "terrain"
                  : "none"
        }
        showsBuildings={activeBaseLayer === "google-hybrid"}
        rotateEnabled
        pitchEnabled={true}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {!activeBaseLayer.startsWith("google-") && (
          <UrlTile
            urlTemplate={tileUrl}
            tileSize={256}
            opacity={1.0}
            shouldReplaceMapContent={Platform.OS === "ios"}
            maximumZ={19}
            flipY={Platform.OS === "android"}
            zIndex={-1}
          />
        )}
        {routeCoords.length >= 2 &&
          (segmentPolylines ? (
            <>
              {segmentPolylines.upcoming &&
                segmentPolylines.upcoming.length >= 2 && (
                  <Polyline
                    coordinates={segmentPolylines.upcoming}
                    strokeColor={SEGMENT_COLOR_UPCOMING}
                    strokeWidth={7}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={1}
                  />
                )}
              {segmentPolylines.current &&
                segmentPolylines.current.length >= 2 && (
                  <Polyline
                    coordinates={segmentPolylines.current}
                    strokeColor={SEGMENT_COLOR_CURRENT}
                    strokeWidth={9}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={3}
                  />
                )}
              {segmentPolylines.completed &&
                segmentPolylines.completed.length >= 2 && (
                  <Polyline
                    coordinates={segmentPolylines.completed}
                    strokeColor={SEGMENT_COLOR_COMPLETED}
                    strokeWidth={7}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={2}
                  />
                )}
            </>
          ) : (
            <Polyline
              coordinates={routeCoords}
              strokeColor={primary}
              strokeWidth={8}
              lineCap="round"
              lineJoin="round"
              zIndex={1}
            />
          ))}
        {routeCoords.length >= 1 && (
          <Marker
            coordinate={routeCoords[0]}
            pinColor={primary}
            title="Start"
          />
        )}
        {routeCoords.length >= 2 && (
          <Marker
            coordinate={routeCoords[routeCoords.length - 1]}
            pinColor="#ef4444"
            title="End"
          />
        )}
        {userLoc && isStarted && (
          <Marker
            coordinate={{ latitude: userLoc.lat, longitude: userLoc.lon }}
            pinColor="#4285F4"
            title="You"
            flat
          />
        )}
      </MapView>

      {/* Zoom controls */}
      <View style={[styles.zoomControls, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={[
            styles.zoomButton,
            {
              backgroundColor: colors.surface + "DD",
              borderColor: colors.border,
            },
          ]}
          onPress={() => {
            zoomRef.current = Math.min(zoomRef.current + 1, 20);
            mapRef.current?.animateCamera(
              { zoom: zoomRef.current },
              { duration: 200 },
            );
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.zoomButtonText, { color: colors.text }]}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.zoomButton,
            {
              backgroundColor: colors.surface + "DD",
              borderColor: colors.border,
            },
          ]}
          onPress={() => {
            zoomRef.current = Math.max(zoomRef.current - 1, 5);
            mapRef.current?.animateCamera(
              { zoom: zoomRef.current },
              { duration: 200 },
            );
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.zoomButtonText, { color: colors.text }]}>−</Text>
        </TouchableOpacity>
      </View>

      {navState && isStarted && (
        <View
          style={[
            styles.instructionBar,
            {
              backgroundColor: colors.surface + "D9",
              paddingTop: insets.top + 8,
              paddingBottom: 10,
            },
          ]}
        >
          {navState.isNavigating && (
            <View
              style={[
                styles.optimizedRouteBadge,
                { backgroundColor: colors.surface + "E6" },
              ]}
            >
              <Text style={[styles.optimizedRouteText, { color: colors.text }]}>
                Optimized Route
              </Text>
            </View>
          )}
          <View
            style={[
              styles.maneuverIconBox,
              !navState.isNavigating && styles.maneuverIconBoxSmall,
              { backgroundColor: colors.surface + "CC" },
            ]}
          >
            {!navState.isNavigating ? (
              <View style={styles.arrivalIndicator}>
                <Text style={styles.arrivedText}>✓</Text>
              </View>
            ) : ManeuverIcon ? (
              <ManeuverIcon
                name={getManeuverIcon(
                  navState.nextManeuverType,
                  navState.nextManeuverModifier,
                )}
                size={40}
                color={colors.text}
              />
            ) : (
              <Text style={styles.maneuverEmoji}>↑</Text>
            )}
          </View>
          <View style={styles.instructionText}>
            {!navState.isNavigating ? (
              <Text
                style={[
                  styles.distanceText,
                  styles.distanceTextArrived,
                  { color: colors.text },
                ]}
              >
                You have arrived at your destination
              </Text>
            ) : (
              <>
                <Text style={[styles.distanceText, { color: colors.text }]}>
                  {formatDistance(navState.distanceToNextManeuver)} away
                </Text>
                <Text
                  style={[styles.streetText, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {navState.nextStep?.name || "Continue on route"}
                </Text>
                {navState.nextManeuverType && (
                  <Text
                    style={[styles.maneuverDescription, { color: colors.text }]}
                  >
                    {getManeuverDescription(
                      navState.nextManeuverType,
                      navState.nextManeuverModifier,
                    )}
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
      )}

      {offRouteAlertEnabled && offRoutePayload && onRecalculate && (
        <View
          style={[
            styles.offRouteBar,
            {
              backgroundColor: colors.warning,
              paddingTop: insets.top + 12,
              paddingBottom: 16,
            },
          ]}
        >
          <Text style={styles.offRouteText}>
            You&apos;re off the optimized route
          </Text>
          <TouchableOpacity
            style={[styles.recalculateButton, { backgroundColor: primary }]}
            onPress={() => {
              onRecalculate(offRoutePayload);
              setOffRoutePayload(null);
            }}
          >
            <Text style={styles.recalculateButtonText}>Find New Route</Text>
          </TouchableOpacity>
        </View>
      )}

      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: "transparent",
            paddingTop: 12,
            paddingBottom: Math.max(10, insets.bottom + 6),
          },
        ]}
      >
        {!isStarted ? (
          <View>
            <View style={styles.simulationRow}>
              <Text style={[styles.simulationText, { color: colors.text }]}>
                Simulation Mode
              </Text>
              <Switch
                value={simulationMode}
                onValueChange={setSimulationMode}
                trackColor={{ false: "#767577", true: primary }}
                thumbColor={
                  Platform.OS === "ios"
                    ? "#fff"
                    : simulationMode
                      ? primary
                      : "#f4f3f4"
                }
              />
            </View>
            {simulationMode && (
              <View style={styles.speedRow}>
                <Text style={[styles.speedLabel, { color: colors.text }]}>
                  Speed
                </Text>
                <View style={styles.speedChips}>
                  {SIM_SPEED_OPTIONS.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.speedChip,
                        {
                          borderColor:
                            simSpeed === s
                              ? primary
                              : (colors.muted ?? "#71717a"),
                        },
                        simSpeed === s && { backgroundColor: primary },
                      ]}
                      onPress={() => handleSimSpeedChange(s)}
                    >
                      <Text
                        style={[
                          styles.speedChipText,
                          { color: simSpeed === s ? "#fff" : colors.text },
                        ]}
                      >
                        {s}x
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.startButton,
                { backgroundColor: primary },
                isStarting && { opacity: 0.7 },
              ]}
              onPress={startNavigation}
              disabled={isStarting}
            >
              {isStarting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.startButtonText}>Start Navigation</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.statsRow}>
            <View style={styles.mainStats}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: primary }]}>
                  {formatDistance(navState?.distanceRemaining ?? 0)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.text }]}>
                  Remaining
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: primary }]}>
                  {formatDuration(matchedRoute.totalDuration ?? 0)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.text }]}>
                  ETA
                </Text>
              </View>
              {showSpeed &&
                navState?.currentLocation?.speed != null &&
                navState.currentLocation.speed >= 0 && (
                  <View style={styles.stat}>
                    <Text style={[styles.statValue, { color: primary }]}>
                      {(navState.currentLocation.speed * 2.237).toFixed(0)}
                    </Text>
                    <Text style={[styles.statLabel, { color: colors.text }]}>
                      mph
                    </Text>
                  </View>
                )}
            </View>
            {simulationMode && (
              <View style={styles.speedRowInline}>
                {SIM_SPEED_OPTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.speedChipSmall,
                      {
                        borderColor:
                          simSpeed === s
                            ? primary
                            : (colors.muted ?? "#71717a"),
                      },
                      simSpeed === s && { backgroundColor: primary },
                    ]}
                    onPress={() => handleSimSpeedChange(s)}
                  >
                    <Text
                      style={[
                        styles.speedChipTextSmall,
                        { color: simSpeed === s ? "#fff" : colors.text },
                      ]}
                    >
                      {s}x
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={styles.actionButtons}>
              {onRecalculate &&
                (navState?.segmentIndex ?? 0) <
                  matchedRoute.matchedGeometry.length - 1 && (
                  <TouchableOpacity
                    style={[
                      styles.recalculateFromHereButton,
                      { backgroundColor: colors.muted + "CC" },
                    ]}
                    onPress={() => {
                      const segIdx = navState?.segmentIndex ?? 0;
                      const geom = matchedRoute.matchedGeometry;
                      const location =
                        navState?.currentLocation ?? geom[segIdx] ?? geom[0];
                      if (!location) return;
                      onRecalculate({
                        location: { lat: location.lat, lon: location.lon },
                        currentStepIndex: navState?.currentStepIndex ?? 0,
                        segmentIndex: segIdx,
                        distance: 0,
                      });
                    }}
                  >
                    <Text style={styles.recalculateFromHereText}>
                      Recalculate from here
                    </Text>
                  </TouchableOpacity>
                )}
              <TouchableOpacity
                style={[styles.stopButton, { backgroundColor: colors.error }]}
                onPress={onClose}
              >
                <Text style={styles.stopButtonText}>End Navigation</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  zoomControls: {
    position: "absolute",
    right: 12,
    gap: 6,
  },
  zoomButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  zoomButtonText: {
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 24,
  },
  unavailableText: {
    flex: 1,
    textAlign: "center",
    padding: 24,
    fontSize: 16,
  },
  instructionBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  maneuverIconBox: {
    width: 56,
    height: 56,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  maneuverIconBoxSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  arrivalIndicator: {
    width: 44,
    height: 44,
    backgroundColor: "#4CAF50",
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  maneuverEmoji: {
    fontSize: 28,
  },
  arrivedText: {
    fontSize: 28,
    color: "#fff",
    fontWeight: "700",
  },
  instructionText: {
    flex: 1,
    marginLeft: 14,
    justifyContent: "center",
  },
  distanceText: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 2,
  },
  distanceTextArrived: {
    fontSize: 18,
  },
  streetText: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 2,
  },
  maneuverDescription: {
    fontSize: 13,
    fontWeight: "400",
  },
  optimizedRouteBadge: {
    position: "absolute",
    right: 16,
    top: 8,
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  optimizedRouteText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  startButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  statsRow: {
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: 56,
  },
  mainStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 8,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stat: {
    alignItems: "center",
    paddingHorizontal: 12,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 14,
    marginTop: 4,
    color: "#666",
  },
  stopButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  stopButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  recalculateFromHereButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  recalculateFromHereText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  startMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  endMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  markerLabel: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  closeButton: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  closeButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  offRouteBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  offRouteText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "700",
  },
  recalculateButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  recalculateButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  simulationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  simulationText: {
    fontSize: 16,
    fontWeight: "500",
  },
  speedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    paddingHorizontal: 12,
  },
  speedLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  speedChips: {
    flexDirection: "row",
    gap: 8,
  },
  speedChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  speedChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  speedRowInline: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: 8,
  },
  speedChipSmall: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  speedChipTextSmall: {
    fontSize: 12,
    fontWeight: "600",
  },
});
