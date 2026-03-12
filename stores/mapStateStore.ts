/**
 * Consolidated Map State Store
 *
 * Split into focused slices using Zustand's slice pattern for optimal
 * re-render performance. Each slice manages a specific domain:
 *
 * - Route slice: route data, collection points, route points
 * - Navigation slice: navigation mode, matched routes, loading states
 * - Interaction slice: map center, selected point, tap destination, OSM extraction
 * - UI slice: map loading, errors, dimensions, display toggles
 *
 * Persistence uses Zustand's `persist` middleware consistently (no raw AsyncStorage).
 * Only settings that should survive app restarts are persisted.
 */

import { createWithEqualityFn } from "zustand/traditional";
import { persist, createJSONStorage } from "zustand/middleware";
import { useShallow } from "zustand/shallow";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CollectionPoint, Route } from "@/types";
import type { MatchedRoute } from "@/lib/mapMatching";
import type { LatLonPoint, ParsedOverpassResult } from "@/lib/overpassService";
import { asyncStorage, coordArrayEquals } from "./storeMiddleware";
import { sanitizeLatLonArray } from "@/lib/coord-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const IMPORTED_POINTS_KEY = "trashroute_imported_points";

// --- Route Slice ---
interface RouteSlice {
  route: Route | null;
  collectionPoints: CollectionPoint[];
  routePoints: Array<{ lat: number; lon: number }>;

  setRoute: (route: Route | null) => void;
  setCollectionPoints: (points: CollectionPoint[]) => void;
  setRoutePoints: (points: Array<{ lat: number; lon: number }>) => void;
  loadRoute: () => Promise<void>;
  loadImportedPoints: () => Promise<void>;
  clearRouteData: () => Promise<void>;
}

// --- Navigation Slice ---
interface NavigationSlice {
  navigationMode: boolean;
  matchedRoute: MatchedRoute | null;
  cachedMatchedRoute: MatchedRoute | null;
  navLoading: boolean;
  fixToRoadsLoading: boolean;
  directionsLoading: boolean;

  setNavigationMode: (mode: boolean) => void;
  setMatchedRoute: (route: MatchedRoute | null) => void;
  setCachedMatchedRoute: (route: MatchedRoute | null) => void;
  setNavLoading: (loading: boolean) => void;
  setFixToRoadsLoading: (loading: boolean) => void;
  setDirectionsLoading: (loading: boolean) => void;
}

// --- Interaction Slice ---
interface InteractionSlice {
  mapCenter: { lat: number; lon: number };
  selectedPoint: CollectionPoint | null;
  tapDestination: { lat: number; lon: number } | null;
  showAerial: boolean;
  userBearing: number | null;
  mapillaryViewerVisible: boolean;
  mapillaryCoords: { lat: number; lon: number } | null;
  osmExtractionPoints: LatLonPoint[];
  osmExtractedData: ParsedOverpassResult | null;

  setMapCenter: (center: { lat: number; lon: number }) => void;
  setSelectedPoint: (point: CollectionPoint | null) => void;
  setTapDestination: (destination: { lat: number; lon: number } | null) => void;
  setShowAerial: (show: boolean) => void;
  setUserBearing: (bearing: number | null) => void;
  setMapillaryViewerVisible: (visible: boolean) => void;
  setMapillaryCoords: (coords: { lat: number; lon: number } | null) => void;
  setOsmExtractionPoints: (points: LatLonPoint[]) => void;
  setOsmExtractedData: (data: ParsedOverpassResult | null) => void;
  addOsmExtractionPoint: (point: LatLonPoint) => void;
  clearOsmExtraction: () => void;
}

// --- Settings Slice (persisted) ---
interface SettingsSlice {
  roadClosureHandlingOn: boolean;
  setRoadClosureHandlingOn: (enabled: boolean) => void;
}

// --- UI Slice ---
interface UISlice {
  mapLoading: boolean;
  mapError: string | null;
  dimensions: { width: number; height: number } | null;

