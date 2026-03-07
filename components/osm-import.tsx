import { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { impactAsync as hapticImpact, notificationAsync as hapticNotification, NotificationFeedbackType } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useCustomStartPoint } from "@/hooks/useCustomStartPoint";
import { ImportProgress, ImportResult } from "@/lib/osm-parser";
import { osmDataToStored, type StoredOSMData } from "@/lib/osm-storage";
import { OSMParser, RouteOptimizer } from "@/lib/route-optimizer-v2";
import { useRouteOptimization } from "@/hooks/useRouteOptimization";
import { useBetaFeatures } from "@/context/BetaFeaturesContext";
import { debug } from "@/lib/route-optimizer-v2/debug";
import { CollectionPoint } from "@/types";
import { readFileAsText } from "@/lib/readFileAsText";
import { saveOSMFile } from "@/lib/osm-file-library";
import { parseGeoJSON, importGeoJSONRoute } from "@/lib/geojson-import";
import { optimizeFromGeoJSON, RouteOptimizerSimpleV2 } from "@/lib/offline-optimizer-v2";
import { pruneRouteLoops } from "@/lib/route-loop-pruner";

interface OSMImportProps {
  onImportComplete: (
    points: CollectionPoint[],
    osmData?: StoredOSMData,
    options?: { totalDistanceKm?: number }
  ) => void;
  /** When true, GeoJSON imports use the offline v2 optimizer instead of the backend. */
  useOfflineOptimizerV2?: boolean;
}

