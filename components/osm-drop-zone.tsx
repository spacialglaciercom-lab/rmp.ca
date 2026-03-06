import { useState, useCallback, useEffect } from "react";
import { View, Text, Platform } from "react-native";
import { notificationAsync as hapticNotification, NotificationFeedbackType } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useCustomStartPoint } from "@/hooks/useCustomStartPoint";
import { ImportProgress, ImportResult } from "@/lib/osm-parser";
import { osmDataToStored, type StoredOSMData } from "@/lib/osm-storage";
import { OSMParser, RouteOptimizer } from "@/lib/route-optimizer-v2";
import { useRouteOptimization } from "@/hooks/useRouteOptimization";
import { useBetaFeatures } from "@/context/BetaFeaturesContext";
import { CollectionPoint } from "@/types";
import { readFileAsText as readFileAsTextLib } from "@/lib/readFileAsText";

/** Web-only fallback if readFileAsText import is undefined. Uses FileReader only — never file.text(). */
function readFileAsTextFallback(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("FileReader not available"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file, "UTF-8");
  });
}

interface OSMDropZoneProps {
  onImportComplete: (
    points: CollectionPoint[],
    osmData?: StoredOSMData,
    options?: { totalDistanceKm?: number }
  ) => void;
  children?: React.ReactNode;
}

export function OSMDropZone({ onImportComplete, children }: OSMDropZoneProps) {
  const colors = useColors();
  const customStartPoint = useCustomStartPoint();
  const { optimizeRoute } = useRouteOptimization();
  const { isExperimentalRoute } = useBetaFeatures();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isWeb = Platform.OS === "web";

  const handleFile = useCallback(
    async (file: File) => {
      if (!file) {
        setError("No file provided");
        return;
      }
      const fileName = (file.name ?? "").toLowerCase();
      if (!fileName.endsWith(".osm") && !fileName.endsWith(".xml")) {
        setError("Please drop an OSM file (.osm or .xml)");
        return;
      }

      setIsProcessing(true);
      setError(null);
      setProgress({ stage: "parsing", progress: 0, message: "Reading file..." });

      try {
        // Use readFileAsText from lib (never calls file.text()); fallback if import is undefined (e.g. bundler)
        const readFn =
          typeof readFileAsTextLib === "function"
            ? readFileAsTextLib
            : (f: File | Blob) => readFileAsTextFallback(f);
        const content = await readFn(file);
        setProgress({ stage: "parsing", progress: 30, message: "Parsing OSM..." });

        const parser = new OSMParser();
        const { nodes, ways, turnRestrictions } = parser.parseOSM(content);

        const startCoords = customStartPoint.getStartPoint();

        setProgress({ stage: "parsing", progress: 50, message: "Optimizing route..." });

        // Yield so browser can paint progress before CPU-heavy work
        await new Promise<void>((r) => setTimeout(r, 0));

        const onewayMode = customStartPoint.state.configuration.onewayMode ?? "B";
        const turnPenalties = customStartPoint.state.configuration.turnPenalties;
        const serviceBothSides = customStartPoint.state.configuration.serviceBothSides ?? false;

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

        const optResult = isExperimentalRoute
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
                  const optimizer = new RouteOptimizer(nodes, ways, onewayMode, turnRestrictions ?? [], undefined, { serviceBothSides });
                  resolve(optimizer.optimize(startCoords?.latitude, startCoords?.longitude, turnPenalties));
                } catch (err) { reject(err); }
              }, 0);
            });

        const collectionPoints: CollectionPoint[] = optResult.route.map((p, i) => ({
          id: (p as { nodeId?: string }).nodeId ?? `route-${i}`,
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

        setProgress({ stage: "complete", progress: 100, message: "Done" });

        const importResult: ImportResult = {
          success: optResult.route.length > 0,
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

        if (importResult.success && importResult.collectionPoints.length > 0) {
          hapticNotification(NotificationFeedbackType.Success);
          const osmData = osmDataToStored(nodes, ways, turnRestrictions ?? []);
          onImportComplete(importResult.collectionPoints, osmData, {
            totalDistanceKm: optResult.totalDistance,
          });
        } else if (importResult.errors.length > 0) {
          setError(importResult.errors.join("\n"));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import file");
      } finally {
        setIsProcessing(false);
      }
    },
    [onImportComplete, customStartPoint, isExperimentalRoute, optimizeRoute]
  );

  useEffect(() => {
    if (!isWeb) return;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Only set to false if we're leaving the window
      if (e.relatedTarget === null) {
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        await handleFile(file);
      }
    };

    // Add event listeners to the document
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [isWeb, handleFile]);

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
    <View className="flex-1" style={{ pointerEvents: "box-none" }}>
      {/* Drag Overlay - only shown when dragging on web */}
      {isWeb && isDragging && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.primary + "20",
            borderWidth: 3,
            borderColor: colors.primary,
            borderStyle: "dashed",
            zIndex: 1000,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              padding: 32,
              borderRadius: 16,
              alignItems: "center",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.2,
              shadowRadius: 8,
            }}
          >
            <Text
              style={{
                fontSize: 48,
                marginBottom: 16,
              }}
            >
              📂
            </Text>
            <Text
              style={{
                fontSize: 24,
                fontWeight: "bold",
                color: colors.primary,
                marginBottom: 8,
              }}
            >
              Drop OSM File Here
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: colors.muted,
              }}
            >
              Supports .osm and .xml files
            </Text>
          </View>
        </View>
      )}

      {/* Processing Overlay */}
      {isProcessing && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 1001,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              padding: 24,
              borderRadius: 16,
              width: "80%",
              maxWidth: 400,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: "bold",
                color: colors.foreground,
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              Importing OSM Data...
            </Text>

            {progress && (
              <>
                <Text
                  style={{
                    fontSize: 14,
                    color: colors.muted,
                    marginBottom: 8,
                  }}
                >
                  {progress.message}
                </Text>
                <View
                  style={{
                    height: 8,
                    backgroundColor: colors.border,
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: "100%",
                      width: `${progress.progress}%`,
                      backgroundColor: getProgressColor(),
                      borderRadius: 4,
                    }}
                  />
                </View>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.muted,
                    marginTop: 8,
                    textAlign: "right",
                  }}
                >
                  {progress.progress}%
                </Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* Main Content */}
      {children}
    </View>
  );
}
