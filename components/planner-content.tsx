import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, TextInput, Platform, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { impactAsync as hapticImpact, notificationAsync as hapticNotification, ImpactFeedbackStyle, NotificationFeedbackType } from "@/lib/safe-haptics";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { CircuitBackground } from "@/components/neo";
import { StartPointConfig } from "@/components/start-point-config";
import { StatisticsPanel } from "@/components/statistics-panel";
import { ProcessingLog } from "@/components/processing-log";
import { RouteReport } from "@/components/route-report";
import { GPXExport } from "@/components/gpx-export";
import { GpxTrainingLibrary } from "@/components/gpx-training-library";
import { TurnPenaltiesConfig } from "@/components/turn-penalties-config";
import { OSMImport } from "@/components/osm-import";
import { OSMFileLibraryPanel } from "@/components/osm-file-library-panel";
import { RouteComparison } from "@/components/route-comparison";
import { ExportOptions } from "@/components/export-options";
// Platform-specific: route-map.web on web, route-map.native on iOS/Android (avoids react-native-maps on web)
import { RouteMap } from "@/components/route-map";
import {
  useRouting,
  generateLogEntry,
  generateSampleReport,
} from "@/lib/routing-context";
import { calculateRouteStatistics } from "@/lib/route-calculator";
import { douglasPeucker } from "@/lib/douglas-peucker";
import { sanitizeRouteStatistics } from "@/lib/export-utils";
import { useCustomStartPoint } from "@/hooks/useCustomStartPoint";
import { OSM_DATA_STORAGE_KEY, storedToOsmData } from "@/lib/osm-storage";
import type { StoredOSMData } from "@/lib/osm-storage";
import { storage } from "@/lib/storage";
import { generateRouteId } from "@/lib/utils";
import { routeThroughWaypoints } from "@/lib/mapMatching";
import { repairRouteGaps, countGaps } from "@/lib/routeGapFilter";
import { getRoutingConfigAsync } from "@/lib/routing-config";
import { getRouteOptionsForRouting } from "@/stores/routeParametersStore";
import { RouteOptimizer } from "@/lib/route-optimizer-v2";
import { debug } from "@/lib/route-optimizer-v2/debug";
import { pruneRouteLoops } from "@/lib/route-loop-pruner";
import { RouteOptimizerSimpleV2 } from "@/lib/offline-optimizer-v2";
import { useRouteOptimization } from "@/hooks/useRouteOptimization";
import { optimizeRoute as backendOptimizeRoute } from "@/services/overtureOptimizerService";
import { osmDataToGeoJSON } from "@/lib/geojsonToOsmData";
import { useBetaFeatures } from "@/context/BetaFeaturesContext";
import { isMockCollectionPoints } from "@/lib/is-mock-route";
import type { CollectionPoint, Route } from "@/types";
import { ConstraintParser } from "@/components/constraint-parser";
import type { ParsedConstraint } from "@/types/routeMasterConstraint";

const IMPORTED_POINTS_KEY = "trashroute_imported_points";
const IMPORTED_DISTANCE_KEY = "trashroute_imported_distance_km";
/** Only apply AsyncStorage import if it was written in the last 2 minutes (avoids stale data from previous sessions). */
const STORED_IMPORT_MAX_AGE_MS = 2 * 60 * 1000;

