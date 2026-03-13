/**
 * Overture Extractor panel: polygon points, road class selection, GeoJSON extraction,
 * optimize route via Python/FastAPI Chinese Postman backend, results display.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  calculateArea,
  calculatePathDistance,
  getSegmentDistances,
  type LatLonPoint,
} from "@/lib/overpassService";
import { shareGeoJSON } from "@/lib/exportService";
import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import {
  healthCheck,
  validateGeoJSON,
  filterGeoJSON,
  type GeoJSONFeatureCollection,
  type OptimizeResponse,
} from "@/services/overtureOptimizerService";
import {
  connectAndExtract,
  httpGeoJSONUrl,
  coordsToPolygonFeature,
  type ExtractionProgress,
} from "@/lib/overtureExtractService";
import {
  extractFromDownloadedData,
  findRegionForPolygon,
  filterGeoJSONLocal,
} from "@/lib/offline-extract";
import { getPlugin } from "@/lib/plugins/registry";
import { ExtractConnectionStatus } from "@/components/extract/ExtractConnectionStatus";

const MIN_POINTS = 3;

const ROAD_CLASSES = [
  { key: "residential", label: "Residential" },
  { key: "tertiary", label: "Tertiary" },
  { key: "secondary", label: "Secondary" },
  { key: "unclassified", label: "Unclassified" },
  { key: "living_street", label: "Living Street" },
  { key: "service", label: "Service" },
] as const;

/** Optionally include these; default is OFF (excluded). Toggle ON to include in route. */
const OPTIONAL_EXCLUDE_CLASSES = [
  {
    key: "motorways",
    label: "Motorways",
    classes: ["motorway", "motorway_link"],
  },
  {
    key: "highways",
    label: "Highways",
    classes: ["trunk", "trunk_link", "primary", "primary_link"],
  },
  { key: "driveways", label: "Driveways", classes: ["driveway"] },
  { key: "service_roads", label: "Service Roads", classes: ["service"] },
] as const;

function formatArea(areaKm2: number): string {
  if (areaKm2 >= 1) return `${areaKm2.toFixed(3)} km²`;
  return `${(areaKm2 * 1_000_000).toFixed(2)} m²`;
}

export interface OvertureExtractorContentProps {
  points: LatLonPoint[];
  onClearPoints: () => void;
  onOptimizeRoute: (
    geojson: GeoJSONFeatureCollection,
    options?: {
      startLat?: number;
      startLon?: number;
      roadClasses?: string[];
      serviceBothSides?: boolean;
    },
  ) => void;
  optimizing?: boolean;
  optimizationStatus?: string;
  lastResult?: OptimizeResponse | null;
}

