import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useColors } from "@/hooks/use-colors";
import type { Route, CollectionPoint } from "@/types";
import { storage } from "@/lib/storage";
import { useRouting } from "@/lib/routing-context";
import { isMockRoute, isMockCollectionPoints } from "@/lib/is-mock-route";
import { parseGPXForNavigation } from "@/lib/gpxNavParser";
import { generateGPXString, generateMultiTrackGPXString } from "@/lib/routing-context";
import {
  matchGPXToRoads,
  routeBetweenPoints,
  routeThroughWaypoints,
} from "@/lib/mapMatching";
import { buildMatchedRouteFromHierholzer } from "@/lib/hierholzerInstructions";
import { getRoutingConfigAsync } from "@/lib/routing-config";
import type { MatchedRoute } from "@/lib/mapMatching";

import { RouteMap, type RouteMapRef } from "@/components/route-map";
import { matchedRouteToGeoJSON } from "@/lib/geojson-utils";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-utils";
import NavigationView, {
  type OffRoutePayload,
} from "@/components/NavigationView";
import CollectionNavigator from "@/components/CollectionNavigator";
import { navigateExternally, openGoogleMapsViewer } from "@/lib/externalNavigation";
import type { NormalNavDestination } from "@/types/navigation";
import { useCollectionNavigationStore } from "@/stores/collectionNavigationStore";
import { MapFloatingControls } from "@/components/mapTab/controls/MapFloatingControls";
import { MapSidebar } from "@/components/mapTab/sidebar/MapSidebar";
import { HelpPrompt } from "@/components/help/HelpPrompt";
import { NavigationPanel } from "@/components/mapTab/navigation/NavigationPanel";
import { MyPlacesScreen } from "@/components/mapTab/places/MyPlacesScreen";
import { MapsAndResourcesScreen } from "@/components/mapTab/resources/MapsAndResourcesScreen";
import { ConfigureScreenSheet } from "@/components/mapTab/resources/ConfigureScreenSheet";
import { RouteParametersSheet } from "@/components/mapTab/resources/RouteParametersSheet";
import { MapStyleSheet } from "@/components/mapTab/resources/MapStyleSheet";
import { MapMarkersScreen } from "@/components/mapTab/markers/MapMarkersScreen";
import { PlaceInfoSheet } from "@/components/mapTab/PlaceInfoSheet";
import { MapillaryViewer } from "@/components/MapillaryViewer";
import { StreetViewPreview } from "@/components/StreetViewPreview";
import { openMapillaryCapture } from "@/lib/mapillary";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { useMapDisplayStore } from "../stores/mapDisplayStore";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { useDeviceType } from "@/hooks/useDeviceType";
import { SIDEBAR_WIDTH_IPAD } from "@/constants/sidebarConfig";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { useMarkersStore } from "@/stores/markersStore";
import {
  getRouteOptionsForRouting,
  useRouteParametersStore,
} from "@/stores/routeParametersStore";
import { enrichRoute } from "@/services/InstructionManager";
import { getDownloadedRegions } from "@/lib/offline-map-download";
import { useMapOrientation } from "@/lib/map-orientation-preference";
import { PowerSavingIndicator } from "@/components/PowerSavingIndicator/PowerSavingIndicator";
import { useOSMMapPress } from "@/hooks/useOSMMapPress";
import { useTrackRecorder } from "@/hooks/useTrackRecorder";
import {
  trackStorage,
  type SavedTrack,
} from "@/lib/track-storage";
import { useRecordingSettingsStore } from "@/stores/recordingSettingsStore";
import { RecOptionsModal } from "@/components/RecOptionsModal";
import { confirmDestructive } from "@/lib/confirmDestructive";
import { Fonts, glassStyle } from "@/lib/_core/theme";
import { FlatList, Animated } from "react-native";

// --- Optimized store selectors ---
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { sanitizeLatLonArray, sanitizeByVehicle } from "@/lib/coord-utils";

/** Max pins to show for a route; avoids treating every track node as a marker. */
const MAX_ROUTE_MARKERS = 50;

/** Downsample to at most maxPoints: first, last, and evenly spaced in between. */
function downsampleForMarkers<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const indices: number[] = [0];
  for (let i = 1; i < maxPoints - 1; i++) {
    indices.push(Math.floor((i / (maxPoints - 1)) * (arr.length - 1)));
  }
  if (arr.length > 1) indices.push(arr.length - 1);
  return indices.map((i) => arr[i]);
}