export default function PlannerContent() {
  const colors = useColors();
  const router = useRouter();
  const { state, dispatch } = useRouting();
  const [outputFileName, setOutputFileName] = useState(
    state.configuration.outputFileName
  );
  const [collectionPoints, setCollectionPoints] = useState<CollectionPoint[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [routePoints, setRoutePoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [showMap, setShowMap] = useState(true);
  const customStartPoint = useCustomStartPoint();
  const { optimizeRoute: optimizeRouteTurnAware } = useRouteOptimization();
  const { isExperimentalRoute, features } = useBetaFeatures();
  // Ref so "Generate Route" always uses the latest OSM import (avoids stale state race)
  const lastImportedPointsRef = useRef<CollectionPoint[]>([]);
  // Store OSM data so we can re-optimize with current start point when user clicks Generate
  const lastOsmDataRef = useRef<StoredOSMData | null>(null);
  // Bump to re-fetch the saved OSM files list after a new import
  const [osmLibraryRefreshKey, setOsmLibraryRefreshKey] = useState(0);
  const [showConstraintParser, setShowConstraintParser] = useState(false);
  const [confirmedConstraints, setConfirmedConstraints] = useState<ParsedConstraint[]>([]);
  const [optimizationOffline, setOptimizationOffline] = useState(false);
  /** When true, use local optimizer only (avoids backend-induced looping). */
  const [preferLocalOptimizer, setPreferLocalOptimizer] = useState(false);
  /** When true, use the offline optimizer from route-optimizer-mobile-v2 (Videos app). */
  const [useOfflineOptimizerV2, setUseOfflineOptimizerV2] = useState(false);

  const applyRouteFromPoints = useCallback(
    async (points: CollectionPoint[], fileName?: string, options?: { totalDistanceKm?: number }) => {
      const validPoints = Array.isArray(points)
        ? points.filter(
            (p) =>
              p != null &&
              typeof (p as CollectionPoint).latitude === "number" &&
              typeof (p as CollectionPoint).longitude === "number" &&
              !Number.isNaN((p as CollectionPoint).latitude) &&
              !Number.isNaN((p as CollectionPoint).longitude)
          )
        : [];
      if (validPoints.length === 0) return;
      const name = fileName ?? state.configuration.outputFileName ?? "trash_route";
      let gpxPoints = validPoints.map((p) => ({ lat: p.latitude, lon: p.longitude }));
      let distanceKmOverride = options?.totalDistanceKm;

      const routingConfig = await getRoutingConfigAsync();
      if (routingConfig.baseUrl && gpxPoints.length >= 2) {
        try {
          const matched = await routeThroughWaypoints(gpxPoints, routingConfig, getRouteOptionsForRouting());
          if (matched && matched.matchedGeometry.length >= 2) {
            gpxPoints = matched.matchedGeometry;
            distanceKmOverride = matched.totalDistance / 1000;
            debug("Planner.applyRouteFromPoints", { snappedToRoads: true, points: gpxPoints.length });
          }
        } catch (e) {
          debug("Planner.applyRouteFromPoints", { snappedToRoads: false, error: e });
        }
      }

      try {
        const stats = calculateRouteStatistics(validPoints, {
          ...(distanceKmOverride != null && distanceKmOverride > 0 && { distanceKmOverride }),
        });
        const sanitized = sanitizeRouteStatistics(stats);
        const report = generateSampleReport(sanitized);
        const { generateGPXString } = await import("@/lib/routing-context");
        const gpxData = generateGPXString(name, gpxPoints);
        dispatch({ type: "SET_STATISTICS", payload: sanitized });
        dispatch({ type: "SET_REPORT", payload: report });
        dispatch({ type: "SET_GPX_DATA", payload: gpxData });
        setRoutePoints(gpxPoints);
        debug("Planner.applyRouteFromPoints", {
          pointsLength: validPoints.length,
          statsDistance: stats?.totalDistance,
        });
      } catch (err) {
        console.error("Planner.applyRouteFromPoints failed:", err);
        dispatch({
          type: "ADD_LOG_ENTRY",
          payload: generateLogEntry(
            err instanceof Error ? err.message : "Failed to build route from points",
            "error"
          ),
        });
      }
    },
    [state.configuration.outputFileName, dispatch]
  );

  // Listen for drag-and-drop imports from the tab layout
  useEffect(() => {
    if (Platform.OS !== "web") return;

    const checkForImportedPoints = async () => {
      try {
        const timestamp = await AsyncStorage.getItem("osm_import_timestamp");
        const storedPoints = await AsyncStorage.getItem(IMPORTED_POINTS_KEY);
        const storedOsmData = await AsyncStorage.getItem(OSM_DATA_STORAGE_KEY);
        const storedDistance = await AsyncStorage.getItem(IMPORTED_DISTANCE_KEY);

        if (storedPoints && timestamp) {
          const writtenAt = parseInt(timestamp, 10);
          const ageMs = Number.isNaN(writtenAt) ? Infinity : Date.now() - writtenAt;
          if (ageMs > STORED_IMPORT_MAX_AGE_MS) {
            await AsyncStorage.removeItem(IMPORTED_POINTS_KEY);
            await AsyncStorage.removeItem(OSM_DATA_STORAGE_KEY);
            await AsyncStorage.removeItem(IMPORTED_DISTANCE_KEY);
            await AsyncStorage.removeItem("osm_import_timestamp");
            return;
          }
          const points = JSON.parse(storedPoints) as CollectionPoint[];
          if (isMockCollectionPoints(points)) {
            await AsyncStorage.removeItem(IMPORTED_POINTS_KEY);
            await AsyncStorage.removeItem(OSM_DATA_STORAGE_KEY);
            await AsyncStorage.removeItem(IMPORTED_DISTANCE_KEY);
            await AsyncStorage.removeItem("osm_import_timestamp");
            return;
          }
          if (points.length > 0) {
            lastImportedPointsRef.current = points;
            lastOsmDataRef.current = storedOsmData
              ? (JSON.parse(storedOsmData) as StoredOSMData)
              : null;
            setCollectionPoints(points);
            dispatch({
              type: "ADD_LOG_ENTRY",
              payload: generateLogEntry(
                `Imported ${points.length} collection points via drag-and-drop`,
                "success"
              ),
            });
            const distKm = storedDistance ? parseFloat(storedDistance) : undefined;
            applyRouteFromPoints(points, undefined, {
              ...(distKm != null && !isNaN(distKm) && distKm > 0 && { totalDistanceKm: distKm }),
            }).catch(() => {});
            setOsmLibraryRefreshKey((k) => k + 1);
            await AsyncStorage.removeItem(IMPORTED_POINTS_KEY);
            await AsyncStorage.removeItem(OSM_DATA_STORAGE_KEY);
            await AsyncStorage.removeItem(IMPORTED_DISTANCE_KEY);
            await AsyncStorage.removeItem("osm_import_timestamp");
          }
        }
      } catch (error) {
        console.error("Failed to check for imported points:", error);
      }
    };

    // Check immediately
    checkForImportedPoints();

    const interval = setInterval(checkForImportedPoints, 2500);

    return () => clearInterval(interval);
  }, [dispatch, applyRouteFromPoints]);

  const handleGenerateRoute = async () => {
    const pointsToUse =
      lastImportedPointsRef.current.length > 0
        ? lastImportedPointsRef.current
        : collectionPoints;
    if (pointsToUse.length === 0) return;
    hapticImpact(ImpactFeedbackStyle.Medium);

    dispatch({ type: "CLEAR_LOG" });
    dispatch({ type: "SET_PROCESSING", payload: true });

      let optimizerDistanceKm: number | undefined;
      let gpxWasSet = false;
      let optResult: any = undefined;
    try {
      // Re-optimize with current start point if we have OSM data
      let optimizedPoints = pointsToUse;
      const osmData = lastOsmDataRef.current;
      if (osmData) {
        const { nodes, ways, turnRestrictions } = storedToOsmData(osmData);
        const startCoords = customStartPoint.getStartPoint();
        const onewayMode = state.configuration.onewayMode ?? "B";
        const turnPenalties = state.configuration.turnPenalties;
        const serviceBothSides = state.configuration.serviceBothSides ?? false;
        // Yield so React can paint "processing" state before optimisation
        await new Promise<void>((r) => setTimeout(r, 0));
        // When "Use offline optimizer (v2)" is on, use only the Videos app optimizer (no backend, no existing local).
        let optimizerSource: "backend" | "local" | "offline-v2" | undefined;
        if (useOfflineOptimizerV2) {
          try {
            const v2 = new RouteOptimizerSimpleV2(nodes, ways);
            optResult = v2.optimize(startCoords?.latitude, startCoords?.longitude);
            optimizerSource = "offline-v2";
          } catch (e) {
            debug("Planner.generateRoute", { offlineV2Failed: (e as Error).message });
          }
        }
        if (optResult === undefined && !optimizationOffline && !preferLocalOptimizer) {
          try {
            const geojson = osmDataToGeoJSON(nodes, ways);
            const backendResult = await backendOptimizeRoute({
              geojson,
              start_lat: startCoords?.latitude,
              start_lon: startCoords?.longitude,
              oneway_mode: onewayMode,
              service_both_sides: serviceBothSides,
              turn_penalties: {
                left_turn: turnPenalties.leftTurn,
                u_turn: turnPenalties.uTurn,
                right_turn: turnPenalties.rightTurn,
              },
              clean_before_optimize: true,
            });
            optResult = {
              route: backendResult.route,
              totalDistance: backendResult.total_distance_km,
            };
            optimizerSource = "backend";
          } catch (backendErr) {
            debug("Planner.generateRoute", { backendOptimizerFailed: (backendErr as Error).message });
          }
        }
        if (optResult === undefined) {
          // Offline mode or backend failed: use local optimizer
          optimizerSource = "local";
          optResult = isExperimentalRoute
            ? await optimizeRouteTurnAware(nodes, ways, {
                customLat: startCoords?.latitude,
                customLon: startCoords?.longitude,
                turnPenalties,
                onewayMode,
                turnRestrictions,
                serviceBothSides,
              })
            : await new Promise<any>((resolve, reject) => {
                setTimeout(() => {
                  try {
                    const optimizer = new RouteOptimizer(nodes, ways, onewayMode, turnRestrictions, undefined, {
                      serviceBothSides,
                    });
                    resolve(
                      optimizer.optimize(
                        startCoords?.latitude,
                        startCoords?.longitude,
                        turnPenalties
                      )
                    );
                  } catch (err) {
                    reject(err);
                  }
                }, 0);
              });
        }

        // Fix #3: post-process to prune excess revisits of the same directed segment.
        // One pass allows each segment once; two-pass allows twice.
        // Use coarser precision (4) and more iterations so backend/loopy routes get cleaned.
        try {
          const maxSegmentVisits = serviceBothSides ? 2 : 1;
          const pruned = pruneRouteLoops(optResult.route ?? [], {
            maxSegmentVisits,
            precision: 4,
            maxIterations: 100,
          });
          if (pruned.changed) {
            debug("Planner.generateRoute.deLoop", {
              source: optimizerSource ?? "local",
              maxSegmentVisits,
              removedPoints: pruned.removedPoints,
              stats: pruned.stats,
            });
            optResult = {
              ...optResult,
              route: pruned.route,
              // totalDistance is used as a hint/override later; keep it consistent with the pruned path
              totalDistance: pruned.stats.approxDistanceKmAfter,
            };
          }
        } catch (e) {
          debug("Planner.generateRoute.deLoop", { failed: true, error: e });
        }

        if (optResult.route.length > 0) {
          optimizerDistanceKm = optResult.totalDistance;
          // Diagnostic: which optimizer produced the route and whether route has loop patterns
          const routeCoords = optResult.route.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`);
          const uniqueCoords = new Set(routeCoords).size;
          const hasLoopPattern = uniqueCoords < optResult.route.length;
          debug("Planner.generateRoute.optimizer", {
            source: optimizerSource ?? "local",
            routeLength: optResult.route.length,
            uniqueStops: uniqueCoords,
            hasLoopPattern,
          });
          optimizedPoints = optResult.route.map((p, i) => ({
            // Use index-based suffix to ensure uniqueness even if visiting the same node twice (loops/returns)
            id: (p as { nodeId?: string }).nodeId 
              ? `${(p as { nodeId?: string }).nodeId}_${i}` 
              : `route-${i}`,
            address: `Stop ${i + 1}`,
            latitude: p.latitude,
            longitude: p.longitude,
            collectionType: "residential" as const,
            status: "pending" as const,
          }));
          lastImportedPointsRef.current = optimizedPoints;
          if (startCoords) {
            dispatch({
              type: "ADD_LOG_ENTRY",
              payload: generateLogEntry(
                `Route optimized with custom start point (${startCoords.latitude.toFixed(5)}, ${startCoords.longitude.toFixed(5)})`,
                "success"
              ),
            });
          } else {
            dispatch({
              type: "ADD_LOG_ENTRY",
              payload: generateLogEntry(
                "No custom start point set. Enter coordinates above and click 'Validate & Set' before Generate Route.",
                "warning"
              ),
            });
          }
          debug("Planner.generateRoute", {
            reOptimized: true,
            startPoint: startCoords,
            pointsLength: optimizedPoints.length,
          });
        }
      }

      // Build initial geometry from optimizer (graph nodes → may be off-road). Snap to roads so Map shows road-following path (fixes CPP/optimizer jagged polyline).
      let gpxPoints = optimizedPoints.map((p) => ({
        lat: p.latitude,
        lon: p.longitude,
      }));
      let pointsForStorage: CollectionPoint[] = optimizedPoints;
      try {
        const routingConfig = await getRoutingConfigAsync();
        if (routingConfig.baseUrl && gpxPoints.length >= 2) {
          const matched = await routeThroughWaypoints(gpxPoints, routingConfig, getRouteOptionsForRouting());
          if (matched && matched.matchedGeometry.length >= 2) {
            gpxPoints = matched.matchedGeometry;
            optimizerDistanceKm = matched.totalDistance / 1000;
            // Repair teleporting gaps (>400 m straight-line jumps) caused by OSRM
            // chunk-join mismatches or partial failures. Each gap gets a targeted
            // 2-waypoint re-route so the road-following geometry fills the jump.
            const gapsBefore = countGaps(gpxPoints);
            if (gapsBefore > 0) {
              debug("Planner.generateRoute", { teleportingGapsDetected: gapsBefore });
              gpxPoints = await repairRouteGaps(gpxPoints, routingConfig, getRouteOptionsForRouting());
              debug("Planner.generateRoute", { teleportingGapsAfterRepair: countGaps(gpxPoints) });
            }

            // Build collection points from matched geometry so saved route draws on-road on Map tab.
            // Use Douglas-Peucker simplification (5 m tolerance) to preserve shape without
            // the "invisible road" teleporting segments caused by uniform stride downsampling.
            const allMatchedPoints: CollectionPoint[] = gpxPoints.map((p, i) => ({
              id: `route-${i}`,
              address: `Stop ${i + 1}`,
              latitude: p.lat,
              longitude: p.lon,
              collectionType: "residential" as const,
              status: "pending" as const,
            }));
            pointsForStorage = douglasPeucker(allMatchedPoints, 0.005); // 5 m tolerance
            debug("Planner.generateRoute", { snappedToRoads: true, points: gpxPoints.length });
          }
        }
      } catch (e) {
        debug("Planner.generateRoute", { snappedToRoads: false, error: e });
      }

      // Generate GPX and stats so Download/Preview are available
      const stats = calculateRouteStatistics(pointsForStorage, {
        ...(optimizerDistanceKm != null && optimizerDistanceKm > 0 && { distanceKmOverride: optimizerDistanceKm }),
        // Include backend optimizer stats for accurate turn counts and efficiency
        ...(optResult?.stats && { optimizerStats: optResult.stats }),
      });
      const sanitized = sanitizeRouteStatistics(stats);
      const report = generateSampleReport(sanitized);

      const { generateGPXString } = await import("@/lib/routing-context");
      debug("Planner.generateRoute", {
        collectionPointsLength: pointsForStorage.length,
        gpxPointsLength: gpxPoints.length,
        statsDistance: sanitized?.totalDistance,
      });
      const fileName = state.configuration.outputFileName?.trim() || outputFileName?.trim() || "trash_route";
      const gpxData = generateGPXString(fileName, gpxPoints);

      // Set GPX + stats so buttons enable without waiting for log animation
      dispatch({ type: "SET_STATISTICS", payload: sanitized });
      dispatch({ type: "SET_REPORT", payload: report });
      dispatch({ type: "SET_GPX_DATA", payload: gpxData });
      gpxWasSet = true;
      setRoutePoints(gpxPoints);
      setCollectionPoints(pointsForStorage);
      lastImportedPointsRef.current = [];

      // Persist route so Map tab loads road-following geometry
      try {
        const estimatedMinutes = Math.max(1, Math.round((sanitized?.totalDistance ?? 0) * 3));
        const routeToSave: Route = {
          id: generateRouteId(),
          date: new Date().toISOString().slice(0, 10),
          points: pointsForStorage,
          totalPoints: pointsForStorage.length,
          completedPoints: 0,
          estimatedDuration: estimatedMinutes,
          status: "not_started",
          routeSource: "osm", // Navigation route only; Processing Queue (stops) is for VRP on Home
        };
        await storage.saveRoute(routeToSave);
      } catch (saveErr) {
        console.warn("Planner: could not save route for Map tab", saveErr);
      }

      // Cosmetic log animation (non-blocking — doesn't delay GPX availability)
      const logMessages = [
        { msg: "Starting route generation...", type: "info" as const },
        { msg: `Processing ${pointsToUse.length} collection points...`, type: "info" as const },
        { msg: "Building directed graph from OSM extract", type: "info" as const },
        { msg: "Filtering highway types: residential, unclassified, tertiary, secondary, living_street, secondary_link, tertiary_link, service=alley", type: "info" as const },
        { msg: "Identifying Largest Strongly Connected Component (LSCC)", type: "info" as const },
        { msg: `Applying turn penalties: Left=${state.configuration.turnPenalties.leftTurn}, U-Turn=${state.configuration.turnPenalties.uTurn}`, type: "info" as const },
        { msg: "Route generation complete!", type: "success" as const },
      ];

      for (const log of logMessages) {
        dispatch({
          type: "ADD_LOG_ENTRY",
          payload: generateLogEntry(log.msg, log.type),
        });
      }
      hapticNotification(NotificationFeedbackType.Success);
    } catch (e) {
      dispatch({
        type: "ADD_LOG_ENTRY",
        payload: generateLogEntry(
          e instanceof Error ? e.message : "Route generation failed",
          "warning"
        ),
      });
      // Still set GPX from points so Download/Preview work even when optimization failed
      if (pointsToUse.length >= 2) {
        try {
          const { generateGPXString } = await import("@/lib/routing-context");
          const fallbackPoints = pointsToUse.map((p) => ({ lat: p.latitude, lon: p.longitude }));
          const fileName = state.configuration.outputFileName?.trim() || outputFileName?.trim() || "trash_route";
          const fallbackGpx = generateGPXString(fileName, fallbackPoints);
          dispatch({ type: "SET_GPX_DATA", payload: fallbackGpx });
          gpxWasSet = true;
          const stats = calculateRouteStatistics(pointsToUse);
          dispatch({ type: "SET_STATISTICS", payload: sanitizeRouteStatistics(stats) });
          setRoutePoints(fallbackPoints);
        } catch (_) {}
      }
    } finally {
      dispatch({ type: "SET_PROCESSING", payload: false });
      // Safety net: if GPX data was never set (e.g. error before SET_GPX_DATA dispatch),
      // generate it from whatever points we have so Download/Preview always work.
      if (!gpxWasSet && pointsToUse.length >= 2) {
        try {
          const { generateGPXString } = await import("@/lib/routing-context");
          const pts = (collectionPoints.length > 0 ? collectionPoints : pointsToUse)
            .map((p) => ({ lat: p.latitude, lon: p.longitude }));
          const fileName = state.configuration.outputFileName?.trim() || outputFileName?.trim() || "trash_route";
          dispatch({ type: "SET_GPX_DATA", payload: generateGPXString(fileName, pts) });
        } catch (_) {}
      }
    }
  };

  const handleFileNameChange = (text: string) => {
    setOutputFileName(text);
    dispatch({ type: "SET_OUTPUT_FILENAME", payload: text });
  };

  const handleOSMImport = useCallback(
    async (
      points: CollectionPoint[],
      osmData?: StoredOSMData,
      options?: { totalDistanceKm?: number }
    ) => {
      debug("Planner.handleOSMImport", {
        pointsLength: points.length,
        hasOsmData: !!osmData,
        sampleFirst: points[0] ? { id: points[0].id, lat: points[0].latitude, lon: points[0].longitude } : null,
      });
      lastImportedPointsRef.current = points;
      lastOsmDataRef.current = osmData ?? null;
      setCollectionPoints(points);
      dispatch({
        type: "ADD_LOG_ENTRY",
        payload: generateLogEntry(
          `Imported ${points.length} collection points from OSM data`,
          "success"
        ),
      });
      await applyRouteFromPoints(points, undefined, options);
    },
    [dispatch, applyRouteFromPoints]
  );

  return (
    <ScreenContainer style={{ backgroundColor: colors.background }}>
      <CircuitBackground />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16 }}
      >
        {/* Header with Back Button */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-1">
            <Text className="text-3xl font-bold text-foreground mb-1">
              Route Planner
            </Text>
            <Text className="text-sm text-muted">
              Configure and generate optimized trash collection routes
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/")}
            style={{ backgroundColor: colors.primary + "20" }}
            className="px-4 py-2 rounded-lg"
          >
            <Text style={{ color: colors.primary }} className="font-semibold">
              Home
            </Text>
          </TouchableOpacity>
        </View>

        
        {/* Start Point Configuration - set BEFORE importing for custom route start */}
        <StartPointConfig />

        {/* Drag and Drop Hint for Web */}
        {Platform.OS === "web" && (
          <View
            className="mb-4 p-3 rounded-xl border-2 border-dashed"
            style={{ 
              borderColor: colors.primary + "60",
              backgroundColor: colors.primary + "10"
            }}
          >
            <Text className="text-sm text-center" style={{ color: colors.primary }}>
              💡 Tip: Drag and drop an OSM or GeoJSON file anywhere on this page to import
            </Text>
          </View>
        )}

        {/* Saved OSM File Library */}
        <OSMFileLibraryPanel
          onLoadFile={async (xmlContent, fileName) => {
            try {
              const { OSMParser } = await import("@/lib/route-optimizer-v2");
              const { osmDataToStored } = await import("@/lib/osm-storage");
              const parser = new OSMParser();
              const { nodes, ways, turnRestrictions } = parser.parseOSM(xmlContent);
              if (nodes.size === 0 || ways.length === 0) {
                Alert.alert("Error", "No routes found in this OSM file.");
                return;
              }
              const startCoords = customStartPoint.getStartPoint();
              const onewayMode = state.configuration.onewayMode ?? "B";
              const turnPenalties = state.configuration.turnPenalties;
              const serviceBothSides = state.configuration.serviceBothSides ?? false;
              let optResult: { route: Array<{ latitude: number; longitude: number; nodeId?: string }>; totalDistance?: number } | undefined;
              let libraryOptimizerSource: "backend" | "local" | "offline-v2" | undefined;
              if (useOfflineOptimizerV2) {
                try {
                  const v2 = new RouteOptimizerSimpleV2(nodes, ways);
                  optResult = v2.optimize(startCoords?.latitude, startCoords?.longitude);
                  libraryOptimizerSource = "offline-v2";
                } catch {
                  // fall through
                }
              }
              if (optResult === undefined && !optimizationOffline && !preferLocalOptimizer) {
                try {
                  const geojson = osmDataToGeoJSON(nodes, ways);
                  const backendResult = await backendOptimizeRoute({
                    geojson,
                    start_lat: startCoords?.latitude,
                    start_lon: startCoords?.longitude,
                    oneway_mode: onewayMode,
                    service_both_sides: serviceBothSides,
                    turn_penalties: { left_turn: turnPenalties.leftTurn, u_turn: turnPenalties.uTurn, right_turn: turnPenalties.rightTurn },
                  });
                  optResult = { route: backendResult.route, totalDistance: backendResult.total_distance_km };
                  libraryOptimizerSource = "backend";
                } catch {
                  // fall through to local
                }
              }
              if (optResult === undefined) {
                libraryOptimizerSource = "local";
                optResult = isExperimentalRoute
                  ? await optimizeRouteTurnAware(nodes, ways, {
                      customLat: startCoords?.latitude,
                      customLon: startCoords?.longitude,
                      turnPenalties,
                      onewayMode,
                      turnRestrictions: turnRestrictions ?? [],
                      serviceBothSides,
                    })
                  : (() => {
                      const optimizer = new RouteOptimizer(nodes, ways, onewayMode, turnRestrictions ?? [], undefined, { serviceBothSides });
                      return optimizer.optimize(startCoords?.latitude, startCoords?.longitude, turnPenalties);
                    })();
              }

              // Fix #3: post-process to prune excess revisits of the same directed segment.
              const maxSegmentVisits = serviceBothSides ? 2 : 1;
              let route = optResult.route ?? [];
              let totalDistance = optResult.totalDistance;
              try {
                const pruned = pruneRouteLoops(route, {
                  maxSegmentVisits,
                  precision: 4,
                  maxIterations: 100,
                });
                if (pruned.changed) {
                  debug("Planner.OSMFileLibrary.deLoop", {
                    source: libraryOptimizerSource ?? "local",
                    maxSegmentVisits,
                    removedPoints: pruned.removedPoints,
                    stats: pruned.stats,
                  });
                  route = pruned.route;
                  totalDistance = pruned.stats.approxDistanceKmAfter;
                }
              } catch (e) {
                debug("Planner.OSMFileLibrary.deLoop", { failed: true, error: e });
              }

              const libRouteCoords = route.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`);
              const libUniqueCoords = new Set(libRouteCoords).size;
              debug("Planner.OSMFileLibrary.optimizer", {
                source: libraryOptimizerSource ?? "local",
                routeLength: route.length,
                uniqueStops: libUniqueCoords,
                hasLoopPattern: libUniqueCoords < route.length,
              });
              const collectionPts: CollectionPoint[] = route.map(
                (p, i) => ({
                  id: p.nodeId ?? `route-${i}`,
                  address: `Stop ${i + 1}`,
                  latitude: p.latitude,
                  longitude: p.longitude,
                  collectionType: "residential" as const,
                  status: "pending" as const,
                })
              );
              if (collectionPts.length === 0) {
                Alert.alert(
                  "No route",
                  "Optimization produced no route. Try setting a start point in Start Point Configuration, or check that the OSM file contains routable ways."
                );
                return;
              }
              const osmData = osmDataToStored(nodes, ways, turnRestrictions ?? []);
              handleOSMImport(collectionPts, osmData, {
                totalDistanceKm: totalDistance,
              });
              dispatch({
                type: "ADD_LOG_ENTRY",
                payload: generateLogEntry(
                  `Loaded "${fileName}" from library (${collectionPts.length} points)`,
                  "success"
                ),
              });
            } catch (err) {
              Alert.alert("Error", err instanceof Error ? err.message : "Failed to load file");
            }
          }}
          refreshKey={osmLibraryRefreshKey}
        />

        {/* OSM Import */}
        <OSMImport
          useOfflineOptimizerV2={useOfflineOptimizerV2}
          onImportComplete={(points, osmData, options) => {
            handleOSMImport(points, osmData, options);
            setOsmLibraryRefreshKey((k) => k + 1);
          }}
        />

        {/* Output File Name */}
        <View
          className="bg-surface rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Text className="text-lg font-semibold text-foreground mb-2">
            Output Configuration
          </Text>
          <Text className="text-sm text-muted mb-3">
            Set the name for the generated route files
          </Text>
          <View className="flex-row items-center">
            <TextInput
              value={outputFileName}
              onChangeText={handleFileNameChange}
              placeholder="trash_route"
              placeholderTextColor={colors.muted}
              className="flex-1 bg-background rounded-lg p-3 text-foreground"
              style={{ backgroundColor: colors.background, color: colors.foreground }}
            />
            <Text className="text-muted ml-2">.gpx</Text>
          </View>
        </View>

        {/* Route passes: one pass vs two pass (both sides of street) */}
        <View
          className="bg-surface rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Text className="text-lg font-semibold text-foreground mb-1">
            Route passes
          </Text>
          <Text className="text-sm text-muted mb-3">
            One pass: each street once per direction. Two pass: both sides (left and right curb), e.g. for mechanical arm collection.
          </Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => {
                hapticImpact();
                dispatch({ type: "SET_SERVICE_BOTH_SIDES", payload: false });
              }}
              style={{
                flex: 1,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: !state.configuration.serviceBothSides ? colors.primary : colors.border,
                backgroundColor: !state.configuration.serviceBothSides ? colors.primary + "18" : "transparent",
              }}
            >
              <Text
                style={{
                  color: !state.configuration.serviceBothSides ? colors.primary : colors.muted,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                One pass
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                hapticImpact();
                dispatch({ type: "SET_SERVICE_BOTH_SIDES", payload: true });
              }}
              style={{
                flex: 1,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: state.configuration.serviceBothSides ? colors.primary : colors.border,
                backgroundColor: state.configuration.serviceBothSides ? colors.primary + "18" : "transparent",
              }}
            >
              <Text
                style={{
                  color: state.configuration.serviceBothSides ? colors.primary : colors.muted,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                Two pass (both sides)
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Optimize offline toggle */}
        <View
          className="bg-surface rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <Text className="text-lg font-semibold text-foreground mb-1">
            Optimization
          </Text>
          <Text className="text-sm text-muted mb-3">
            Off: use backend when available, then fall back to local. On: use local optimizer only (no network). Prefer local: use local first to reduce looping. Offline (v2): use the optimizer from route-optimizer-mobile-v2 (Videos app).
          </Text>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-base text-foreground">Optimize offline</Text>
            <TouchableOpacity
              onPress={() => {
                hapticImpact();
                setOptimizationOffline((v) => !v);
              }}
              style={{
                width: 52,
                height: 30,
                borderRadius: 15,
                justifyContent: "center",
                backgroundColor: optimizationOffline ? colors.primary : colors.border,
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  marginLeft: optimizationOffline ? 24 : 2,
                  backgroundColor: "#fff",
                }}
              />
            </TouchableOpacity>
          </View>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-base text-foreground">Prefer local (less looping)</Text>
            <TouchableOpacity
              onPress={() => {
                hapticImpact();
                setPreferLocalOptimizer((v) => !v);
              }}
              style={{
                width: 52,
                height: 30,
                borderRadius: 15,
                justifyContent: "center",
                backgroundColor: preferLocalOptimizer ? colors.primary : colors.border,
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  marginLeft: preferLocalOptimizer ? 24 : 2,
                  backgroundColor: "#fff",
                }}
              />
            </TouchableOpacity>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-base text-foreground">Use offline optimizer (v2)</Text>
            <TouchableOpacity
              onPress={() => {
                hapticImpact();
                setUseOfflineOptimizerV2((v) => !v);
              }}
              style={{
                width: 52,
                height: 30,
                borderRadius: 15,
                justifyContent: "center",
                backgroundColor: useOfflineOptimizerV2 ? colors.primary : colors.border,
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  marginLeft: useOfflineOptimizerV2 ? 24 : 2,
                  backgroundColor: "#fff",
                }}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Turn Penalties Configuration */}
        <TurnPenaltiesConfig />

        {/* Generate Button */}
        <TouchableOpacity
          onPress={handleGenerateRoute}
          disabled={state.isProcessing || collectionPoints.length === 0}
          style={{
            backgroundColor:
              state.isProcessing || collectionPoints.length === 0
                ? colors.muted
                : colors.primary,
          }}
          className="py-4 rounded-xl items-center mb-4 active:opacity-70"
        >
          <Text className="text-white text-lg font-semibold">
            {state.isProcessing
              ? "Generating Route..."
              : collectionPoints.length === 0
                ? "Import Data to Generate"
                : "Generate Route"}
          </Text>
        </TouchableOpacity>

        {/* Processing Log */}
        <ProcessingLog />

        {/* Statistics Panel */}
        <StatisticsPanel />

        {/* RouteMaster Constraints */}
        {features.routeMasterConstraints && (
          <View style={{ marginBottom: 16 }}>
            {!showConstraintParser ? (
              <TouchableOpacity
                onPress={() => { hapticImpact(); setShowConstraintParser(true); }}
                style={{
                  borderWidth: 1,
                  borderColor: "rgba(0, 217, 255, 0.3)",
                  backgroundColor: "rgba(0, 217, 255, 0.08)",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#00D9FF", fontSize: 15, fontWeight: "600" }}>
                  + Add Constraint ({confirmedConstraints.length} active)
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ height: 480, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "rgba(0, 217, 255, 0.15)" }}>
                <ConstraintParser
                  onConstraintConfirmed={(c) => {
                    setConfirmedConstraints((prev) => [...prev, c]);
                    hapticNotification(NotificationFeedbackType.Success);
                  }}
                  onClose={() => setShowConstraintParser(false)}
                />
              </View>
            )}
            {/* Show confirmed constraints summary */}
            {confirmedConstraints.length > 0 && !showConstraintParser && (
              <View style={{ marginTop: 8 }}>
                {confirmedConstraints.map((c, i) => (
                  <View
                    key={c.id || i}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
                        {c.type.toUpperCase()}: {c.target.street ?? c.target.zone ?? c.target.area ?? "—"}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{c.reason}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setConfirmedConstraints((prev) => prev.filter((_, idx) => idx !== i))}
                      hitSlop={8}
                    >
                      <Text style={{ color: colors.muted, fontSize: 18 }}>x</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Route Report */}
        <RouteReport />

        {/* Advanced Section Toggle */}
        <TouchableOpacity
          onPress={() => {
            hapticImpact();
            setShowAdvanced(!showAdvanced);
          }}
          className="flex-row items-center justify-between py-3 mb-4"
        >
          <Text className="text-base font-semibold text-foreground">
            Advanced Options
          </Text>
          <Text style={{ color: colors.primary }}>
            {showAdvanced ? "Hide ▲" : "Show ▼"}
          </Text>
        </TouchableOpacity>

        {showAdvanced && (
          <>
            {/* Route Comparison */}
            <RouteComparison />

            {/* Export Options */}
            <ExportOptions collectionPoints={collectionPoints} />
          </>
        )}

        {/* Training library: load GPX from D:\gpx_training (when GPX_TRAINING_PATH set) */}
        <GpxTrainingLibrary />

        {/* GPX Export (always visible). Pass state.gpxData so export always has latest after generate. */}
        <GPXExport gpxDataFromParent={state.gpxData} />

        {/* Bottom Spacing */}
        <View className="h-8" />
      </ScrollView>
    </ScreenContainer>
  );
}