export function OvertureExtractorContent({
  points = [],
  onClearPoints,
  onOptimizeRoute,
  optimizing = false,
  optimizationStatus = "",
  lastResult = null,
}: OvertureExtractorContentProps) {
  const safePoints = points ?? [];
  const colors = useColors();
  const primaryBlue = colors.primary ?? "#3b82f6";
  const { state: routingState, dispatch: routingDispatch } = useRouting();

  const [selectedRoadClasses, setSelectedRoadClasses] = useState<string[]>([
    "residential",
    "tertiary",
    "secondary",
    "unclassified",
  ]);
  /** Optional: include these classes (default OFF = excluded). */
  const [optionalIncluded, setOptionalIncluded] = useState<
    Record<string, boolean>
  >({
    motorways: false,
    highways: false,
    driveways: false,
    service_roads: false,
  });
  const [loadedGeoJSON, setLoadedGeoJSON] =
    useState<GeoJSONFeatureCollection | null>(null);
  const [geoJSONInfo, setGeoJSONInfo] = useState<{
    featureCount: number;
    roadClasses: Record<string, number>;
    valid: boolean;
    warnings: string[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [extractProgress, setExtractProgress] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [showResults, setShowResults] = useState(false);

  /** Effective road_classes for API: main selection + optional (excluded-by-default) when toggled ON. */
  const effectiveRoadClasses = [
    ...selectedRoadClasses,
    ...OPTIONAL_EXCLUDE_CLASSES.flatMap(({ key, classes }) =>
      optionalIncluded[key] ? classes : [],
    ),
  ];

  const checkBackend = useCallback(async () => {
    const ok = await healthCheck();
    setBackendOnline(ok);
    if (!ok) {
      Alert.alert(
        "Backend Offline",
        "The route optimizer service is not reachable. Make sure the Python backend is running (python -m backend.main).",
      );
    }
    return ok;
  }, []);

  const runOfflineExtract = useCallback(
    async (
      polygon: GeoJSON.Feature<GeoJSON.Polygon>,
      polygonForFilter: { lat: number; lon: number }[],
    ) => {
      const result = await extractFromDownloadedData(polygon.geometry, (p) =>
        setExtractProgress(
          p.total != null ? `${p.phase} (${p.done}/${p.total})` : p.phase,
        ),
      );
      if (!result) return false;
      setExtractProgress("Filtering road classes…");
      let filtered: {
        geojson: GeoJSONFeatureCollection;
        feature_count: number;
        road_class_counts: Record<string, number>;
      };
      try {
        filtered = await filterGeoJSON({
          geojson: result.geojson,
          polygon: polygonForFilter,
          road_classes: effectiveRoadClasses,
        });
      } catch {
        filtered = filterGeoJSONLocal({
          geojson: result.geojson,
          polygon: polygonForFilter,
          road_classes: effectiveRoadClasses,
        });
      }
      const sourceLabel =
        result.source === "r2"
          ? "R2 tiles"
          : result.source === "s3"
            ? "S3 Parquet"
            : "OSM PBF";
      setGeoJSONInfo({
        featureCount: filtered.feature_count,
        roadClasses: filtered.road_class_counts ?? {},
        valid: filtered.feature_count > 0,
        warnings:
          filtered.feature_count === 0
            ? ["No road features match the selected road classes in this area"]
            : [
                `Extracted ${filtered.feature_count} road features from offline ${sourceLabel} (${result.regionName})`,
              ],
      });
      setLoadedGeoJSON(filtered.geojson);
      return true;
    },
    [effectiveRoadClasses],
  );

  const handleExtractGeoJSON = useCallback(async () => {
    if (safePoints.length < MIN_POINTS) {
      Alert.alert(
        "Polygon Required",
        `Draw at least ${MIN_POINTS} points on the map to define the extraction area.`,
      );
      return () => {};
    }

    const polygonCoords: [number, number][] = safePoints.map((p) => [
      p.longitude,
      p.latitude,
    ]);
    const polygon = coordsToPolygonFeature(polygonCoords);
    const polygonForFilter = safePoints.map((p) => ({
      lat: p.latitude,
      lon: p.longitude,
    }));

    setIsLoading(true);

    // Offline-first: if we have downloaded data (R2, S3, or OSM PBF) for this area, use it so extract works offline.
    setExtractProgress("Checking for offline data…");
    const region = await findRegionForPolygon(polygonCoords);
    if (region) {
      setExtractProgress("Using offline data (R2/S3/OSM PBF)…");
      try {
        const ok = await runOfflineExtract(polygon, polygonForFilter);
        if (ok) {
          setIsLoading(false);
          setExtractProgress(null);
          return () => {};
        }
      } catch {
        // Fall through to try online
      }
    }

    setExtractProgress("Connecting...");

    const tryOfflineThenAlert = async (error: string) => {
      // On web, we cannot do offline extraction. Just show the error.
      if (Platform.OS === "web") {
        console.error("Extraction error:", error);
        alert(`Extraction Failed:\n${error}\n\nCheck browser console for details (F12).`);
        setIsLoading(false);
        setExtractProgress(null);
        return;
      }

      setExtractProgress("Trying offline (R2/S3/OSM PBF)…");
      try {
        const ok = await runOfflineExtract(polygon, polygonForFilter);
        if (!ok) {
          Alert.alert(
            "Extraction Failed",
            `${error}\n\nTo extract offline, download map data in Settings → Offline Map Download (R2 Tiles, S3 Parquet, or OSM PBF) for a region that covers this area.`,
          );
        }
      } catch (offlineErr) {
        Alert.alert(
          "Extraction Failed",
          `${error}\n\nOffline fallback failed: ${offlineErr instanceof Error ? offlineErr.message : String(offlineErr)}. Download R2 Tiles, S3 Parquet, or OSM PBF in Settings for this region to extract offline.`,
        );
      } finally {
        setIsLoading(false);
        setExtractProgress(null);
      }
    };

    // Use overture-extraction plugin when available (cached extracts, same GeoJSON path).
    const plugin = getPlugin("overture-extraction");
    const extractor = plugin?.getFeatures()?.extractor as
      | ((
          polygon: GeoJSON.Feature<GeoJSON.Polygon>,
          theme?: string,
        ) => Promise<{ geojson: GeoJSONFeatureCollection; warnings: string[] }>)
      | undefined;
    if (extractor) {
      try {
        setExtractProgress("Extracting…");
        const result = await extractor(polygon, "roads");
        setExtractProgress("Loading road data...");
        const rawGeojson = result.geojson as GeoJSONFeatureCollection;
        if (!rawGeojson?.features?.length) {
          setGeoJSONInfo({
            featureCount: 0,
            roadClasses: {},
            valid: false,
            warnings: result.warnings.length
              ? result.warnings
              : ["No road features found in the extraction area"],
          });
          setLoadedGeoJSON({ type: "FeatureCollection", features: [] });
          setIsLoading(false);
          setExtractProgress(null);
          return () => {};
        }
        let filtered: {
          geojson: GeoJSONFeatureCollection;
          feature_count: number;
          road_class_counts: Record<string, number>;
        };
        try {
          filtered = await filterGeoJSON({
            geojson: rawGeojson,
            polygon: polygonForFilter,
            road_classes: effectiveRoadClasses,
          });
        } catch {
          filtered = filterGeoJSONLocal({
            geojson: rawGeojson,
            polygon: polygonForFilter,
            road_classes: effectiveRoadClasses,
          });
        }
        setGeoJSONInfo({
          featureCount: filtered.feature_count,
          roadClasses: filtered.road_class_counts ?? {},
          valid: filtered.feature_count > 0,
          warnings:
            filtered.feature_count === 0
              ? [
                  "No road features match the selected road classes in this area",
                ]
              : [
                  ...result.warnings,
                  `Extracted ${filtered.feature_count} road features from Overture Maps`,
                ].filter(Boolean),
        });
        setLoadedGeoJSON(filtered.geojson);
      } catch (err) {
        tryOfflineThenAlert(
          err instanceof Error ? err.message : "Extraction failed.",
        );
        return () => {};
      } finally {
        setIsLoading(false);
        setExtractProgress(null);
      }
      return () => {};
    }

    const handle = connectAndExtract(
      polygon,
      (progress: ExtractionProgress) => {
        setExtractProgress(progress.message);
      },
      async (hash, _stats) => {
        try {
          setExtractProgress("Loading road data...");
          const url = httpGeoJSONUrl(hash);
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Failed to load GeoJSON: ${res.status}`);
          }
          const rawGeojson = (await res.json()) as GeoJSONFeatureCollection;
          if (!rawGeojson?.features?.length) {
            setGeoJSONInfo({
              featureCount: 0,
              roadClasses: {},
              valid: false,
              warnings: ["No road features found in the extraction area"],
            });
            setLoadedGeoJSON({ type: "FeatureCollection", features: [] });
            return;
          }
          let filtered: {
            geojson: GeoJSONFeatureCollection;
            feature_count: number;
            road_class_counts: Record<string, number>;
          };
          try {
            filtered = await filterGeoJSON({
              geojson: rawGeojson,
              polygon: polygonForFilter,
              road_classes: effectiveRoadClasses,
            });
          } catch {
            filtered = filterGeoJSONLocal({
              geojson: rawGeojson,
              polygon: polygonForFilter,
              road_classes: effectiveRoadClasses,
            });
          }
          setGeoJSONInfo({
            featureCount: filtered.feature_count,
            roadClasses: filtered.road_class_counts ?? {},
            valid: filtered.feature_count > 0,
            warnings:
              filtered.feature_count === 0
                ? [
                    "No road features match the selected road classes in this area",
                  ]
                : [
                    `Extracted ${filtered.feature_count} road features from Overture Maps`,
                  ],
          });
          setLoadedGeoJSON(filtered.geojson);
        } catch (err) {
          Alert.alert(
            "Extraction Failed",
            err instanceof Error
              ? err.message
              : "Could not load or filter road data.",
          );
        } finally {
          setIsLoading(false);
          setExtractProgress(null);
        }
      },
      (error) => {
        tryOfflineThenAlert(error);
      },
      "roads",
    );

    // Allow cancel on unmount or user action if we add a cancel button
    return () => handle.cancel();
  }, [checkBackend, safePoints, effectiveRoadClasses, runOfflineExtract]);

  const toggleRoadClass = (key: string) => {
    setSelectedRoadClasses((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key],
    );
  };

  const toggleOptionalInclude = (key: string) => {
    setOptionalIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleOptimize = useCallback(async () => {
    if (!loadedGeoJSON) {
      Alert.alert("No Data", "Extract GeoJSON first.");
      return;
    }

    const online = await checkBackend();
    if (!online) return;

    onOptimizeRoute(loadedGeoJSON, {
      roadClasses: effectiveRoadClasses,
    });
    setShowResults(true);
  }, [
    loadedGeoJSON,
    effectiveRoadClasses,
    onOptimizeRoute,
    checkBackend,
  ]);

  const handleExportRoute = useCallback(async () => {
    if (!lastResult?.route_geojson?.features?.length) {
      Alert.alert("No Route", "Optimize a route first.");
      return;
    }
    try {
      const exportFeatures = lastResult.route_geojson.features.map((f) => ({
        type: "Feature" as const,
        id: String(f.properties?.type ?? "route"),
        geometry: f.geometry as { type: "LineString"; coordinates: number[][] },
        properties: f.properties as Record<string, string | number | undefined>,
      }));
      await shareGeoJSON(exportFeatures);
    } catch (err) {
      Alert.alert(
        "Export Failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }, [lastResult]);

  const area = calculateArea(safePoints);
  const pathDistanceKm = calculatePathDistance(safePoints);

  return (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <ExtractConnectionStatus />
      {/* Backend status */}
      <View style={[styles.statusRow, { backgroundColor: colors.surface }]}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor:
                backendOnline === true
                  ? "#22c55e"
                  : backendOnline === false
                    ? "#ef4444"
                    : colors.muted,
            },
          ]}
        />
        <Text style={[styles.statusText, { color: colors.text }]}>
          {backendOnline === true
            ? "Optimizer online"
            : backendOnline === false
              ? "Optimizer offline"
              : "Not checked"}
        </Text>
        <TouchableOpacity
          style={[styles.statusCheckBtn, { backgroundColor: primaryBlue }]}
          onPress={checkBackend}
        >
          <Text style={styles.statusCheckBtnText}>Check</Text>
        </TouchableOpacity>
      </View>

      {/* Area info */}
      {safePoints.length >= 3 && (
        <View style={[styles.infoCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.infoCardTitle, { color: colors.text }]}>
            Selection Area
          </Text>
          <Text style={[styles.infoCardValue, { color: primaryBlue }]}>
            {area > 0 ? formatArea(area) : "--"}
          </Text>
          {pathDistanceKm > 0 && (
            <Text style={[styles.infoCardSub, { color: colors.muted }]}>
              Perimeter: {pathDistanceKm.toFixed(3)} km
            </Text>
          )}
        </View>
      )}

      {/* Points */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          Polygon Points
        </Text>
        <Text style={[styles.infoText, { color: colors.text }]}>
          Tap the map to define the extraction area ({safePoints.length}{" "}
          points). Need at least {MIN_POINTS}.
        </Text>
        {safePoints.length > 0 && (
          <TouchableOpacity
            style={[
              styles.clearBtn,
              { backgroundColor: colors.surfaceElevated },
            ]}
            onPress={onClearPoints}
          >
            <Text
              style={[
                styles.clearBtnText,
                { color: colors.error ?? "#f87171" },
              ]}
            >
              Clear Points
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Extract GeoJSON from Overture */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          Overture GeoJSON
        </Text>
        <TouchableOpacity
          style={[
            styles.loadBtn,
            { backgroundColor: primaryBlue },
            isLoading && styles.btnDisabled,
          ]}
          onPress={handleExtractGeoJSON}
          disabled={isLoading}
        >
          {isLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ActivityIndicator color="#fff" />
              {extractProgress ? (
                <Text style={[styles.loadBtnText, { marginLeft: 8 }]}>
                  {extractProgress}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.loadBtnText}>
              {loadedGeoJSON ? "Re-extract GeoJSON" : "Extract GeoJSON"}
            </Text>
          )}
        </TouchableOpacity>

        {geoJSONInfo && (
          <View
            style={[styles.validationCard, { backgroundColor: colors.surface }]}
          >
            <Text style={[styles.validationTitle, { color: colors.text }]}>
              {geoJSONInfo.featureCount} features extracted
            </Text>
            {Object.entries(geoJSONInfo.roadClasses || {}).length > 0 && (
              <View style={styles.classBreakdown}>
                {Object.entries(geoJSONInfo.roadClasses || {})
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .slice(0, 8)
                  .map(([cls, count]) => (
                    <Text
                      key={cls}
                      style={[styles.classRow, { color: colors.muted }]}
                    >
                      {cls}: {count}
                    </Text>
                  ))}
              </View>
            )}
            {(geoJSONInfo.warnings ?? []).map((w, i) => (
              <Text
                key={i}
                style={[
                  styles.warningText,
                  { color: colors.error ?? "#f87171" },
                ]}
              >
                {w}
              </Text>
            ))}
          </View>
        )}
      </View>

      {/* Road class filter */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          Road Classes to Optimize
        </Text>
        <View style={styles.classRow}>
          {ROAD_CLASSES.map(({ key, label }) => {
            const selected = selectedRoadClasses.includes(key);
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.classChip,
                  {
                    backgroundColor: selected
                      ? primaryBlue
                      : colors.surfaceElevated,
                  },
                ]}
                onPress={() => toggleRoadClass(key)}
              >
                <Text
                  style={[
                    styles.classChipText,
                    { color: selected ? "#fff" : colors.text },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.optionalSectionLabel, { color: colors.muted }]}>
          Optionally include (default: excluded)
        </Text>
        <View style={styles.classRow}>
          {OPTIONAL_EXCLUDE_CLASSES.map(({ key, label }) => {
            const included = optionalIncluded[key] ?? false;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.classChip,
                  {
                    backgroundColor: included
                      ? primaryBlue
                      : colors.surfaceElevated,
                  },
                ]}
                onPress={() => toggleOptionalInclude(key)}
              >
                <Text
                  style={[
                    styles.classChipText,
                    { color: included ? "#fff" : colors.text },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Optimize */}
      <TouchableOpacity
        style={[
          styles.optimizeBtn,
          { backgroundColor: "#22c55e" },
          (!loadedGeoJSON || optimizing) && styles.btnDisabled,
        ]}
        onPress={handleOptimize}
        disabled={!loadedGeoJSON || optimizing}
      >
        {optimizing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.optimizeBtnText}>
            Optimize Route (Chinese Postman)
          </Text>
        )}
      </TouchableOpacity>

      {optimizing && optimizationStatus ? (
        <Text
          style={[
            styles.infoText,
            { color: colors.muted, textAlign: "center", marginBottom: 8 },
          ]}
        >
          {optimizationStatus}
        </Text>
      ) : null}

      {/* Results */}
      {showResults && lastResult && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            Optimization Results
          </Text>

          <View style={styles.statsGrid}>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.total_distance_km.toFixed(2)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Total km
              </Text>
            </View>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.stats.efficiency.toFixed(1)}%
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Efficiency
              </Text>
            </View>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.stats.deadhead_distance_km.toFixed(2)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Deadhead km
              </Text>
            </View>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.stats.edges_in_graph}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Road Segments
              </Text>
            </View>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.stats.right_turns}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Right Turns
              </Text>
            </View>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.stats.left_turns}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Left Turns
              </Text>
            </View>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.stats.u_turns}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                U-Turns
              </Text>
            </View>
            <View
              style={[styles.statCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.statValue, { color: colors.text }]}>
                {lastResult.stats.nodes_in_graph}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Intersections
              </Text>
            </View>
          </View>

          <Text style={[styles.messageText, { color: colors.muted }]}>
            {lastResult.message}
          </Text>

          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[
                styles.exportBtn,
                { backgroundColor: colors.surfaceElevated },
              ]}
              onPress={handleExportRoute}
            >
              <Text style={[styles.exportBtnText, { color: colors.text }]}>
                Export Route GeoJSON
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.newExtractionBtn,
              { backgroundColor: (colors.error ?? "#ef4444") + "30" },
            ]}
            onPress={() => {
              setShowResults(false);
              setLoadedGeoJSON(null);
              setGeoJSONInfo(null);
              onClearPoints();
            }}
          >
            <Text
              style={[
                styles.newExtractionBtnText,
                { color: colors.error ?? "#f87171" },
              ]}
            >
              New Extraction
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 12 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    gap: 8,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, fontSize: 14, fontWeight: "500" },
  statusCheckBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  statusCheckBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  infoCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  infoCardTitle: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  infoCardValue: { fontSize: 22, fontWeight: "700" },
  infoCardSub: { fontSize: 12, marginTop: 4 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoText: { fontSize: 14, marginBottom: 8 },
  clearBtn: {
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  clearBtnText: { fontSize: 14, fontWeight: "500" },
  loadBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 48,
  },
  loadBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  validationCard: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  validationTitle: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  classBreakdown: { marginBottom: 6 },
  classRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionalSectionLabel: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 12,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  classChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  classChipText: { fontSize: 13, fontWeight: "500" },
  warningText: { fontSize: 12, marginTop: 4, fontStyle: "italic" },
  optimizeBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    minHeight: 48,
  },
  optimizeBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  btnDisabled: { opacity: 0.6 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    minWidth: 80,
    padding: 10,
    borderRadius: 8,
    flex: 1,
  },
  statValue: { fontSize: 18, fontWeight: "700" },
  statLabel: { fontSize: 11, marginTop: 2 },
  messageText: {
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  exportRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  exportBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  exportBtnText: { fontSize: 14, fontWeight: "600" },
  newExtractionBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  newExtractionBtnText: { fontSize: 14, fontWeight: "600" },
});

OvertureExtractorContent.displayName = "OvertureExtractorContent";