export default function MapContent() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, dispatch } = useRouting();

  // ---------------------------------------------------------------------------
  // Zustand store subscriptions (replaces 20+ useState calls)
  // Each selector subscribes to only the specific field(s) it needs,
  // preventing unnecessary re-renders when unrelated state changes.
  // ---------------------------------------------------------------------------
  const route = useMapStateStore((s) => s.route);
  const collectionPoints = useMapStateStore((s) => s.collectionPoints);
  const routePoints = useMapStateStore((s) => s.routePoints);
  const navigationMode = useMapStateStore((s) => s.navigationMode);
  const matchedRoute = useMapStateStore((s) => s.matchedRoute);
  const cachedMatchedRoute = useMapStateStore((s) => s.cachedMatchedRoute);
  const navLoading = useMapStateStore((s) => s.navLoading);
  const fixToRoadsLoading = useMapStateStore((s) => s.fixToRoadsLoading);
  const directionsLoading = useMapStateStore((s) => s.directionsLoading);
  const tapDestination = useMapStateStore((s) => s.tapDestination);
  const roadClosureHandlingOn = useMapStateStore(
    (s) => s.roadClosureHandlingOn,
  );
  const mapLoading = useMapStateStore((s) => s.mapLoading);
  const mapError = useMapStateStore((s) => s.mapError);
  const dimensions = useMapStateStore((s) => s.dimensions);
  const userBearing = useMapStateStore((s) => s.userBearing);
  const mapillaryViewerVisible = useMapStateStore(
    (s) => s.mapillaryViewerVisible,
  );
  const mapillaryCoords = useMapStateStore((s) => s.mapillaryCoords);
  const showAerial = useMapStateStore((s) => s.showAerial);
  const osmExtractionPoints = useMapStateStore((s) => s.osmExtractionPoints);
  const osmExtractedData = useMapStateStore((s) => s.osmExtractedData);
  const selectedPoint = useMapStateStore((s) => s.selectedPoint);

  // Stable action references (never trigger re-renders)
  const actions = useMapActions();

  // Local state that truly belongs to this component only (not shared)
  const [hasOfflineRegions, setHasOfflineRegions] = useState(false);
  const [drivePreviewVisible, setDrivePreviewVisible] = useState(false);
  const [collectionNavMode, setCollectionNavMode] = useState(false);
  const fixToRoadsJustRan = useRef(false);
  const mapRef = useRef<RouteMapRef>(null);
  const myPlacesWasVisibleRef = useRef(false);
  const [mapOrientation] = useMapOrientation();
  const collectionNavReset = useCollectionNavigationStore((s) => s.resetNavigation);

  // ---------------------------------------------------------------------------
  // GPS Recording (moved from Record tab)
  // ---------------------------------------------------------------------------
  const { state: recorder, start: recStart, pause: recPause, resume: recResume, stop: recStop, discard: recDiscard } =
    useTrackRecorder();
  const showRecOnMapWhenRecording = useRecordingSettingsStore((s) => s.showRecOnMapWhenRecording);
  const [savedTracks, setSavedTracks] = useState<SavedTrack[]>([]);
  const [savingTrack, setSavingTrack] = useState(false);
  const [recOptionsVisible, setRecOptionsVisible] = useState(false);
  const [savedTracksExpanded, setSavedTracksExpanded] = useState(false);
  const recFlashAnim = useRef(new Animated.Value(1)).current;

  const isRecording = recorder.status === "recording";
  const isPaused = recorder.status === "paused";
  const isRecActive = isRecording || isPaused;

  // Load saved tracks on mount
  useEffect(() => {
    trackStorage.loadTracks().then(setSavedTracks);
  }, []);

  // Flashing animation for REC badge
  useEffect(() => {
    if (isRecording) {
      const flash = Animated.loop(
        Animated.sequence([
          Animated.timing(recFlashAnim, { toValue: 0.3, duration: 500, useNativeDriver: true }),
          Animated.timing(recFlashAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      );
      flash.start();
      return () => flash.stop();
    } else {
      recFlashAnim.setValue(1);
    }
  }, [isRecording, recFlashAnim]);

  const handleRecStart = useCallback(async () => {
    try {
      await recStart();
    } catch (err: any) {
      Alert.alert("Location Required", err?.message || "Could not access GPS.");
    }
  }, [recStart]);

  const handleRecStop = useCallback(async () => {
    const finalState = await recStop();
    if (finalState.points.length < 2) {
      Alert.alert("Too Few Points", "Need at least 2 GPS points to save a track.");
      return;
    }
    const defaultName = `Track ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (Platform.OS === "web") {
      const name = window.prompt("Track name:", defaultName);
      if (!name) return;
      setSavingTrack(true);
      await trackStorage.saveTrack(name, finalState.points, finalState.totalDistanceMeters, finalState.elapsedMs);
      setSavedTracks(await trackStorage.loadTracks());
      setSavingTrack(false);
    } else {
      Alert.prompt("Save Track", "Enter a name for this track:", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async (name?: string) => {
            setSavingTrack(true);
            await trackStorage.saveTrack(name || defaultName, finalState.points, finalState.totalDistanceMeters, finalState.elapsedMs);
            setSavedTracks(await trackStorage.loadTracks());
            setSavingTrack(false);
          },
        },
      ], "plain-text", defaultName);
    }
  }, [recStop]);

  const handleRecDiscard = useCallback(() => {
    confirmDestructive("Discard Track?", "The recorded track will be lost.", () => recDiscard(), "Discard");
  }, [recDiscard]);

  const handleTrackExport = useCallback(async (track: SavedTrack) => {
    if (Platform.OS === "web") {
      const blob = new Blob([track.gpxData], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${track.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      try {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        const filename = `${track.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.gpx`;
        const path = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, track.gpxData);
        await Sharing.shareAsync(path, { mimeType: "application/gpx+xml", dialogTitle: "Export GPX Track" });
      } catch (err) {
        console.error("Export failed:", err);
        Alert.alert("Export Failed", "Could not export the track.");
      }
    }
  }, []);

  const handleTrackDelete = useCallback((track: SavedTrack) => {
    confirmDestructive("Delete Track?", `Delete "${track.name}"?`, async () => {
      await trackStorage.deleteTrack(track.id);
      setSavedTracks(await trackStorage.loadTracks());
    });
  }, []);

  const handleTrackPreview = useCallback((track: SavedTrack) => {
    dispatch({
      type: "SET_PREVIEW_ROUTE",
      payload: track.points.map((p) => ({ lat: p.lat, lon: p.lon })),
    });
  }, [dispatch]);

  const toggleOverlay = useMapLayerStore((s) => s.toggleOverlay);
  const showTraffic = useMapDisplayStore((s) => s.showTraffic);
  const toggleTraffic = useMapDisplayStore((s) => s.toggleTraffic);
  const showOverture = useMapDisplayStore((s) => s.showOverture);

  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const addMarker = useMarkersStore((s) => s.addMarker);
  const [placeInfoSheetVisible, setPlaceInfoSheetVisible] = useState(false);

  // Sidebar and device hooks must be at top level (before any early return) to satisfy Rules of Hooks
  const navigationPanelVisible = useMapSidebarStore(
    (s) => s.navigationPanelVisible,
  );
  const openNavigationPanel = useMapSidebarStore((s) => s.openNavigationPanel);
  const closeNavigationPanel = useMapSidebarStore(
    (s) => s.closeNavigationPanel,
  );
  const myPlacesPanelVisible = useMapSidebarStore(
    (s) => s.myPlacesPanelVisible,
  );
  const closeMyPlacesPanel = useMapSidebarStore((s) => s.closeMyPlacesPanel);
  const mapsResourcesVisible = useMapSidebarStore(
    (s) => s.mapsResourcesVisible,
  );
  const closeMapsResources = useMapSidebarStore((s) => s.closeMapsResources);
  const configureScreenVisible = useMapSidebarStore(
    (s) => s.configureScreenVisible,
  );
  const closeConfigureScreen = useMapSidebarStore(
    (s) => s.closeConfigureScreen,
  );
  const routeParametersPanelVisible = useMapSidebarStore(
    (s) => s.routeParametersPanelVisible,
  );
  const closeRouteParametersPanel = useMapSidebarStore(
    (s) => s.closeRouteParametersPanel,
  );
  const mapStylePickerVisible = useMapSidebarStore(
    (s) => s.mapStylePickerVisible,
  );
  const closeMapStylePicker = useMapSidebarStore((s) => s.closeMapStylePicker);
  const mapMarkersPanelVisible = useMapSidebarStore(
    (s) => s.mapMarkersPanelVisible,
  );
  const closeMapMarkersPanel = useMapSidebarStore(
    (s) => s.closeMapMarkersPanel,
  );
  const osmExtractorVisible = useMapSidebarStore((s) => s.osmExtractorVisible);
  const closeOSMExtractor = useMapSidebarStore((s) => s.closeOSMExtractor);
  const isPinned = useMapSidebarStore((s) => s.isPinned);
  const deviceType = useDeviceType();

  const previewPoints = state?.previewRoutePoints ?? null;
  const previewRoutePointsByVehicle = state?.previewRoutePointsByVehicle ?? null;

  useEffect(() => {
    useRouteParametersStore.getState().hydrate();
  }, []);
  const recalcDistanceMeters = useRouteParametersStore(
    (s) => s.recalcDistanceMeters,
  );

  // Initialize store data on mount
  useEffect(() => {
    actions.loadRoute();
    actions.loadImportedPoints();
  }, [actions]);

  const displayRoutePoints = useMemo(() => {
    if (previewRoutePointsByVehicle?.length === 1) {
      const pts = previewRoutePointsByVehicle[0];
      return pts?.length
        ? pts.map((p, i) =>
            i === 0 && !(p as { label?: string }).label ? { ...p, label: "S" } : p,
          )
        : routePoints;
    }
    if (previewRoutePointsByVehicle && previewRoutePointsByVehicle.length > 1) {
      return previewRoutePointsByVehicle[0] ?? routePoints;
    }
    if (previewPoints?.length) {
      return previewPoints.map((p, i) =>
        i === 0 && !(p as { label?: string }).label ? { ...p, label: "S" } : p,
      );
    }
    return routePoints;
  }, [previewRoutePointsByVehicle, previewPoints, routePoints]);

  const isPreviewMode =
    (!!previewPoints && previewPoints.length > 0) ||
    (!!previewRoutePointsByVehicle && previewRoutePointsByVehicle.some((r) => r.length > 0));

  const geojsonOverlay: GeoJSONFeatureCollection | null = useMemo(() => {
    const source = cachedMatchedRoute ?? matchedRoute;
    if (!source || source.matchedGeometry.length < 2) return null;
    return matchedRouteToGeoJSON(source);
  }, [cachedMatchedRoute, matchedRoute]);

  // When My Places panel closes after opening a preview, bring map to the track/point
  useEffect(() => {
    if (myPlacesPanelVisible) {
      myPlacesWasVisibleRef.current = true;
      return;
    }
    if (!myPlacesWasVisibleRef.current) return;
    myPlacesWasVisibleRef.current = false;
    const pointCount = previewPoints?.length ?? 0;
    const hasMultiVehicleTrack =
      (previewRoutePointsByVehicle?.some((r) => (r?.length ?? 0) >= 2) ?? false);
    const t = setTimeout(() => {
      if (pointCount >= 2 || hasMultiVehicleTrack) {
        mapRef.current?.fitToRoute?.();
      } else if (pointCount === 1 && previewPoints?.[0]) {
        mapRef.current?.centerOnPoint?.(previewPoints[0].lat, previewPoints[0].lon);
      }
    }, Platform.OS === "web" ? 200 : 150);
    return () => clearTimeout(t);
  }, [myPlacesPanelVisible, previewPoints, previewRoutePointsByVehicle]);

  // Refresh route from storage when tab gains focus so optimized route from Planner is visible
  useFocusEffect(
    useCallback(() => {
      actions.loadRoute();
      actions.loadImportedPoints();
      if (Platform.OS !== "web") {
        getDownloadedRegions().then((r) => setHasOfflineRegions(r.length > 0));
      }
      return () => {
        dispatch({ type: "SET_PREVIEW_ROUTE", payload: null });
        dispatch({ type: "SET_PREVIEW_ROUTES", payload: null });
        actions.setCachedMatchedRoute(null);
        actions.setTapDestination(null);
      };
    }, [dispatch, actions]),
  );

  // When map has no route but routing context has GPX, hydrate so user can navigate
  useEffect(() => {
    if (routePoints.length > 0 || !state?.gpxData) return;
    let cancelled = false;
    (async () => {
      try {
        const parsed = await parseGPXForNavigation(state.gpxData as string);
        if (cancelled || parsed.points.length < 2) return;
        const points = parsed.points.map((p) => ({ lat: p.lat, lon: p.lon }));
        actions.setRoutePoints(points);
        const forMarkers = downsampleForMarkers(
          parsed.points,
          MAX_ROUTE_MARKERS,
        );
        const asCollection: CollectionPoint[] = forMarkers.map((p, i) => ({
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

  // Course mode: watch location heading so map rotates to direction of movement
  useEffect(() => {
    if (
      Platform.OS === "web" ||
      mapOrientation !== "course" ||
      navigationMode
    ) {
      actions.setUserBearing(null);
      return;
    }
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 5,
            timeInterval: 1000,
          },
          (loc) => {
            const h = loc.coords?.heading;
            if (h != null && !Number.isNaN(h) && h >= 0 && h < 360)
              actions.setUserBearing(h);
          },
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      sub?.remove?.();
      actions.setUserBearing(null);
    };
  }, [mapOrientation, navigationMode, actions]);

  // Invalidate cached match when route changes
  useEffect(() => {
    if (fixToRoadsJustRan.current) {
      fixToRoadsJustRan.current = false;
      return;
    }
    actions.setCachedMatchedRoute(null);
  }, [previewPoints?.length, previewRoutePointsByVehicle?.length, routePoints.length, actions]);

  const handlePointPress = useCallback(
    (point: CollectionPoint) => {
      hapticImpact();
      actions.setSelectedPoint(point);
      actions.setMapCenter({ lat: point.latitude, lon: point.longitude });
    },
    [actions],
  );

  const setTapDestinationFallback = useCallback(
    (lat: number, lon: number) => {
      actions.setTapDestination({ lat, lon });
      setPlaceInfoSheetVisible(true);
    },
    [actions],
  );
  const handleMapPress = useOSMMapPress(setTapDestinationFallback);

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
        "Import or preview a GPX route with at least 2 points first.",
      );
      return;
    }
    actions.setNavLoading(true);
    try {
      let matched: MatchedRoute | null = null;
      const routingConfig = await getRoutingConfigAsync();
      if (routingConfig.baseUrl) {
        matched = await matchGPXToRoads(
          points,
          routingConfig,
          getRouteOptionsForRouting(),
        );
      }
      if (!matched) {
        const asRoutePoints = points.map((p) => ({ latitude: p.lat, longitude: p.lon }));
        const hierholzerResult = buildMatchedRouteFromHierholzer(asRoutePoints);
        matched = hierholzerResult;
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

  const handleContainerLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      if (w > 0 && h > 0) actions.setDimensions({ width: w, height: h });
    },
    [actions],
  );

  useEffect(() => {
    const t = setTimeout(
      () => {
        const current = useMapStateStore.getState().dimensions;
        if (current != null && current.width > 0 && current.height > 0) return;
        const { width: w, height: h } = Dimensions.get("window");
        actions.setDimensions({
          width: Math.max(w, 320),
          height: Math.max(h, 400),
        });
      },
      Platform.OS === "web" ? 100 : 400,
    );
    return () => clearTimeout(t);
  }, [actions]);

  useEffect(() => {
    if (!mapLoading) return;
    const t = setTimeout(() => actions.setMapLoading(false), 10000);
    return () => clearTimeout(t);
  }, [mapLoading, actions]);

  const rawWidth = dimensions?.width ?? Dimensions.get("window").width;
  const rawHeight = dimensions?.height ?? 400;
  const width = Math.max(1, rawWidth);
  const height = Math.max(1, rawHeight);

  const canStartNavigation =
    (previewPoints?.length ?? 0) >= 2 ||
    (displayRoutePoints?.length ?? 0) >= 2 ||
    (previewRoutePointsByVehicle?.some((r) => r.length >= 2) ?? false) ||
    !!state?.gpxData;

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
        "Load a route or GPX preview with at least 2 points first.",
      );
      return;
    }
    actions.setFixToRoadsLoading(true);
    try {
      let matched: MatchedRoute | null = null;
      const routingConfig = await getRoutingConfigAsync();
      if (routingConfig.baseUrl) {
        matched = await routeThroughWaypoints(
          points,
          routingConfig,
          getRouteOptionsForRouting(),
        );
      }
      if (!matched) {
        const asRoutePoints = points.map((p) => ({ latitude: p.lat, longitude: p.lon }));
        matched = buildMatchedRouteFromHierholzer(asRoutePoints);
      }
      actions.setCachedMatchedRoute(matched);
      fixToRoadsJustRan.current = true;
      dispatch({
        type: "SET_PREVIEW_ROUTE",
        payload: matched.matchedGeometry.map((p) => ({
          lat: p.lat,
          lon: p.lon,
        })),
      });
      Alert.alert(
        "Fix to roads",
        "Route snapped to roads. You can start navigation when ready.",
      );
    } catch (e) {
      console.warn("Fix to roads failed:", e);
      Alert.alert("Fix to roads", "Could not snap route to roads. Try again.");
    } finally {
      actions.setFixToRoadsLoading(false);
    }
  }, [previewPoints, displayRoutePoints, state?.gpxData, actions, dispatch]);

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
        // Recalculate = new driving route from current position through remaining path (follows roads, no straight line).
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
          newMatch = await routeThroughWaypoints(
            waypoints,
            routingConfig,
            getRouteOptionsForRouting(),
          );
        }
        if (newMatch) {
          console.log("[Recalculate] OK: route pts=" + newMatch.matchedGeometry.length + ", dist=" + (newMatch.totalDistance | 0) + "m");
        } else {
          console.log("[Recalculate] Fallback: using Hierholzer-based offline route");
          const asRoutePoints = points.map((p) => ({ latitude: p.lat, longitude: p.lon }));
          newMatch = buildMatchedRouteFromHierholzer(asRoutePoints);
        }
        actions.setMatchedRoute(newMatch);
      } finally {
        actions.setNavLoading(false);
      }
    },
    [matchedRoute, actions],
  );

  const getStartForDirections = useCallback((): Promise<{
    lat: number;
    lon: number;
  } | null> => {
    // Priority 1: Use loaded route's first point
    if (displayRoutePoints?.length) {
      const first = displayRoutePoints[0];
      const lat =
        "lat" in first ? first.lat : (first as { latitude: number }).latitude;
      const lon =
        "lon" in first ? first.lon : (first as { longitude: number }).longitude;
      return Promise.resolve({ lat, lon });
    }
    // Priority 2: Use already-tracked recorder position (instant, no GPS call needed)
    if (recorder.currentPosition) {
      return Promise.resolve({
        lat: recorder.currentPosition.lat,
        lon: recorder.currentPosition.lon,
      });
    }
    // Priority 3: Web geolocation API
    if (
      Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      navigator.geolocation
    ) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
        );
      });
    }
    // Priority 4: Native expo-location
    return (async () => {
      try {
        const Loc = await import("expo-location");
        const { status } = await Loc.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          console.warn("Location permission not granted:", status);
          return null;
        }
        // Try last known position first (instant if available)
        const lastKnown = await Loc.getLastKnownPositionAsync?.();
        if (lastKnown) {
          return { lat: lastKnown.coords.latitude, lon: lastKnown.coords.longitude };
        }
        // Fall back to current position with timeout
        const getPos = (
          Loc as {
            getCurrentPositionAsync?: (
              opts: object,
            ) => Promise<{ coords: { latitude: number; longitude: number } }>;
          }
        ).getCurrentPositionAsync;
        if (!getPos) return null;
        const pos = await getPos({
          accuracy: Loc.Accuracy?.Balanced ?? 3,
          timeInterval: 5000,
          mayShowUserSettingsDialog: false,
        });
        return { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch (e) {
        console.warn("getStartForDirections location error:", e);
        return null;
      }
    })();
  }, [displayRoutePoints, recorder.currentPosition]);

  const handleDirectionsHere = useCallback(async () => {
    if (!tapDestination) return;
    hapticImpact();
    actions.setDirectionsLoading(true);
    try {
      const from = await getStartForDirections();
      if (!from) {
        Alert.alert(
          "Directions",
          "Allow location access or load a route so we can route from your position or the route start.",
        );
        return;
      }
      let matched: MatchedRoute | null = null;
      const routingConfig = await getRoutingConfigAsync();
      if (routingConfig.baseUrl) {
        matched = await routeBetweenPoints(
          from,
          tapDestination,
          routingConfig,
          getRouteOptionsForRouting(),
        );
      }
      if (!matched) {
        matched = buildMatchedRouteFromHierholzer([
          { latitude: from.lat, longitude: from.lon },
          { latitude: tapDestination.lat, longitude: tapDestination.lon },
        ]);
      }
      dispatch({
        type: "SET_PREVIEW_ROUTE",
        payload: matched.matchedGeometry.map((p) => ({
          lat: p.lat,
          lon: p.lon,
        })),
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

  // ---------------------------------------------------------------------------
  // Collection Route Navigation — in-app navigator with segment tracking,
  // right-arm awareness, colored polylines, GPS auto-advance.
  // ---------------------------------------------------------------------------
  const startCollectionNavigation = useCallback(() => {
    let points: Array<{ lat: number; lon: number }> = [];
    if ((previewPoints?.length ?? 0) >= 2) {
      points = previewPoints!.map((p) => ({ lat: p.lat, lon: p.lon }));
    } else if ((displayRoutePoints?.length ?? 0) >= 2) {
      points = displayRoutePoints!;
    }
    if (points.length < 2) {
      Alert.alert(
        "No collection route",
        "Load or preview a route with at least 2 points first.",
      );
      return;
    }
    setCollectionNavMode(true);
  }, [previewPoints, displayRoutePoints]);

  // ---------------------------------------------------------------------------
  // Normal Navigation — deep link to Google Maps / Apple Maps / Waze.
  // For point-to-point trips: depot to route start, last stop to depot, etc.
  // ---------------------------------------------------------------------------
  const startExternalNavigation = useCallback(async () => {
    const dest = tapDestination || (selectedPoint ? {
      lat: selectedPoint.latitude,
      lon: selectedPoint.longitude,
    } : null);

    if (!dest) {
      Alert.alert(
        "No destination",
        "Tap a location on the map or select a point first.",
      );
      return;
    }

    const destination: NormalNavDestination = {
      lat: dest.lat,
      lon: dest.lon,
      label: selectedPoint?.address ?? undefined,
      address: selectedPoint?.address ?? undefined,
      purpose: "custom",
    };

    try {
      await navigateExternally(destination);
    } catch (err) {
      console.warn("[MapContent] External navigation failed:", err);
      Alert.alert(
        "Navigation Error",
        "Could not open external navigation app. Please try again.",
      );
    }
  }, [tapDestination, selectedPoint]);

  const handleMapLoad = useCallback(() => {
    console.log("[MapContent] Map loaded successfully");
    actions.setMapLoading(false);
    actions.setMapError(null);
  }, [actions]);

  const handleMapError = useCallback(
    (error: string) => {
      console.error("[MapContent] Map error:", error);
      actions.setMapLoading(false);
      actions.setMapError(error);
    },
    [actions],
  );

  const handleDownloadGPX = useCallback(() => {
    const byVehicle = state?.previewRoutePointsByVehicle;
    if (byVehicle && byVehicle.length > 1) {
      const routes = byVehicle
        .filter((r) => r.length >= 2)
        .map((r, i) => ({
          name: `Vehicle ${i + 1}`,
          points: r.map((p) => ({ lat: p.lat, lon: p.lon })),
        }));
      if (routes.length === 0) {
        Alert.alert("No route", "No vehicle route with at least 2 points.");
        return;
      }
      const gpxStr = generateMultiTrackGPXString("trashroute_vrp_export", routes);
      if (Platform.OS === "web") {
        const blob = new Blob([gpxStr], { type: "application/gpx+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `trashroute_vrp_${new Date().toISOString().slice(0, 10)}.gpx`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        (async () => {
          try {
            const FileSystem = await import("expo-file-system/legacy");
            const Sharing = await import("expo-sharing");
            const filename = `trashroute_vrp_${new Date().toISOString().slice(0, 10)}.gpx`;
            const path = `${FileSystem.documentDirectory}${filename}`;
            await FileSystem.writeAsStringAsync(path, gpxStr);
            await Sharing.shareAsync(path, {
              mimeType: "application/gpx+xml",
              dialogTitle: "Export GPX",
            });
          } catch (err) {
            console.error("GPX export failed:", err);
            Alert.alert("Export Failed", "Could not export the GPX file.");
          }
        })();
      }
      return;
    }
    let points: Array<{ lat: number; lon: number }> = [];
    if (displayRoutePoints?.length) {
      points = displayRoutePoints.map((p) => ({
        lat: "lat" in p ? p.lat : (p as { latitude: number }).latitude,
        lon: "lon" in p ? p.lon : (p as { longitude: number }).longitude,
      }));
    }
    if (points.length < 2) {
      Alert.alert("No route", "Load a route with at least 2 points first.");
      return;
    }
    const gpxStr = generateGPXString("trashroute_export", points);
    if (Platform.OS === "web") {
      const blob = new Blob([gpxStr], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trashroute_${new Date().toISOString().slice(0, 10)}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      (async () => {
        try {
          const FileSystem = await import("expo-file-system/legacy");
          const Sharing = await import("expo-sharing");
          const filename = `trashroute_${new Date().toISOString().slice(0, 10)}.gpx`;
          const path = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(path, gpxStr);
          await Sharing.shareAsync(path, {
            mimeType: "application/gpx+xml",
            dialogTitle: "Export GPX",
          });
        } catch (err) {
          console.error("GPX export failed:", err);
          Alert.alert("Export Failed", "Could not export the GPX file.");
        }
      })();
    }
  }, [displayRoutePoints, state?.previewRoutePointsByVehicle]);

  const handleZoomIn = useCallback(() => mapRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => mapRef.current?.zoomOut(), []);
  const handleCompass = useCallback(() => mapRef.current?.resetNorth(), []);

  const handleDrivePreview = useCallback(() => {
    if ((displayRoutePoints?.length ?? 0) >= 2) {
      mapRef.current?.fitToRoute?.();
      setDrivePreviewVisible(true);
    }
  }, [displayRoutePoints]);

  const handleOpenInGoogle = useCallback(async () => {
    // Calculate center and waypoints from route data
    let center: { lat: number; lon: number } | undefined;
    let waypoints: Array<{ lat: number; lon: number }> | undefined;

    // Use displayRoutePoints which includes the actual route being shown
    if (displayRoutePoints && displayRoutePoints.length > 0) {
      // Center on route start, include route points as waypoints (sample them if too many)
      center = { lat: displayRoutePoints[0].lat, lon: displayRoutePoints[0].lon };

      // Sample waypoints if route is very long (Google Maps deep links have limits)
      if (displayRoutePoints.length > 20) {
        const step = Math.floor(displayRoutePoints.length / 15); // ~15 waypoints max
        waypoints = displayRoutePoints
          .filter((_, i) => i % step === 0 || i === displayRoutePoints.length - 1)
          .map((p) => ({ lat: p.lat, lon: p.lon }));
      } else {
        waypoints = displayRoutePoints.map((p) => ({ lat: p.lat, lon: p.lon }));
      }
    } else if (collectionPoints && collectionPoints.length > 0) {
      // Center on first collection point, use collection points as waypoints
      center = { lat: collectionPoints[0].latitude, lon: collectionPoints[0].longitude };

      if (collectionPoints.length > 15) {
        const step = Math.floor(collectionPoints.length / 15);
        waypoints = collectionPoints
          .filter((_, i) => i % step === 0 || i === collectionPoints.length - 1)
          .map((p) => ({ lat: p.latitude, lon: p.longitude }));
      } else {
        waypoints = collectionPoints.map((p) => ({ lat: p.latitude, lon: p.longitude }));
      }
    } else if (tapDestination) {
      // Use tapped location as center
      center = { lat: tapDestination.lat, lon: tapDestination.lon };
    }

    console.log("[OpenInGoogle] Center:", center, "Waypoints count:", waypoints?.length);
    await openGoogleMapsViewer({ center, waypoints });
  }, [displayRoutePoints, collectionPoints, tapDestination]);

  const handleStreetView = useCallback(() => {
    const coords = tapDestination
      ? { lat: tapDestination.lat, lon: tapDestination.lon }
      : selectedPoint
        ? { lat: selectedPoint.latitude, lon: selectedPoint.longitude }
        : null;
    if (coords) {
      actions.setMapillaryCoords(coords);
      actions.setMapillaryViewerVisible(true);
    }
  }, [tapDestination, selectedPoint, actions]);

  const handleContributeImages = useCallback(() => {
    openMapillaryCapture();
  }, []);

  const handleMapLongPress = useCallback(
    (lat: number, lon: number) => {
      hapticImpact();
      const name = `Saved (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
      const onSave = () => {
        addFavorite({ name, lat, lon });
        addMarker({ name, lat, lon });
      };
      if (Platform.OS === "web") {
        if (
          typeof window !== "undefined" &&
          window.confirm("Save this location to Favorites?")
        )
          onSave();
      } else {
        Alert.alert(
          "Save to Favorites",
          "Add this location to your favorites and map markers?",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Save", onPress: onSave },
          ],
        );
      }
    },
    [addFavorite, addMarker],
  );

  // key used to force a full remount of the RouteMap component.  This
  // is defensive; the native map has historically crashed when its child
  // subviews change very rapidly (see iOS stack trace involving
  // -[AIRMap insertReactSubview:atIndex:]).  Incrementing the key ensures we
  // completely wipe the old map before rendering with the cleared state.
  const [mapKey, setMapKey] = useState(0);

  const handleClearRouteMarkers = useCallback(async () => {
    // Bump the key FIRST so the old native MapView unmounts before its
    // children change.  Previously the key was bumped in `finally` (after
    // clearRouteData), which caused an intermediate render where the
    // existing MapView tried to reconcile removed children and crashed
    // with NSInvalidArgumentException in -[AIRMap insertReactSubview:atIndex:].
    setMapKey((k) => k + 1);
    try {
      dispatch({ type: "SET_PREVIEW_ROUTE", payload: null });
      dispatch({ type: "SET_PREVIEW_ROUTES", payload: null });
      dispatch({ type: "SET_GPX_DATA", payload: "" });
      await actions.clearRouteData();
    } catch (e) {
      console.warn("Clear route markers failed:", e);
    }
  }, [dispatch, actions]);

  const mapContent = (
    <>
      {mapLoading && (
        <View style={[styles.mapPlaceholder, { width, height }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.mapPlaceholderText, { marginTop: 16 }]}>
            Loading map...
          </Text>
        </View>
      )}
      {mapError && (
        <View style={[styles.mapPlaceholder, { width, height }]}>
          <Text style={styles.mapPlaceholderText}>
            Map failed to load: {mapError}
          </Text>
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: colors.primary, marginTop: 16 },
            ]}
            onPress={() => {
              actions.setMapLoading(true);
              actions.setMapError(null);
            }}
          >
            <Text style={styles.actionButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      <RouteMap
        key={mapKey}
        ref={mapRef}
        collectionPoints={isPreviewMode ? [] : collectionPoints}
        routePoints={
          isRecActive
            ? recorder.points.map((p) => ({ lat: p.lat, lon: p.lon }))
            : sanitizeLatLonArray(
                previewRoutePointsByVehicle && previewRoutePointsByVehicle.length === 1
                  ? previewRoutePointsByVehicle[0]
                  : previewRoutePointsByVehicle && previewRoutePointsByVehicle.length > 1
                    ? undefined
                    : displayRoutePoints,
              )
        }
        routePointsByVehicle={
          previewRoutePointsByVehicle && previewRoutePointsByVehicle.length > 1
            ? sanitizeByVehicle(previewRoutePointsByVehicle)
            : undefined
        }
        segmentRisks={state.weatherAnalysis?.segmentRisks}
        height={height}
        width={width}
        onPointClick={handlePointPress}
        onMapPress={handleMapPress}
        onMapLongPress={handleMapLongPress}
        tapDestination={osmExtractorVisible ? null : tapDestination}
        onLoad={handleMapLoad}
        onError={handleMapError}
        hasOfflineRegions={hasOfflineRegions}
        userBearing={isRecActive ? (recorder.currentHeading ?? userBearing) : userBearing}
        showAerial={showAerial}
        showTraffic={showTraffic}
        showOverture={showOverture}
        osmExtractionPolygon={
          osmExtractionPoints.length >= 3 ? osmExtractionPoints : undefined
        }
        osmExtractionPoints={osmExtractionPoints}
        osmExtractedFeatures={osmExtractedData?.features}
        osmExtractorVisible={osmExtractorVisible}
        geojsonOverlay={geojsonOverlay}
      />
    </>
  );

  if (!dimensions) {
    return (
      <View style={styles.container} onLayout={handleContainerLayout}>
        <View style={[styles.mapPlaceholder, { flex: 1 }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (navigationMode && matchedRoute) {
    return (
      <View style={styles.container}>
        <NavigationView
          matchedRoute={matchedRoute}
          fullRoutePoints={
            displayRoutePoints?.length ? displayRoutePoints : undefined
          }
          onClose={() => {
            actions.setNavigationMode(false);
            actions.setMatchedRoute(null);
          }}
          onRecalculate={handleRecalculate}
          autoRecalculateOnOffRoute={!roadClosureHandlingOn}
          offRouteThresholdMeters={recalcDistanceMeters}
        />
      </View>
    );
  }

  if (collectionNavMode) {
    const collRoutePoints =
      (previewPoints?.length ?? 0) >= 2
        ? previewPoints!.map((p) => ({ lat: p.lat, lon: p.lon }))
        : (displayRoutePoints?.length ?? 0) >= 2
          ? displayRoutePoints!
          : [];

    return (
      <View style={styles.container}>
        <CollectionNavigator
          routePoints={collRoutePoints}
          collectionPoints={collectionPoints}
          onClose={() => {
            setCollectionNavMode(false);
            collectionNavReset();
          }}
        />
      </View>
    );
  }

  const pinnedOffset =
    isPinned && deviceType === "ipad" ? SIDEBAR_WIDTH_IPAD : 0;
  const mapWrapperStyle =
    Platform.OS === "ios" && dimensions
      ? [
          StyleSheet.absoluteFill,
          styles.mapWrapper,
          {
            width: dimensions.width - pinnedOffset,
            height: dimensions.height,
            left: pinnedOffset,
          },
        ]
      : [
          StyleSheet.absoluteFill,
          styles.mapWrapper,
          ...(pinnedOffset > 0 ? [{ left: pinnedOffset, right: 0 }] : []),
        ];

  const hasActiveRoute =
    canStartNavigation ||
    (displayRoutePoints?.length ?? 0) > 0 ||
    !!tapDestination;
  const hasSelectedLocation = !!(tapDestination || selectedPoint);

  return (
    <View style={styles.container} onLayout={handleContainerLayout}>
      <View style={mapWrapperStyle}>{mapContent}</View>

      <HelpPrompt />

      {/* GPS Recording controls — compact overlay */}
      <RecordingOverlay
        recorder={recorder}
        isRecording={isRecording}
        isPaused={isPaused}
        isRecActive={isRecActive}
        recFlashAnim={recFlashAnim}
        colors={colors}
        insets={insets}
        savingTrack={savingTrack}
        onStart={handleRecStart}
        onPause={recPause}
        onResume={recResume}
        onStop={handleRecStop}
        onDiscard={handleRecDiscard}
        onOptions={() => setRecOptionsVisible(true)}
        savedTracks={savedTracks}
        savedTracksExpanded={savedTracksExpanded}
        onToggleSavedTracks={() => setSavedTracksExpanded((e) => !e)}
        onTrackPreview={handleTrackPreview}
        onTrackExport={handleTrackExport}
        onTrackDelete={handleTrackDelete}
      />

      <RecOptionsModal
        visible={recOptionsVisible}
        onClose={() => setRecOptionsVisible(false)}
      />

      {Platform.OS !== "web" && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              top: insets.top + 8,
              left: 12,
              right: undefined,
              bottom: undefined,
              width: undefined,
              alignSelf: "flex-start",
            },
          ]}
          pointerEvents="box-none"
        >
          <PowerSavingIndicator compact />
        </View>
      )}

      <MapFloatingControls
        hasActiveRoute={hasActiveRoute}
        hasTapDestination={!osmExtractorVisible && !!tapDestination}
        hasSelectedLocation={!osmExtractorVisible && hasSelectedLocation}
        canStartNavigation={canStartNavigation}
        onSearch={openNavigationPanel}
        onDirectionsHere={handleDirectionsHere}
        onStreetView={handleStreetView}
        onContributeImages={handleContributeImages}
        onStartNavigation={startNavigation}
        onStartCollectionRoute={canStartNavigation ? startCollectionNavigation : undefined}
        onNavigateExternal={startExternalNavigation}
        onFixToRoads={handleFixToRoads}
        onClearRoute={canStartNavigation ? handleClearRouteMarkers : undefined}
        onDownloadGPX={handleDownloadGPX}
        onDrivePreview={handleDrivePreview}
        onOpenInGoogle={handleOpenInGoogle}
        directionsLoading={directionsLoading}
        navLoading={navLoading}
        fixToRoadsLoading={fixToRoadsLoading}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onCompass={handleCompass}
      />

      <MapSidebar />

      <NavigationPanel
        visible={navigationPanelVisible}
        onClose={closeNavigationPanel}
        tapDestination={tapDestination}
      />
      {tapDestination && (
        <PlaceInfoSheet
          visible={placeInfoSheetVisible}
          onClose={() => setPlaceInfoSheetVisible(false)}
          lat={tapDestination.lat}
          lon={tapDestination.lon}
          onDirectionsHere={handleDirectionsHere}
          onSaveToFavorites={(name, lat, lon) => addFavorite({ name, lat, lon })}
          onClear={() => {
            actions.setTapDestination(null);
            setPlaceInfoSheetVisible(false);
          }}
        />
      )}
      <MyPlacesScreen
        visible={myPlacesPanelVisible}
        onClose={closeMyPlacesPanel}
      />
      <MapsAndResourcesScreen
        visible={mapsResourcesVisible}
        onClose={closeMapsResources}
      />
      <ConfigureScreenSheet
        visible={configureScreenVisible}
        onClose={closeConfigureScreen}
      />
      <RouteParametersSheet
        visible={routeParametersPanelVisible}
        onClose={closeRouteParametersPanel}
      />
      <MapStyleSheet
        visible={mapStylePickerVisible}
        onClose={closeMapStylePicker}
      />

      <MapMarkersScreen
        visible={mapMarkersPanelVisible}
        onClose={closeMapMarkersPanel}
        collectionPoints={collectionPoints}
        displayRoutePoints={displayRoutePoints}
        onClearRouteMarkers={handleClearRouteMarkers}
      />

      <MapillaryViewer
        latitude={mapillaryCoords?.lat ?? 0}
        longitude={mapillaryCoords?.lon ?? 0}
        isVisible={mapillaryViewerVisible}
        onClose={() => {
          actions.setMapillaryViewerVisible(false);
          actions.setMapillaryCoords(null);
        }}
      />

      {Platform.OS !== "web" && displayRoutePoints && displayRoutePoints.length >= 2 && (
        <StreetViewPreview
          points={displayRoutePoints.map((p) => ({ lat: p.lat, lon: p.lon }))}
          isVisible={drivePreviewVisible}
          onClose={() => setDrivePreviewVisible(false)}
          trackName="Route Preview"
        />
      )}

    </View>
  );
}

// ---------------------------------------------------------------------------
// Recording overlay sub-component — shown on Map tab
// ---------------------------------------------------------------------------
function RecordingOverlay({
  recorder,
  isRecording,
  isPaused,
  isRecActive,
  recFlashAnim,
  colors,
  insets,
  savingTrack,
  onStart,
  onPause,
  onResume,
  onStop,
  onDiscard,
  onOptions,
  savedTracks,
  savedTracksExpanded,
  onToggleSavedTracks,
  onTrackPreview,
  onTrackExport,
  onTrackDelete,
}: {
  recorder: ReturnType<typeof import("@/hooks/useTrackRecorder").useTrackRecorder>["state"];
  isRecording: boolean;
  isPaused: boolean;
  isRecActive: boolean;
  recFlashAnim: Animated.Value;
  colors: ReturnType<typeof import("@/hooks/use-colors").useColors>;
  insets: { top: number; bottom: number };
  savingTrack: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onOptions: () => void;
  savedTracks: SavedTrack[];
  savedTracksExpanded: boolean;
  onToggleSavedTracks: () => void;
  onTrackPreview: (t: SavedTrack) => void;
  onTrackExport: (t: SavedTrack) => void;
  onTrackDelete: (t: SavedTrack) => void;
}) {
  return (
    <>
      {/* REC badge — top-right, only visible when recording */}
      {isRecActive && (
        <TouchableOpacity
          style={[
            recStyles.recBadge,
            {
              backgroundColor: colors.surface + "ee",
              borderColor: "#E53935",
              top: insets.top + 8,
              right: 12,
            },
          ]}
          onPress={onOptions}
          activeOpacity={0.8}
        >
          {isRecording ? (
            <Animated.View style={[recStyles.recDot, { opacity: recFlashAnim }]}>
              <View style={recStyles.recDotInner} />
            </Animated.View>
          ) : (
            <View style={[recStyles.recDot, { backgroundColor: "#ff9800" }]}>
              <MaterialCommunityIcons name="pause" size={10} color="#fff" />
            </View>
          )}
          <Text style={[recStyles.recBadgeText, { color: colors.text }]}>
            {isRecording ? "REC" : "PAUSED"}
          </Text>
          <Text style={[recStyles.recTime, { color: colors.muted, fontFamily: Fonts?.mono }]}>
            {formatRecElapsed(recorder.elapsedMs)}
          </Text>
        </TouchableOpacity>
      )}

      {/* Active recording stats + controls bar — bottom of screen */}
      {isRecActive && (
        <View
          style={[
            recStyles.recBar,
            glassStyle,
            { backgroundColor: colors.surface + "f0", borderColor: colors.border },
          ]}
        >
          {/* Stats row */}
          <View style={recStyles.recStatsRow}>
            <RecStat icon="clock-outline" value={formatRecElapsed(recorder.elapsedMs)} label="Time" colors={colors} />
            <RecStat icon="map-marker-distance" value={formatRecDistance(recorder.totalDistanceMeters)} label="Dist" colors={colors} />
            <RecStat icon="map-marker-multiple" value={String(recorder.points.length)} label="Pts" colors={colors} />
            {recorder.currentPosition?.speed != null && recorder.currentPosition.speed > 0 && (
              <RecStat icon="speedometer" value={`${(recorder.currentPosition.speed * 3.6).toFixed(0)}`} label="km/h" colors={colors} />
            )}
          </View>

          {/* Controls row */}
          <View style={recStyles.recControlsRow}>
            {isRecording && (
              <>
                <TouchableOpacity style={[recStyles.recBtn, { backgroundColor: "#ff9800" }]} onPress={onPause}>
                  <MaterialCommunityIcons name="pause" size={18} color="#fff" />
                  <Text style={recStyles.recBtnText}>Pause</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[recStyles.recBtn, { backgroundColor: colors.primary }]} onPress={onStop}>
                  <MaterialCommunityIcons name="stop" size={18} color="#fff" />
                  <Text style={recStyles.recBtnText}>Stop</Text>
                </TouchableOpacity>
              </>
            )}
            {isPaused && (
              <>
                <TouchableOpacity style={[recStyles.recBtn, { backgroundColor: "#22c55e" }]} onPress={onResume}>
                  <MaterialCommunityIcons name="play" size={18} color="#fff" />
                  <Text style={recStyles.recBtnText}>Resume</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[recStyles.recBtn, { backgroundColor: colors.primary }]} onPress={onStop}>
                  <MaterialCommunityIcons name="stop" size={18} color="#fff" />
                  <Text style={recStyles.recBtnText}>Stop</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[recStyles.recBtn, { backgroundColor: colors.muted + "88" }]} onPress={onDiscard}>
                  <MaterialCommunityIcons name="delete-outline" size={18} color="#fff" />
                  <Text style={recStyles.recBtnText}>Discard</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          {savingTrack && (
            <View style={recStyles.savingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ color: colors.muted, marginLeft: 6, fontSize: 12 }}>Saving...</Text>
            </View>
          )}
        </View>
      )}

      {/* Saved tracks expandable list (web only, when not recording) */}
      {Platform.OS === "web" && !isRecActive && savedTracks.length > 0 && (
        <View
          style={[
            recStyles.savedPanel,
            {
              backgroundColor: colors.surface + "f0",
              borderColor: colors.border,
              bottom: 16,
              left: 12,
            },
          ]}
        >
          <TouchableOpacity style={recStyles.savedHeader} onPress={onToggleSavedTracks}>
            <MaterialCommunityIcons name="history" size={16} color={colors.muted} />
            <Text style={[recStyles.savedHeaderText, { color: colors.text }]}>
              Saved Tracks ({savedTracks.length})
            </Text>
            <MaterialCommunityIcons
              name={savedTracksExpanded ? "chevron-down" : "chevron-up"}
              size={18}
              color={colors.muted}
            />
          </TouchableOpacity>
          {savedTracksExpanded && (
            <FlatList
              data={savedTracks}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 200 }}
              renderItem={({ item }) => (
                <View style={[recStyles.savedItem, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[recStyles.savedName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[recStyles.savedMeta, { color: colors.muted }]}>
                      {formatRecDistance(item.totalDistanceMeters)} · {formatRecElapsed(item.elapsedMs)} · {item.pointCount} pts
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => onTrackPreview(item)} style={recStyles.savedAction}>
                    <MaterialCommunityIcons name="eye-outline" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onTrackExport(item)} style={recStyles.savedAction}>
                    <MaterialCommunityIcons name="export-variant" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onTrackDelete(item)} style={recStyles.savedAction}>
                    <MaterialCommunityIcons name="delete-outline" size={16} color={colors.error ?? "#ef4444"} />
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      )}
    </>
  );
}

function RecStat({ icon, value, label, colors }: {
  icon: string; value: string; label: string;
  colors: ReturnType<typeof import("@/hooks/use-colors").useColors>;
}) {
  return (
    <View style={recStyles.recStatItem}>
      <MaterialCommunityIcons name={icon as any} size={14} color={colors.muted} />
      <Text style={[recStyles.recStatValue, { color: colors.text, fontFamily: Fonts?.mono }]}>{value}</Text>
      <Text style={[recStyles.recStatLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

function formatRecElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatRecDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

const recStyles = StyleSheet.create({
  recBadge: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    zIndex: 20,
  },
  recDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
  },
  recDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "white",
  },
  recBadgeText: { fontSize: 12, fontWeight: "700" },
  recTime: { fontSize: 11 },

  recBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    zIndex: 20,
  },
  recStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 8,
  },
  recStatItem: { alignItems: "center" },
  recStatValue: { fontSize: 14, fontWeight: "700", marginTop: 1 },
  recStatLabel: { fontSize: 9, marginTop: 1 },

  recControlsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  recBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  recBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  savingRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 6,
  },

  savedPanel: {
    position: "absolute",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    maxWidth: 340,
    minWidth: 260,
    zIndex: 20,
  },
  savedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  savedHeaderText: { fontSize: 12, fontWeight: "600", flex: 1 },
  savedItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  savedName: { fontSize: 12, fontWeight: "600" },
  savedMeta: { fontSize: 10 },
  savedAction: {
    padding: 4,
    marginLeft: 4,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapWrapper: { pointerEvents: "auto" },
  mapPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
  },
  mapPlaceholderText: {
    color: "#888",
    fontSize: 16,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  actionButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
