/**
 * OSM Extractor panel content: polygon points, category selection, extract, results, export.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import {
  OSM_CATEGORIES,
  fetchOSMData,
  calculateArea,
  calculatePathDistance,
  getSegmentDistances,
  type OSMCategoryKey,
  type LatLonPoint,
  type ParsedOverpassResult,
} from "@/lib/overpassService";
import { shareGeoJSON, shareCSV, shareOSM, type OSMBounds } from "@/lib/exportService";
import { useColors } from "@/hooks/use-colors";

const MIN_POINTS = 3;
const MAX_POINTS = 10;

type FeatureStep = 1 | 2 | 3;

const FEATURE_STEPS: Record<
  FeatureStep,
  { title: string; description: string }
> = {
  1: {
    title: "GPS Field Area",
    description:
      "By tapping on the map, you can easily calculate areas that you need to cover.",
  },
  2: {
    title: "Measure Distance",
    description:
      "The distance of your choice can be easily calculated with the help of our calculator.",
  },
  3: {
    title: "Add Area Point",
    description:
      "If you have any points in your area, you can easily add them and calculate the distance.",
  },
};

function formatArea(areaKm2: number): string {
  if (areaKm2 >= 1) return `${areaKm2.toFixed(3)} km²`;
  const areaM2 = areaKm2 * 1_000_000;
  return `${areaM2.toFixed(2)} m²`;
}

export interface OSMExtractorContentProps {
  points: LatLonPoint[];
  onClearPoints: () => void;
  onExtract: (data: ParsedOverpassResult) => void;
  extractedData: ParsedOverpassResult | null;
  onOptimizeRoute?: (rawElements: import("@/lib/overpassService").OverpassElement[]) => void;
  optimizing?: boolean;
  optimizationStatus?: string;
}

export function OSMExtractorContent({
  points = [],
  onClearPoints,
  onExtract,
  extractedData = null,
  onOptimizeRoute,
  optimizing = false,
  optimizationStatus = "",
}: OSMExtractorContentProps) {
  const safePoints = points ?? [];
  const [featureStep, setFeatureStep] = useState<FeatureStep>(1);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [numPoints, setNumPoints] = useState(5);
  const [selectedCategories, setSelectedCategories] = useState<
    OSMCategoryKey[]
  >(["roads", "buildings", "amenities"]);
  const [showResults, setShowResults] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleFeatureContinue = () => {
    if (featureStep < 3) setFeatureStep((s) => (s + 1) as FeatureStep);
  };

  const handleFeatureDone = () => {
    setOnboardingComplete(true);
  };

  const toggleCategory = (cat: OSMCategoryKey) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleExtract = async () => {
    if (safePoints.length < MIN_POINTS) {
      Alert.alert(
        "Error",
        `Please add at least ${MIN_POINTS} points on the map to define a polygon.`
      );
      return;
    }
    if (selectedCategories.length === 0) {
      Alert.alert("Error", "Please select at least one category to extract.");
      return;
    }
    try {
      setIsExtracting(true);
      const result = await fetchOSMData(safePoints, selectedCategories);
      onExtract(result);
      setShowResults(true);
    } catch (error) {
      Alert.alert(
        "Extraction Failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExportGeoJSON = async () => {
    if (!extractedData?.features?.length) {
      Alert.alert("No Data", "No features to export.");
      return;
    }
    try {
      await shareGeoJSON(extractedData.features);
    } catch (error) {
      Alert.alert(
        "Export Failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  };

  const handleExportCSV = async () => {
    if (!extractedData?.features?.length) {
      Alert.alert("No Data", "No features to export.");
      return;
    }
    try {
      await shareCSV(extractedData.features);
    } catch (error) {
      Alert.alert(
        "Export Failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  };

  const handleExportOSM = async () => {
    if (!extractedData?.rawElements?.length) {
      Alert.alert("No Data", "No OSM data to export.");
      return;
    }
    if (safePoints.length < 3) {
      Alert.alert("No Bounds", "Extraction polygon is required for OSM file bounds.");
      return;
    }
    try {
      const lats = safePoints.map((p) => p.latitude);
      const lons = safePoints.map((p) => p.longitude);
      const bounds: OSMBounds = {
        minLat: Math.min(...lats),
        minLon: Math.min(...lons),
        maxLat: Math.max(...lats),
        maxLon: Math.max(...lons),
      };
      await shareOSM(extractedData.rawElements, bounds);
    } catch (error) {
      Alert.alert(
        "Export Failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  };

  const area = calculateArea(safePoints);
  const pathDistanceKm = calculatePathDistance(safePoints);
  const segmentDistancesKm = getSegmentDistances(safePoints);
  const categoryKeys = Object.keys(OSM_CATEGORIES) as OSMCategoryKey[];
  const colors = useColors();
  const primaryBlue = colors.primary ?? "#3b82f6";

  return (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      {/* Feature card: GPS Field Area / Measure Distance / Add Area Point */}
      <View style={[styles.featureCard, { backgroundColor: colors.surface }]}>
        {onboardingComplete ? (
          <>
            <Text style={[styles.featureCardTitle, { color: colors.text }]}>
              Total Area
            </Text>
            <Text style={[styles.featureCardValue, { color: primaryBlue }]}>
              {area > 0 ? formatArea(area) : "—"}
            </Text>
            {safePoints.length >= 2 && (
              <>
                <Text style={[styles.featureCardTitle, { color: colors.text, marginTop: 8 }]}>
                  Total Distance
                </Text>
                <Text style={[styles.featureCardValue, { color: primaryBlue }]}>
                  {pathDistanceKm.toFixed(3)} km
                </Text>
                <View style={styles.segmentList}>
                  <Text style={[styles.segmentListTitle, { color: colors.muted }]}>
                    Segment measurements
                  </Text>
                  {segmentDistancesKm.map((km, i) => (
                    <Text
                      key={i}
                      style={[styles.segmentRow, { color: colors.text }]}
                    >
                      Pt {i + 1} → Pt {i + 2}: {km < 1 ? (km * 1000).toFixed(1) + " m" : km.toFixed(3) + " km"}
                    </Text>
                  ))}
                </View>
              </>
            )}
          </>
        ) : (
          <>
            <Text style={[styles.featureCardTitle, { color: colors.text }]}>
              {FEATURE_STEPS[featureStep].title}
            </Text>
            <Text style={[styles.featureCardDescription, { color: colors.muted }]}>
              {FEATURE_STEPS[featureStep].description}
            </Text>
            {featureStep === 1 && area > 0 && (
              <View style={styles.featureCardMeasure}>
                <Text style={[styles.featureCardMeasureLabel, { color: primaryBlue }]}>
                  Total Area
                </Text>
                <Text style={[styles.featureCardMeasureValue, { color: colors.text }]}>
                  {formatArea(area)}
                </Text>
              </View>
            )}
            {featureStep === 2 && safePoints.length >= 2 && (
              <>
                <View style={styles.featureCardMeasure}>
                  <Text style={[styles.featureCardMeasureLabel, { color: primaryBlue }]}>
                    Total Distance
                  </Text>
                  <Text style={[styles.featureCardMeasureValue, { color: colors.text }]}>
                    {pathDistanceKm.toFixed(3)} km
                  </Text>
                </View>
                <View style={styles.segmentList}>
                  <Text style={[styles.segmentListTitle, { color: colors.muted }]}>
                    Segment measurements
                  </Text>
                  {segmentDistancesKm.map((km, i) => (
                    <Text
                      key={i}
                      style={[styles.segmentRow, { color: colors.text }]}
                    >
                      Pt {i + 1} → Pt {i + 2}: {km < 1 ? (km * 1000).toFixed(1) + " m" : km.toFixed(3) + " km"}
                    </Text>
                  ))}
                </View>
              </>
            )}
            {featureStep === 3 && area > 0 && (
              <>
                <View style={styles.featureCardMeasure}>
                  <Text style={[styles.featureCardMeasureLabel, { color: primaryBlue }]}>
                    Total Area
                  </Text>
                  <Text style={[styles.featureCardMeasureValue, { color: colors.text }]}>
                    {formatArea(area)}
                  </Text>
                </View>
                {safePoints.length >= 2 && (
                  <View style={styles.segmentList}>
                    <Text style={[styles.segmentListTitle, { color: colors.muted }]}>
                      Segment measurements
                    </Text>
                    {segmentDistancesKm.map((km, i) => (
                      <Text
                        key={i}
                        style={[styles.segmentRow, { color: colors.text }]}
                      >
                        Pt {i + 1} → Pt {i + 2}: {km < 1 ? (km * 1000).toFixed(1) + " m" : km.toFixed(3) + " km"}
                      </Text>
                    ))}
                  </View>
                )}
              </>
            )}
            <View style={styles.paginationDots}>
              {([1, 2, 3] as const).map((i) => (
                <View
                  key={i}
                  style={[
                    styles.paginationDot,
                    {
                      backgroundColor: i === featureStep ? primaryBlue : colors.muted + "60",
                    },
                  ]}
                />
              ))}
            </View>
            {featureStep < 3 ? (
              <TouchableOpacity
                style={[styles.featureCardButton, { backgroundColor: primaryBlue }]}
                onPress={handleFeatureContinue}
              >
                <Text style={styles.featureCardButtonText}>Continue</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.featureCardButton, { backgroundColor: primaryBlue }]}
                onPress={handleFeatureDone}
              >
                <Text style={styles.featureCardButtonText}>Done</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          Points
        </Text>
        <Text style={[styles.infoText, { color: colors.text }]}>
          Tap the map to add points. Need at least {MIN_POINTS} for a polygon.
        </Text>
        <View style={styles.pointsSelector}>
          <TouchableOpacity
            style={[styles.pointsBtn, { backgroundColor: colors.surfaceElevated }]}
            onPress={() => setNumPoints((n) => Math.max(MIN_POINTS, n - 1))}
          >
            <Text style={[styles.pointsBtnText, { color: colors.text }]}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.pointsValue, { color: colors.text }]}>
            {safePoints.length}
          </Text>
          <TouchableOpacity
            style={[styles.pointsBtn, { backgroundColor: colors.surfaceElevated }]}
            onPress={() => setNumPoints((n) => Math.min(MAX_POINTS, n + 1))}
          >
            <Text style={[styles.pointsBtnText, { color: colors.text }]}>+</Text>
          </TouchableOpacity>
        </View>
        {area > 0 && (
          <Text style={[styles.infoText, { color: colors.muted }]}>
            Area: {area.toFixed(3)} km²
          </Text>
        )}
        {safePoints.length > 0 && (
          <TouchableOpacity
            style={[styles.clearBtn, { backgroundColor: colors.surfaceElevated }]}
            onPress={onClearPoints}
          >
            <Text style={[styles.clearBtnText, { color: colors.error ?? "#f87171" }]}>
              Clear points
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          Categories
        </Text>
        <View style={styles.categoryRow}>
          {categoryKeys.map((key) => {
            const value = OSM_CATEGORIES[key];
            if (!value) return null;
            const selected = selectedCategories.includes(key);
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: selected ? (colors.primary ?? "#3b82f6") : colors.surfaceElevated,
                  },
                ]}
                onPress={() => toggleCategory(key)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: selected ? "#fff" : colors.text },
                  ]}
                >
                  {value.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {onOptimizeRoute && (
        <Text style={[styles.infoText, { color: colors.muted, marginBottom: 12 }]}>
          After extracting, use Optimize Route to build a route through the area.
        </Text>
      )}
      <TouchableOpacity
        style={[
          styles.extractBtn,
          { backgroundColor: colors.primary ?? "#3b82f6" },
          (safePoints.length < MIN_POINTS || isExtracting) &&
            styles.extractBtnDisabled,
        ]}
        onPress={handleExtract}
        disabled={safePoints.length < MIN_POINTS || isExtracting}
      >
        {isExtracting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.extractBtnText}>Extract OSM Data</Text>
        )}
      </TouchableOpacity>

      {onOptimizeRoute && (
        <TouchableOpacity
          style={[
            styles.optimizeBtn,
            { backgroundColor: "#22c55e", marginBottom: 16 },
            ((extractedData?.rawElements?.length ?? 0) === 0 || optimizing) &&
              styles.extractBtnDisabled,
          ]}
          onPress={() => extractedData?.rawElements && onOptimizeRoute(extractedData.rawElements)}
          disabled={(extractedData?.rawElements?.length ?? 0) === 0 || optimizing}
        >
          {optimizing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.extractBtnText}>Optimize Route</Text>
          )}
        </TouchableOpacity>
      )}
      {onOptimizeRoute && (extractedData?.rawElements?.length ?? 0) > 0 && optimizing && optimizationStatus && (
        <Text style={[styles.infoText, { color: colors.muted, textAlign: "center", marginBottom: 8 }]}>
          {optimizationStatus}
        </Text>
      )}

      {showResults && extractedData && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            Results
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {extractedData.counts.roads}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Roads</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {extractedData.counts.buildings}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Buildings</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {extractedData.counts.amenities}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>Amenities</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {extractedData.features.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.muted }]}>
                Total
              </Text>
            </View>
          </View>
          <Text style={[styles.mapLegend, { color: colors.muted }]}>
            Map: blue outline = extraction boundary; green markers = POIs; green lines = roads.
          </Text>
          <View style={styles.exportRow}>
            <TouchableOpacity
              style={[styles.exportBtn, { backgroundColor: colors.surfaceElevated }]}
              onPress={handleExportOSM}
            >
              <Text style={[styles.exportBtnText, { color: colors.text }]}>
                OSM (.osm)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, { backgroundColor: colors.surfaceElevated }]}
              onPress={handleExportGeoJSON}
            >
              <Text style={[styles.exportBtnText, { color: colors.text }]}>
                GeoJSON
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.exportBtn, { backgroundColor: colors.surfaceElevated }]}
              onPress={handleExportCSV}
            >
              <Text style={[styles.exportBtnText, { color: colors.text }]}>
                CSV
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
  content: {
    flex: 1,
    padding: 12,
  },
  featureCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  featureCardTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  featureCardDescription: {
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  featureCardValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  featureCardMeasure: {
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 8,
  },
  featureCardMeasureLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  featureCardMeasureValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  paginationDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  featureCardButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  featureCardButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  segmentList: {
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 8,
  },
  segmentListTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  segmentRow: {
    fontSize: 13,
    marginBottom: 2,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoText: {
    fontSize: 14,
    marginBottom: 8,
  },
  pointsSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  pointsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  pointsBtnText: {
    fontSize: 20,
  },
  pointsValue: {
    fontSize: 24,
    fontWeight: "600",
    marginHorizontal: 20,
  },
  clearBtn: {
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  clearBtnText: {
    fontSize: 14,
    fontWeight: "500",
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  extractBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    minHeight: 48,
  },
  extractBtnDisabled: {
    opacity: 0.6,
  },
  extractBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 12,
  },
  stat: {
    minWidth: 70,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  mapLegend: {
    fontSize: 11,
    marginBottom: 10,
    fontStyle: "italic",
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
  exportBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  optimizeBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    minHeight: 48,
  },
  newExtractionBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  newExtractionBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
OSMExtractorContent.displayName = "OSMExtractorContent";