export function OSMImport({ onImportComplete, useOfflineOptimizerV2 = false }: OSMImportProps) {
  const colors = useColors();
  const customStartPoint = useCustomStartPoint();
  const { optimizeRoute } = useRouteOptimization();
  const { isExperimentalRoute } = useBetaFeatures();
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importSource, setImportSource] = useState<"osm" | "geojson" | null>(null);

  const handleGeoJSONImport = useCallback(async (content: string, fileName: string) => {
    setImportSource("geojson");
    setProgress({ stage: "parsing", progress: 30, message: "Parsing GeoJSON..." });

    const geojson = parseGeoJSON(content);

    const lineStringCount = geojson.features.filter(
      (f) => f.geometry && (f.geometry as Record<string, unknown>).type === "LineString"
    ).length;

    // Calculate bounds from GeoJSON coordinates
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const feature of geojson.features) {
      if (!feature.geometry) continue;
      const geom = feature.geometry as any;
      let coords: number[][] = [];
      if (geom.type === "Point") {
        coords = [geom.coordinates];
      } else if (geom.type === "LineString") {
        coords = geom.coordinates;
      } else if (geom.type === "Polygon") {
        coords = geom.coordinates[0] || [];
      } else if (geom.type === "MultiLineString") {
        coords = geom.coordinates.flat();
      } else if (geom.type === "MultiPolygon") {
        coords = geom.coordinates.flat(2);
      }
      for (const c of coords) {
        if (Array.isArray(c) && c.length >= 2) {
          const [lon, lat] = c;
          if (typeof lon === "number" && typeof lat === "number") {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
          }
        }
      }
    }
    const geojsonBounds = (minLat !== Infinity && maxLat !== -Infinity)
      ? { minLat, maxLat, minLon, maxLon }
      : { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };

    debug("OSMImport.geojson", {
      totalFeatures: geojson.features.length,
      lineStrings: lineStringCount,
      bounds: geojsonBounds,
    });

    if (geojson.features.length === 0) {
      throw new Error("GeoJSON file contains no features");
    }

    setProgress({ stage: "parsing", progress: 50, message: useOfflineOptimizerV2 ? "Running offline optimizer (v2)..." : "Sending to route optimizer..." });

    const startCoords = customStartPoint.getStartPoint();

    const geoJSONResult = useOfflineOptimizerV2
      ? (() => {
          const opt = optimizeFromGeoJSON(geojson, {
            customLat: startCoords?.latitude,
            customLon: startCoords?.longitude,
          });
          return {
            collectionPoints: opt.route.map((p, i) => ({
              id: (p as { nodeId?: string }).nodeId ?? `route-${i}`,
              address: `Stop ${i + 1}`,
              latitude: p.latitude,
              longitude: p.longitude,
              collectionType: "residential" as const,
              status: "pending" as const,
            })),
            totalDistanceKm: opt.totalDistance,
            stats: { nodesInGraph: 0, edgesInGraph: 0 },
          };
        })()
      : await importGeoJSONRoute(geojson, {
          startLat: startCoords?.latitude,
          startLon: startCoords?.longitude,
          turnPenalties: customStartPoint.state.configuration.turnPenalties
            ? {
                leftTurn: customStartPoint.state.configuration.turnPenalties.leftTurn,
                uTurn: customStartPoint.state.configuration.turnPenalties.uTurn,
                rightTurn: customStartPoint.state.configuration.turnPenalties.rightTurn,
              }
            : undefined,
        });

    setProgress({ stage: "parsing", progress: 80, message: "Building route points..." });
    setProgress({ stage: "complete", progress: 100, message: "Import complete!" });

    const importResult: ImportResult = {
      success: true,
      collectionPoints: geoJSONResult.collectionPoints,
      statistics: {
        totalNodes: geoJSONResult.stats.nodesInGraph,
        totalWays: geoJSONResult.stats.edgesInGraph,
        extractedPoints: geoJSONResult.collectionPoints.length,
        bounds: geojsonBounds,
      },
      errors: [],
    };
    setResult(importResult);

    if (geoJSONResult.collectionPoints.length > 0) {
      hapticNotification(NotificationFeedbackType.Success);
      onImportComplete(geoJSONResult.collectionPoints, undefined, {
        totalDistanceKm: geoJSONResult.totalDistanceKm,
      });
    }

  }, [onImportComplete, customStartPoint]);

  const handleFilePick = useCallback(async () => {
    try {
      hapticImpact();

      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/xml", "text/xml", "application/json", "application/geo+json", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const file = result.assets[0];
      if (!file?.uri) {
        Alert.alert("Import Error", "File URI not available");
        return;
      }

      const fileName = (file.name ?? "").toLowerCase();
      const isGeoJSON = fileName.endsWith(".geojson") || fileName.endsWith(".json");
      const isOSM = fileName.endsWith(".osm") || fileName.endsWith(".xml");

      if (!isGeoJSON && !isOSM) {
        Alert.alert(
          "Invalid File",
          "Please select an OSM file (.osm, .xml) or GeoJSON file (.geojson, .json)"
        );
        return;
      }

      setIsImporting(true);
      setProgress({ stage: "parsing", progress: 0, message: "Reading file..." });

      let content: string;
      try {
        // Native (iOS/Android): use only FileSystem by URI. Web: use File or fetch->blob->readFileAsText. Never call file.text() or response.text().
        if (Platform.OS !== "web") {
          content = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.UTF8,
          });
        } else {
          const assetWithFile = file as { file?: File; uri?: string };
          if (assetWithFile.file && typeof (assetWithFile.file as Blob).slice === "function") {
            content = await readFileAsText(assetWithFile.file);
          } else if (file.uri) {
            const response = await fetch(file.uri);
            if (typeof (response as { blob?: () => Promise<Blob> }).blob !== "function") {
              throw new Error("Cannot read file: response.blob is not available");
            }
            const blob = await (response as { blob: () => Promise<Blob> }).blob();
            content = await readFileAsText(blob);
          } else {
            throw new Error("No file or URI available to read");
          }
        }
      } catch (readError) {
        const msg = readError instanceof Error ? readError.message : String(readError);
        if (msg.includes("text") && (msg.includes("not a function") || msg.includes("undefined"))) {
          Alert.alert(
            "Import Error",
            "This environment cannot read the file. Try using the app on a different device or update the app. (Avoids unsupported file API.)"
          );
        }
        throw readError;
      }

      // Branch: GeoJSON files go to the Python/FastAPI optimizer backend
      if (isGeoJSON) {
        await handleGeoJSONImport(content, file.name ?? "import.geojson");
        return;
      }

      // OSM XML: parse → edge doubling → Hierholzer with turn optimization
      setImportSource("osm");
      setProgress({ stage: "parsing", progress: 30, message: "Parsing OSM data..." });

      const parser = new OSMParser();
      const { nodes, ways, turnRestrictions } = parser.parseOSM(content);
      debug("OSMImport.parse", { nodesSize: nodes.size, waysCount: ways.length });

      // Save to persistent OSM library (fire-and-forget)
      const displayName = (file.name ?? "import").replace(/\.(osm|xml)$/i, "");
      const fileBounds = (() => {
        if (nodes.size === 0) return undefined;
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        for (const n of nodes.values()) {
          minLat = Math.min(minLat, n.lat); maxLat = Math.max(maxLat, n.lat);
          minLon = Math.min(minLon, n.lon); maxLon = Math.max(maxLon, n.lon);
        }
        return { minLat, maxLat, minLon, maxLon };
      })();
      saveOSMFile(content, {
        name: displayName,
        wayCount: ways.length,
        nodeCount: nodes.size,
        bounds: fileBounds,
      }).catch((err) => {
        console.warn("[OSMLibrary] Save to library failed:", err instanceof Error ? err.message : err);
      });

      const startCoords = customStartPoint.getStartPoint();

      debug("OSMImport.startPoint", {
        hasStartPoint: customStartPoint.hasStartPoint,
        coordinates: startCoords,
      });

      setProgress({
        stage: "parsing",
        progress: 50,
        message: nodes.size > 5000
          ? "Building graph & optimizing... (large file, may take 1–2 min)"
          : "Building graph & optimizing route...",
      });

      // Yield so React can paint the 50% progress before CPU-heavy optimisation.
      await new Promise<void>((r) => setTimeout(r, 100));

      // Heartbeat: update message every 15s while optimization runs (large OSM can take 1–2 min)
      const heartbeat = setInterval(() => {
        setProgress((prev) =>
          prev?.stage === "parsing" && prev.progress === 50
            ? { ...prev, message: `Still optimizing... (${nodes.size.toLocaleString()} nodes)` }
            : prev
        );
      }, 15000);

      let optResult: any;
      try {
        const onewayMode = customStartPoint.state.configuration.onewayMode ?? "B";
        const turnPenalties = customStartPoint.state.configuration.turnPenalties;
        const serviceBothSides = customStartPoint.state.configuration.serviceBothSides ?? false;

        // When "Use offline optimizer (v2)" is on, use same optimizer as Videos app (RouteOptimizerSimpleV2). Do not prune — correct Eulerian output.
        if (useOfflineOptimizerV2) {
          try {
            setProgress({ stage: "parsing", progress: 50, message: "Running offline optimizer (v2)..." });
            await new Promise<void>((r) => setTimeout(r, 0));
            const v2 = new RouteOptimizerSimpleV2(nodes, ways);
            optResult = v2.optimize(startCoords?.latitude, startCoords?.longitude);
            // Do not run pruneRouteLoops on v2 output; it can merge distinct segments (precision) and create broken routes.
          } catch (e) {
            debug("OSMImport.offlineV2", { failed: (e as Error).message });
            optResult = undefined;
          }
        }

        if (optResult === undefined) {
          const stepLabels: Record<string, string> = {
            "street-edges": "Converting streets...",
            "turn-graph": "Building turn graph...",
            "build-graph": "Building turn graph...",
            "scc": "Analyzing connectivity...",
            "bridge": "Connecting components...",
            "eulerian": "Balancing graph...",
            "circuit": "Computing optimal circuit...",
            "route-points": "Generating route points...",
          };

          optResult = isExperimentalRoute
            ? await optimizeRoute(nodes, ways, {
                customLat: startCoords?.latitude,
                customLon: startCoords?.longitude,
                turnPenalties,
                onewayMode,
                turnRestrictions: turnRestrictions ?? [],
                serviceBothSides,
                onProgress: (step) => {
                  const label = stepLabels[step] ?? "Optimizing...";
                  setProgress({ stage: "parsing", progress: 50, message: label });
                },
              })
            : await new Promise<any>((resolve, reject) => {
                setTimeout(() => {
                  try {
                    const optimizer = new RouteOptimizer(nodes, ways, onewayMode, turnRestrictions ?? [], undefined, { serviceBothSides, antiLoopMode: "strict" });
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
      } finally {
        clearInterval(heartbeat);
      }

      setProgress({ stage: "parsing", progress: 80, message: "Building route points..." });

      const collectionPoints: CollectionPoint[] = optResult.route.map(
        (p: { latitude: number; longitude: number; nodeId?: string }, i: number) => ({
        id: p.nodeId ?? `route-${i}`,
        address: `Stop ${i + 1}`,
        latitude: p.latitude,
        longitude: p.longitude,
        collectionType: "residential",
        status: "pending",
      }));

      const bounds = (() => {
        if (nodes.size === 0) return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
        let minLat = 90;
        let maxLat = -90;
        let minLon = 180;
        let maxLon = -180;
        for (const node of nodes.values()) {
          minLat = Math.min(minLat, node.lat);
          maxLat = Math.max(maxLat, node.lat);
          minLon = Math.min(minLon, node.lon);
          maxLon = Math.max(maxLon, node.lon);
        }
        return { minLat, maxLat, minLon, maxLon };
      })();

      setProgress({ stage: "complete", progress: 100, message: "Import complete!" });

      const importResult: ImportResult = {
        success: true,
        collectionPoints,
        statistics: {
          totalNodes: nodes.size,
          totalWays: ways.length,
          extractedPoints: collectionPoints.length,
          bounds,
        },
        errors: optResult.route.length === 0 ? [optResult.message] : [],
      };
      setResult(importResult);

      debug("OSMImport.result", {
        collectionPointsLength: collectionPoints.length,
        importResultSuccess: importResult.success,
        willCallOnImportComplete: collectionPoints.length > 0,
        errors: importResult.errors,
      });

      if (collectionPoints.length > 0) {
        hapticNotification(NotificationFeedbackType.Success);
        const osmData = osmDataToStored(nodes, ways, turnRestrictions ?? []);
        onImportComplete(collectionPoints, osmData, {
          totalDistanceKm: optResult.totalDistance,
        });
      } else if (importResult.errors.length > 0) {
        hapticNotification(NotificationFeedbackType.Error);
        Alert.alert("Import Issues", importResult.errors.join("\n"));
      }
    } catch (error) {
      hapticNotification(NotificationFeedbackType.Error);
      Alert.alert(
        "Import Error",
        error instanceof Error ? error.message : "Failed to import file"
      );
      setProgress({ stage: "error", progress: 0, message: "Import failed" });
    } finally {
      setIsImporting(false);
    }
  }, [onImportComplete, customStartPoint, optimizeRoute, isExperimentalRoute, useOfflineOptimizerV2]);

  const getProgressColor = () => {
    switch (progress?.stage) {
      case "complete":
        return colors.success;
      case "error":
        return colors.error;
      default:
        return colors.primary;
    }
  };

  return (
    <View
      className="bg-surface rounded-2xl p-4 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-2">
        Road Data Import
      </Text>
      <Text className="text-sm text-muted mb-4">
        Import OSM or GeoJSON road data to generate optimized collection routes
      </Text>

      {/* File Picker Button */}
      <TouchableOpacity
        onPress={handleFilePick}
        disabled={isImporting}
        className="py-3 px-4 rounded-xl items-center mb-4"
        style={{
          backgroundColor: isImporting ? colors.muted + "40" : colors.primary,
          opacity: isImporting ? 0.7 : 1,
        }}
      >
        <Text className="font-semibold" style={{ color: "#fff" }}>
          {isImporting ? "Importing..." : "Select OSM File (.osm, .xml) or GeoJSON (.geojson, .json)"}
        </Text>
      </TouchableOpacity>

      {/* Progress Bar */}
      {progress && (
        <View className="mb-4">
          <View className="flex-row justify-between mb-2">
            <Text className="text-sm text-muted">{progress.message}</Text>
            <Text className="text-sm text-muted">{progress.progress}%</Text>
          </View>
          <View
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: colors.border }}
          >
            <View
              className="h-full rounded-full"
              style={{
                width: `${progress.progress}%`,
                backgroundColor: getProgressColor(),
              }}
            />
          </View>
        </View>
      )}

      {/* Import Statistics */}
      {result && result.success && (
        <View
          className="p-3 rounded-xl"
          style={{ backgroundColor: colors.success + "15" }}
        >
          <Text
            className="text-sm font-semibold mb-2"
            style={{ color: colors.success }}
          >
            Import Successful
          </Text>
          <View className="flex-row flex-wrap gap-4">
            <View>
              <Text className="text-xs text-muted">Nodes</Text>
              <Text className="text-sm font-medium text-foreground">
                {result.statistics.totalNodes.toLocaleString()}
              </Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Ways</Text>
              <Text className="text-sm font-medium text-foreground">
                {result.statistics.totalWays.toLocaleString()}
              </Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Points Extracted</Text>
              <Text className="text-sm font-medium text-foreground">
                {result.statistics.extractedPoints}
              </Text>
            </View>
          </View>
          {result.statistics.bounds && (
            <View className="mt-3">
              <Text className="text-xs text-muted mb-1">
                Bounds {result.statistics.bounds.minLat === 0 && result.statistics.bounds.maxLat === 0 
                  ? "(no data)" 
                  : importSource === "geojson" 
                    ? "(from feature coordinates)" 
                    : "(from node coordinates)"}
              </Text>
              <Text className="text-xs text-foreground">
                {result.statistics.bounds.minLat.toFixed(4)}°N to{" "}
                {result.statistics.bounds.maxLat.toFixed(4)}°N
              </Text>
              <Text className="text-xs text-foreground">
                {result.statistics.bounds.minLon.toFixed(4)}°E to{" "}
                {result.statistics.bounds.maxLon.toFixed(4)}°E
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Error Display */}
      {result && !result.success && result.errors.length > 0 && (
        <View
          className="p-3 rounded-xl"
          style={{ backgroundColor: colors.error + "15" }}
        >
          <Text
            className="text-sm font-semibold mb-2"
            style={{ color: colors.error }}
          >
            Import Failed
          </Text>
          {result.errors.map((error, index) => (
            <Text key={index} className="text-xs text-muted">
              • {error}
            </Text>
          ))}
        </View>
      )}

      {/* Supported Formats */}
      <View className="mt-4 pt-4 border-t border-border">
        <Text className="text-xs text-muted mb-2">Supported Formats:</Text>
        <View className="flex-row flex-wrap gap-2">
          <View
            className="px-2 py-1 rounded"
            style={{ backgroundColor: colors.primary + "20" }}
          >
            <Text className="text-xs" style={{ color: colors.primary }}>
              .osm
            </Text>
          </View>
          <View
            className="px-2 py-1 rounded"
            style={{ backgroundColor: colors.primary + "20" }}
          >
            <Text className="text-xs" style={{ color: colors.primary }}>
              .xml
            </Text>
          </View>
          <View
            className="px-2 py-1 rounded"
            style={{ backgroundColor: colors.primary + "20" }}
          >
            <Text className="text-xs" style={{ color: colors.primary }}>
              .geojson
            </Text>
          </View>
          <View
            className="px-2 py-1 rounded"
            style={{ backgroundColor: colors.primary + "20" }}
          >
            <Text className="text-xs" style={{ color: colors.primary }}>
              .json
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