  setMapLoading: (loading: boolean) => void;
  setMapError: (error: string | null) => void;
  setDimensions: (dimensions: { width: number; height: number } | null) => void;
}

// --- Combined Store ---
export type MapState = RouteSlice &
  NavigationSlice &
  InteractionSlice &
  SettingsSlice &
  UISlice;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Max pins to show for a route. */
const MAX_ROUTE_MARKERS = 50;

/** Downsample to at most maxPoints: first, last, and evenly spaced in between. */
function downsampleForMarkers<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const indices: number[] = [0];
  for (let i = 1; i < maxPoints - 1; i++) {
    indices.push(Math.floor((i / (maxPoints - 1)) * (arr.length - 1)));
  }
  if (arr.length > 1) indices.push(arr.length - 1);
  return indices.map((idx) => arr[idx]);
}

// ---------------------------------------------------------------------------
// Store
//
// Uses `createWithEqualityFn` from zustand/traditional so selector hooks can
// accept an optional equality function (Zustand v5 API).
// ---------------------------------------------------------------------------

export const useMapStateStore = createWithEqualityFn<MapState>()(
  persist(
    (set, get) => ({
      // ---- Route Slice ----
      route: null,
      collectionPoints: [],
      routePoints: [],

      setRoute: (route) => set({ route }),
      setCollectionPoints: (collectionPoints) => set({ collectionPoints }),
      setRoutePoints: (routePoints) => set({ routePoints }),

      loadRoute: async () => {
        try {
          const { storage } = await import("@/lib/storage");
          const { isMockRoute } = await import("@/lib/is-mock-route");
          const { enrichRoute } = await import("@/services/InstructionManager");

          const currentRoute = await storage.loadRoute();
          if (!currentRoute || isMockRoute(currentRoute)) {
            if (currentRoute) await storage.clearRoute();
            return;
          }

          const points = currentRoute.points ?? [];
          // convert to simple lat/lon array then sanitize
          const rawPoints =
            points.length >= 2
              ? points.map((p) => ({ lat: p.latitude, lon: p.longitude }))
              : get().routePoints;
          const routePoints = sanitizeLatLonArray(rawPoints);

          const forMarkers = downsampleForMarkers(points, MAX_ROUTE_MARKERS);
          const enriched = enrichRoute(
            forMarkers.map((p) => ({
              ...p,
              address: p.address,
              lat: p.latitude,
              lon: p.longitude,
            })),
          );

          const withInstructions: CollectionPoint[] = enriched.map((e) => {
            const { instructions, ...rest } = e;
            return {
              ...rest,
              specialInstructions:
                instructions.length > 0
                  ? instructions
                      .map((i) => `${i.title}: ${i.details}`)
                      .join(" \u2022 ")
                  : (rest as CollectionPoint).specialInstructions,
            } as CollectionPoint;
          });

          const mapCenter =
            points.length > 0
              ? {
                  lat:
                    points.reduce((sum, p) => sum + p.latitude, 0) /
                    points.length,
                  lon:
                    points.reduce((sum, p) => sum + p.longitude, 0) /
                    points.length,
                }
              : get().mapCenter;

          // Batch all route-related state into a single set() call to avoid cascading re-renders
          set({
            route: currentRoute,
            collectionPoints: withInstructions,
            ...(points.length >= 2 ? { routePoints } : {}),
            mapCenter,
          });
        } catch (e) {
          console.warn("MapState: loadRoute failed", e);
        }
      },

      loadImportedPoints: async () => {
        try {
          const { isMockCollectionPoints } =
            await import("@/lib/is-mock-route");
          const { enrichRoute } = await import("@/services/InstructionManager");

          const storedPoints = await AsyncStorage.getItem(IMPORTED_POINTS_KEY);
          if (!storedPoints) return;

          let points: CollectionPoint[];
          try {
            points = JSON.parse(storedPoints) as CollectionPoint[];
          } catch {
            console.warn("Corrupt imported points data, clearing");
            await AsyncStorage.removeItem(IMPORTED_POINTS_KEY);
            return;
          }
          if (!Array.isArray(points)) return;
          if (isMockCollectionPoints(points)) {
            await AsyncStorage.removeItem(IMPORTED_POINTS_KEY);
            return;
          }
          if (points.length === 0) return;

          const routePoints =
            points.length >= 2
              ? points.map((p) => ({ lat: p.latitude, lon: p.longitude }))
              : get().routePoints;

          const forMarkers = downsampleForMarkers(points, MAX_ROUTE_MARKERS);
          const enriched = enrichRoute(
            forMarkers.map((p) => ({
              ...p,
              address: p.address,
              lat: p.latitude,
              lon: p.longitude,
            })),
          );

          const withInstructions: CollectionPoint[] = enriched.map((e) => {
            const { instructions, ...rest } = e;
            return {
              ...rest,
              specialInstructions:
                instructions.length > 0
                  ? instructions
                      .map((i) => `${i.title}: ${i.details}`)
                      .join(" \u2022 ")
                  : (rest as CollectionPoint).specialInstructions,
            } as CollectionPoint;
          });

          const avgLat =
            points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
          const avgLon =
            points.reduce((sum, p) => sum + p.longitude, 0) / points.length;

          // Batch update
          set({
            collectionPoints: withInstructions,
            ...(points.length >= 2 ? { routePoints } : {}),
            mapCenter: { lat: avgLat, lon: avgLon },
          });
        } catch (error) {
          console.error("Failed to load imported points:", error);
        }
      },

      clearRouteData: async () => {
        try {
          const { storage } = await import("@/lib/storage");
          await storage.clearRoute();
          await AsyncStorage.removeItem(IMPORTED_POINTS_KEY);

          set({
            route: null,
            collectionPoints: [],
            routePoints: [],
            matchedRoute: null,
            cachedMatchedRoute: null,
            navigationMode: false,
            // wipe any overlays or temporary state that might still be
            // rendered by RouteMap
            tapDestination: null,
            geojsonOverlay: null,
            osmExtractionPoints: [],
            osmExtractedData: null,
            weatherAnalysis: null,
            aiRouteAnalysis: null,
          });
        } catch (e) {
          console.warn("Clear route data failed:", e);
        }
      },

      // ---- Navigation Slice ----
      navigationMode: false,
      matchedRoute: null,
      cachedMatchedRoute: null,
      navLoading: false,
      fixToRoadsLoading: false,
      directionsLoading: false,

      setNavigationMode: (navigationMode) => set({ navigationMode }),
      setMatchedRoute: (matchedRoute) => set({ matchedRoute }),
      setCachedMatchedRoute: (cachedMatchedRoute) =>
        set({ cachedMatchedRoute }),
      setNavLoading: (navLoading) => set({ navLoading }),
      setFixToRoadsLoading: (fixToRoadsLoading) => set({ fixToRoadsLoading }),
      setDirectionsLoading: (directionsLoading) => set({ directionsLoading }),

      // ---- Interaction Slice ----
      mapCenter: { lat: 40.7128, lon: -74.006 },
      selectedPoint: null,
      tapDestination: null,
      showAerial: false,
      userBearing: null,
      mapillaryViewerVisible: false,
      mapillaryCoords: null,
      osmExtractionPoints: [],
      osmExtractedData: null,

      setMapCenter: (mapCenter) => set({ mapCenter }),
      setSelectedPoint: (selectedPoint) => set({ selectedPoint }),
      setTapDestination: (tapDestination) => set({ tapDestination }),
      setShowAerial: (showAerial) => set({ showAerial }),
      setUserBearing: (userBearing) => set({ userBearing }),
      setMapillaryViewerVisible: (mapillaryViewerVisible) =>
        set({ mapillaryViewerVisible }),
      setMapillaryCoords: (mapillaryCoords) => set({ mapillaryCoords }),
      setOsmExtractionPoints: (osmExtractionPoints) =>
        set({ osmExtractionPoints }),
      setOsmExtractedData: (osmExtractedData) => set({ osmExtractedData }),

      addOsmExtractionPoint: (point) => {
        set((s) => ({
          osmExtractionPoints: [...s.osmExtractionPoints, point],
        }));
      },

      clearOsmExtraction: () => {
        set({ osmExtractionPoints: [], osmExtractedData: null });
      },

      // ---- Settings Slice (persisted) ----
      roadClosureHandlingOn: true,

      setRoadClosureHandlingOn: (enabled) => {
        set({ roadClosureHandlingOn: enabled });
      },

      // ---- UI Slice ----
      mapLoading: true,
      mapError: null,
      dimensions: null,

      setMapLoading: (mapLoading) => set({ mapLoading }),
      setMapError: (mapError) => set({ mapError }),
      setDimensions: (dimensions) => set({ dimensions }),
    }),
    {
      name: "trashroute-map-state",
      storage: asyncStorage,
      // Only persist settings that should survive app restarts.
      // Route/navigation/UI state is ephemeral and loaded from storage on mount.
      partialize: (state) => ({
        roadClosureHandlingOn: state.roadClosureHandlingOn,
        mapCenter: state.mapCenter,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Optimized Selectors
//
// Each selector subscribes to the minimal slice of state needed.
// Uses `useShallow` for object selectors to prevent unnecessary re-renders
// when the selected object is structurally equal.
// ---------------------------------------------------------------------------

/** Route data: route, collection points, route polyline */
export const useRouteData = () =>
  useMapStateStore(
    useShallow((s) => ({
      route: s.route,
      collectionPoints: s.collectionPoints,
      routePoints: s.routePoints,
    })),
  );

/** Navigation state: mode, matched routes, loading states */
export const useNavigationState = () =>
  useMapStateStore(
    useShallow((s) => ({
      navigationMode: s.navigationMode,
      matchedRoute: s.matchedRoute,
      cachedMatchedRoute: s.cachedMatchedRoute,
      navLoading: s.navLoading,
      fixToRoadsLoading: s.fixToRoadsLoading,
      directionsLoading: s.directionsLoading,
    })),
  );

/** Map interaction: center, selected point, tap destination, aerial/bearing */
export const useMapInteraction = () =>
  useMapStateStore(
    useShallow((s) => ({
      mapCenter: s.mapCenter,
      selectedPoint: s.selectedPoint,
      tapDestination: s.tapDestination,
      showAerial: s.showAerial,
      userBearing: s.userBearing,
    })),
  );

/** Mapillary viewer state */
export const useMapillaryState = () =>
  useMapStateStore(
    useShallow((s) => ({
      mapillaryViewerVisible: s.mapillaryViewerVisible,
      mapillaryCoords: s.mapillaryCoords,
    })),
  );

/** OSM extraction state */
export const useOsmExtraction = () =>
  useMapStateStore(
    useShallow((s) => ({
      osmExtractionPoints: s.osmExtractionPoints,
      osmExtractedData: s.osmExtractedData,
    })),
  );

/** Map UI state: loading, errors, dimensions */
export const useMapUI = () =>
  useMapStateStore(
    useShallow((s) => ({
      mapLoading: s.mapLoading,
      mapError: s.mapError,
      dimensions: s.dimensions,
    })),
  );

// --- Atomic selectors for fine-grained subscriptions ---

/** Route points with structural equality to prevent re-renders on identical arrays. */
export const useRoutePoints = () =>
  useMapStateStore(
    (s) => s.routePoints,
    (prev, curr) => coordArrayEquals(prev, curr),
  );

/** Whether the map has an active route or destination */
export const useHasActiveRoute = () =>
  useMapStateStore((s) => s.routePoints.length > 0 || !!s.tapDestination);

/** Whether there are enough points to start navigation */
export const useCanStartNavigation = () =>
  useMapStateStore((s) => s.routePoints.length >= 2 || !!s.tapDestination);

// --- Action selectors (stable references, never cause re-renders) ---

/** All store actions -- stable function references that won't trigger re-renders. */
export const useMapActions = () =>
  useMapStateStore(
    useShallow((s) => ({
      setRoute: s.setRoute,
      setCollectionPoints: s.setCollectionPoints,
      setRoutePoints: s.setRoutePoints,
      setMapCenter: s.setMapCenter,
      setSelectedPoint: s.setSelectedPoint,
      setTapDestination: s.setTapDestination,
      setNavigationMode: s.setNavigationMode,
      setMatchedRoute: s.setMatchedRoute,
      setCachedMatchedRoute: s.setCachedMatchedRoute,
      setNavLoading: s.setNavLoading,
      setFixToRoadsLoading: s.setFixToRoadsLoading,
      setDirectionsLoading: s.setDirectionsLoading,
      setShowAerial: s.setShowAerial,
      setUserBearing: s.setUserBearing,
      setMapillaryViewerVisible: s.setMapillaryViewerVisible,
      setMapillaryCoords: s.setMapillaryCoords,
      setOsmExtractionPoints: s.setOsmExtractionPoints,
      setOsmExtractedData: s.setOsmExtractedData,
      setMapLoading: s.setMapLoading,
      setMapError: s.setMapError,
      setDimensions: s.setDimensions,
      setRoadClosureHandlingOn: s.setRoadClosureHandlingOn,
      loadRoute: s.loadRoute,
      loadImportedPoints: s.loadImportedPoints,
      clearRouteData: s.clearRouteData,
      addOsmExtractionPoint: s.addOsmExtractionPoint,
      clearOsmExtraction: s.clearOsmExtraction,
    })),
  );

// Re-export for backward compat with the selector object (now deprecated)
/** @deprecated Use individual selector hooks (useRouteData, useMapActions, etc.) instead */
export const useMapStateSelectors = {
  route: () => useMapStateStore((s) => s.route),
  collectionPoints: () => useMapStateStore((s) => s.collectionPoints),
  routePoints: useRoutePoints,
  navigationMode: () => useMapStateStore((s) => s.navigationMode),
  matchedRoute: () => useMapStateStore((s) => s.matchedRoute),
  cachedMatchedRoute: () => useMapStateStore((s) => s.cachedMatchedRoute),
  navLoading: () => useMapStateStore((s) => s.navLoading),
  mapCenter: () => useMapStateStore((s) => s.mapCenter),
  selectedPoint: () => useMapStateStore((s) => s.selectedPoint),
  tapDestination: () => useMapStateStore((s) => s.tapDestination),
  directionsLoading: () => useMapStateStore((s) => s.directionsLoading),
  fixToRoadsLoading: () => useMapStateStore((s) => s.fixToRoadsLoading),
  showAerial: () => useMapStateStore((s) => s.showAerial),
  userBearing: () => useMapStateStore((s) => s.userBearing),
  mapillaryViewerVisible: () =>
    useMapStateStore((s) => s.mapillaryViewerVisible),
  mapillaryCoords: () => useMapStateStore((s) => s.mapillaryCoords),
  osmExtractionPoints: () => useMapStateStore((s) => s.osmExtractionPoints),
  osmExtractedData: () => useMapStateStore((s) => s.osmExtractedData),
  roadClosureHandlingOn: () => useMapStateStore((s) => s.roadClosureHandlingOn),
  mapLoading: () => useMapStateStore((s) => s.mapLoading),
  mapError: () => useMapStateStore((s) => s.mapError),
  dimensions: () => useMapStateStore((s) => s.dimensions),
  displayRoutePoints: useRoutePoints,
  hasActiveRoute: useHasActiveRoute,
  canStartNavigation: useCanStartNavigation,
};
