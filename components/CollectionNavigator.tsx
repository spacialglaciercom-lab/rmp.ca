/**
 * Collection Route Navigator
 *
 * Full-screen in-app navigation for waste collection routes.
 * Features:
 * - Colored polyline map (green = completed, orange = active, gray = pending)
 * - Segment tracking with progress bar
 * - Right-arm awareness indicators
 * - Live GPS auto-advance via linear reference progress
 * - Voice announcements for upcoming stops
 * - Grouped street view for split Overture segments (by source_id)
 * - Thin linear progress indicator on the active segment polyline
 *
 * This is completely separate from Normal Navigation which deep-links to
 * external apps (Google Maps / Apple Maps / Waze).
 */

import React, { useEffect, useMemo, useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  FlatList,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, Polyline, UrlTile } from "react-native-maps";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { useMapType } from "@/lib/map-type-preference";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { useShallow } from "zustand/shallow";
import { useCollectionNavigation } from "@/hooks/useCollectionNavigation";
import {
  useCollectionNavigationStore,
  useCollectionProgress,
  useActiveSegment,
  useSegmentGroups,
} from "@/stores/collectionNavigationStore";
import { haversineDistance } from "@/lib/offlineTurnDetection";
import type { CollectionPoint } from "@/types";
import type { CollectionSegment, SegmentGroup } from "@/types/navigation";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLORS = {
  completed: "#22c55e",
  active: "#f97316",
  pending: "#9ca3af",
  skipped: "#ef4444",
  rightArm: "#3b82f6",
  leftArm: "#a855f7",
  user: "#4285F4",
  progressTrack: "rgba(249, 115, 22, 0.3)",
  progressFill: "#f97316",
} as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CollectionNavigatorProps {
  routePoints: Array<{ lat: number; lon: number }>;
  collectionPoints: CollectionPoint[];
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CollectionNavigator({
  routePoints,
  collectionPoints,
  onClose,
}: CollectionNavigatorProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mapTypePreference] = useMapType();
  const mapRef = useRef<MapView>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showStopList, setShowStopList] = useState(false);

  const { startGPS, stopGPS } = useCollectionNavigation({
    routePoints,
    collectionPoints,
  });

  const segments = useCollectionNavigationStore(useShallow((s) => s.segments));
  const isTracking = useCollectionNavigationStore((s) => s.isTracking);
  const currentLocation = useCollectionNavigationStore(useShallow((s) => s.currentLocation));
  const activeSegment = useActiveSegment();
  const progress = useCollectionProgress();
  const segmentGroups = useSegmentGroups();

  const advanceSegment = useCollectionNavigationStore((s) => s.advanceSegment);
  const skipSegment = useCollectionNavigationStore((s) => s.skipSegment);
  const resetNavigation = useCollectionNavigationStore((s) => s.resetNavigation);

  // Follow user location on map
  useEffect(() => {
    if (!mapRef.current || !currentLocation || !isTracking) return;
    mapRef.current.animateCamera(
      {
        center: {
          latitude: currentLocation.lat,
          longitude: currentLocation.lon,
        },
        heading: currentLocation.bearing ?? 0,
        zoom: 17,
        pitch: 0,
      },
      { duration: 800 },
    );
  }, [currentLocation?.lat, currentLocation?.lon, currentLocation?.bearing, isTracking]);

  // Fit map to route bounds on mount
  useEffect(() => {
    if (!mapRef.current || routePoints.length < 2) return;
    const coords = routePoints.map((p) => ({
      latitude: p.lat,
      longitude: p.lon,
    }));
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 120, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }, 500);
  }, [routePoints]);

  const handleStart = useCallback(async () => {
    setIsStarting(true);
    try {
      await startGPS();
    } catch (error) {
      Alert.alert(
        "Unable to Start",
        error instanceof Error ? error.message : "Failed to start GPS tracking. Please check your location permissions.",
      );
    } finally {
      setIsStarting(false);
    }
  }, [startGPS]);

  const handleStop = useCallback(() => {
    stopGPS();
    resetNavigation();
    onClose();
  }, [stopGPS, resetNavigation, onClose]);

  // Build polylines per segment, plus a progress overlay for the active segment
  const { polylineGroups, activeProgressOverlay } = useMemo(() => {
    const groups: Array<{
      coords: Array<{ latitude: number; longitude: number }>;
      color: string;
      zIndex: number;
      strokeWidth: number;
    }> = [];

    let overlay: {
      coords: Array<{ latitude: number; longitude: number }>;
    } | null = null;

    for (const seg of segments) {
      const color =
        seg.status === "completed"
          ? COLORS.completed
          : seg.status === "active"
            ? COLORS.active
            : seg.status === "skipped"
              ? COLORS.skipped
              : COLORS.pending;
      const zIndex =
        seg.status === "active" ? 3 : seg.status === "completed" ? 2 : 1;

      groups.push({
        coords: seg.polyline.map((p) => ({
          latitude: p.lat,
          longitude: p.lon,
        })),
        color,
        zIndex,
        strokeWidth: seg.status === "active" ? 10 : 7,
      });

      // Build progress overlay for active segment
      if (seg.status === "active" && seg.linearProgress > 0 && seg.polyline.length >= 2) {
        const progressCoords = getProgressCoords(seg.polyline, seg.linearProgress);
        if (progressCoords.length >= 2) {
          overlay = {
            coords: progressCoords.map((p) => ({
              latitude: p.lat,
              longitude: p.lon,
            })),
          };
        }
      }
    }

    return { polylineGroups: groups, activeProgressOverlay: overlay };
  }, [segments]);

  // Collection point markers
  const stopMarkers = useMemo(() => {
    return segments
      .filter((s) => s.collectionPoint)
      .map((seg) => ({
        key: seg.collectionPoint!.id,
        coord: {
          latitude: seg.collectionPoint!.latitude,
          longitude: seg.collectionPoint!.longitude,
        },
        isRight: seg.isRightSide,
        isCompleted: seg.status === "completed",
        isActive: seg.status === "active",
        address: seg.collectionPoint!.address,
        segIndex: seg.index,
      }));
  }, [segments]);

  // Grouped street display name for the active segment
  const activeGroupInfo = useMemo(() => {
    if (!activeSegment) return null;
    const group = segmentGroups.find((g) =>
      g.segmentIndices.includes(activeSegment.index),
    );
    return group ?? null;
  }, [activeSegment, segmentGroups]);

  const activeBaseLayer = useMapLayerStore((s) => s.activeBaseLayer);
  const OSM_STANDARD = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const OSM_DARK = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
  const tileUrl = mapTypePreference === "dark" ? OSM_DARK : OSM_STANDARD;

  const progressPct = progress.percentage;
  const activeCP = activeSegment?.collectionPoint;

  // Use street-level counts only when route has actual split segments
  const hasSplitSegments = segmentGroups.some((g) => g.subSegmentCount > 1);
  const displayCompleted = hasSplitSegments
    ? progress.completedStreets
    : progress.completedStops;
  const displayTotal = hasSplitSegments
    ? progress.totalStreets
    : progress.totalStops;
  const displayUnit = hasSplitSegments ? "streets" : "stops";

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: routePoints[0]?.lat ?? 0,
          longitude: routePoints[0]?.lon ?? 0,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        mapType={
          activeBaseLayer === "google-maps" ? "standard" :
          activeBaseLayer === "google-satellite" ? "satellite" :
          activeBaseLayer === "google-hybrid" ? "hybrid" :
          activeBaseLayer === "google-terrain" ? "terrain" :
          "none"
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

        {/* Colored polylines per segment */}
        {polylineGroups.map((group, i) => (
          <Polyline
            key={`seg-${i}`}
            coordinates={group.coords}
            strokeColor={group.color}
            strokeWidth={group.strokeWidth}
            lineCap="round"
            lineJoin="round"
            zIndex={group.zIndex}
          />
        ))}

        {/* Linear progress overlay on active segment */}
        {activeProgressOverlay && (
          <Polyline
            coordinates={activeProgressOverlay.coords}
            strokeColor={COLORS.completed}
            strokeWidth={10}
            lineCap="round"
            lineJoin="round"
            zIndex={4}
          />
        )}

        {/* Start marker */}
        {routePoints.length >= 1 && (
          <Marker
            coordinate={{
              latitude: routePoints[0].lat,
              longitude: routePoints[0].lon,
            }}
            pinColor={COLORS.completed}
            title="Start"
          />
        )}

        {/* End marker */}
        {routePoints.length >= 2 && (
          <Marker
            coordinate={{
              latitude: routePoints[routePoints.length - 1].lat,
              longitude: routePoints[routePoints.length - 1].lon,
            }}
            pinColor="#ef4444"
            title="End"
          />
        )}

        {/* Collection point markers with right-arm indicators */}
        {stopMarkers.map((m) => (
          <Marker
            key={m.key}
            coordinate={m.coord}
            pinColor={
              m.isCompleted
                ? COLORS.completed
                : m.isActive
                  ? COLORS.active
                  : m.isRight
                    ? COLORS.rightArm
                    : COLORS.leftArm
            }
            title={m.address}
            description={
              m.isRight ? "Right side" : "Left side"
            }
          />
        ))}

        {/* User location marker */}
        {currentLocation && isTracking && (
          <Marker
            coordinate={{
              latitude: currentLocation.lat,
              longitude: currentLocation.lon,
            }}
            pinColor={COLORS.user}
            title="You"
            flat
          />
        )}
      </MapView>

      {/* Top bar: active segment info */}
      {isTracking && activeSegment && (
        <View
          style={[
            styles.topBar,
            {
              backgroundColor: colors.surface + "E6",
              paddingTop: insets.top + 8,
            },
          ]}
        >
          <View style={styles.topBarContent}>
            {/* Right-arm indicator */}
            <View
              style={[
                styles.armBadge,
                {
                  backgroundColor: activeSegment.isRightSide
                    ? COLORS.rightArm
                    : COLORS.leftArm,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={
                  activeSegment.isRightSide
                    ? "arrow-right-bold"
                    : "arrow-left-bold"
                }
                size={20}
                color="#fff"
              />
              <Text style={styles.armBadgeText}>
                {activeSegment.isRightSide ? "RIGHT" : "LEFT"}
              </Text>
            </View>

            <View style={styles.topBarInfo}>
              <Text
                style={[styles.segmentLabel, { color: colors.text }]}
                numberOfLines={1}
              >
                {activeGroupInfo && activeGroupInfo.subSegmentCount > 1
                  ? activeGroupInfo.streetName
                  : `Segment ${progress.activeSegmentIndex + 1} of ${progress.totalSegments}`}
              </Text>
              {activeGroupInfo && activeGroupInfo.subSegmentCount > 1 && (
                <Text
                  style={[styles.subSegmentBadge, { color: colors.muted }]}
                >
                  {activeGroupInfo.subSegmentCount} segments
                </Text>
              )}
              {activeCP && (
                <Text
                  style={[styles.stopAddress, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {activeCP.address || "Collection point ahead"}
                </Text>
              )}
              {activeCP?.specialInstructions && (
                <Text
                  style={[styles.instructions, { color: COLORS.active }]}
                  numberOfLines={1}
                >
                  {activeCP.specialInstructions}
                </Text>
              )}
            </View>
          </View>

          {/* Thin inline linear progress bar for active segment */}
          <View style={styles.inlineProgressTrack}>
            <View
              style={[
                styles.inlineProgressFill,
                {
                  width: `${Math.round((activeSegment.linearProgress ?? 0) * 100)}%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Progress bar */}
      {segments.length > 0 && (
        <View
          style={[
            styles.progressContainer,
            { bottom: isTracking ? 180 : 120 },
          ]}
        >
          <View
            style={[
              styles.progressBar,
              { backgroundColor: colors.surface + "CC" },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${progressPct}%`,
                  backgroundColor: COLORS.completed,
                },
              ]}
            />
          </View>
          <Text style={[styles.progressText, { color: colors.text }]}>
            {displayCompleted}/{displayTotal} {displayUnit}
            {" \u2022 "}
            {progressPct}%
            {" \u2022 "}
            {formatDistance(progress.totalDistance - progress.completedDistance)}{" "}
            remaining
          </Text>
        </View>
      )}

      {/* Legend */}
      {isTracking && (
        <View
          style={[
            styles.legend,
            {
              backgroundColor: colors.surface + "CC",
              top: insets.top + (activeSegment ? 130 : 12),
              right: 12,
            },
          ]}
        >
          <LegendItem color={COLORS.completed} label="Done" />
          <LegendItem color={COLORS.active} label="Current" />
          <LegendItem color={COLORS.pending} label="Ahead" />
          <LegendItem color={COLORS.rightArm} label="R-side" />
        </View>
      )}

      {/* Stop list overlay */}
      {showStopList && (
        <View
          style={[
            styles.stopListOverlay,
            {
              backgroundColor: colors.surface + "F5",
              paddingTop: insets.top + 8,
            },
          ]}
        >
          <View style={styles.stopListHeader}>
            <Text style={[styles.stopListTitle, { color: colors.text }]}>
              Streets ({displayCompleted}/{displayTotal})
            </Text>
            <TouchableOpacity onPress={() => setShowStopList(false)}>
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={colors.text}
              />
            </TouchableOpacity>
          </View>
          <FlatList
            data={segmentGroups}
            keyExtractor={(item) => item.sourceId}
            renderItem={({ item }) => (
              <SegmentGroupRow group={item} colors={colors} />
            )}
            style={styles.stopList}
          />
        </View>
      )}

      {/* Bottom controls */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.surface + "F2",
            paddingBottom: Math.max(16, insets.bottom + 8),
          },
        ]}
      >
        {!isTracking ? (
          <View style={styles.startContainer}>
            <Text style={[styles.readyText, { color: colors.text }]}>
              Collection route loaded: {displayTotal} {displayUnit},{" "}
              {formatDistance(progress.totalDistance)}
            </Text>
            <TouchableOpacity
              style={[
                styles.startButton,
                { backgroundColor: COLORS.active },
                isStarting && { opacity: 0.7 },
              ]}
              onPress={handleStart}
              disabled={isStarting}
            >
              {isStarting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name="truck-fast"
                    size={22}
                    color="#fff"
                  />
                  <Text style={styles.startButtonText}>
                    Start Collection Route
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.cancelButton,
                { borderColor: colors.muted + "60" },
              ]}
              onPress={onClose}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.trackingControls}>
            <View style={styles.controlRow}>
              <TouchableOpacity
                style={[styles.controlButton, { backgroundColor: COLORS.completed }]}
                onPress={advanceSegment}
              >
                <MaterialCommunityIcons
                  name="check"
                  size={20}
                  color="#fff"
                />
                <Text style={styles.controlButtonText}>Complete</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.controlButton,
                  { backgroundColor: colors.muted + "80" },
                ]}
                onPress={skipSegment}
              >
                <MaterialCommunityIcons
                  name="skip-next"
                  size={20}
                  color="#fff"
                />
                <Text style={styles.controlButtonText}>Skip</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlButton, { backgroundColor: "#ef4444" }]}
                onPress={handleStop}
              >
                <MaterialCommunityIcons
                  name="stop"
                  size={20}
                  color="#fff"
                />
                <Text style={styles.controlButtonText}>End</Text>
              </TouchableOpacity>
            </View>

            {/* Stop list toggle */}
            <TouchableOpacity
              style={[styles.stopListToggle, { borderColor: colors.muted + "40" }]}
              onPress={() => setShowStopList(!showStopList)}
            >
              <MaterialCommunityIcons
                name="format-list-bulleted"
                size={18}
                color={colors.text}
              />
              <Text style={[styles.stopListToggleText, { color: colors.text }]}>
                {displayCompleted}/{displayTotal} {displayUnit}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function SegmentGroupRow({
  group,
  colors,
}: {
  group: SegmentGroup;
  colors: { text: string; muted: string };
}) {
  const statusColor = group.isCompleted
    ? COLORS.completed
    : group.isActive
      ? COLORS.active
      : COLORS.pending;

  return (
    <View style={styles.stopListRow}>
      <View style={[styles.stopListDot, { backgroundColor: statusColor }]} />
      <View style={styles.stopListInfo}>
        <Text
          style={[styles.stopListName, { color: colors.text }]}
          numberOfLines={1}
        >
          {group.streetName}
        </Text>
        {group.subSegmentCount > 1 && (
          <View style={styles.subSegmentBadgeContainer}>
            <Text style={[styles.subSegmentBadgeSmall, { color: colors.muted }]}>
              {group.subSegmentCount} segments
            </Text>
          </View>
        )}
      </View>
      <MaterialCommunityIcons
        name={
          group.isCompleted
            ? "check-circle"
            : group.isActive
              ? "truck-fast-outline"
              : "circle-outline"
        }
        size={20}
        color={statusColor}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

/**
 * Extract the portion of a polyline from the start up to the given
 * progress fraction (0.0 – 1.0). Returns coordinates suitable for
 * rendering a progress overlay on the map.
 */
function getProgressCoords(
  polyline: Array<{ lat: number; lon: number }>,
  progress: number,
): Array<{ lat: number; lon: number }> {
  if (polyline.length < 2 || progress <= 0) return [];
  if (progress >= 1) return [...polyline];

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < polyline.length; i++) {
    const d = haversineDistance(polyline[i - 1], polyline[i]);
    segLens.push(d);
    totalLen += d;
  }

  const targetLen = totalLen * progress;
  const result: Array<{ lat: number; lon: number }> = [polyline[0]];
  let accumulated = 0;

  for (let i = 0; i < segLens.length; i++) {
    const segLen = segLens[i];
    if (accumulated + segLen >= targetLen) {
      const remaining = targetLen - accumulated;
      const frac = segLen > 0 ? remaining / segLen : 0;
      const from = polyline[i];
      const to = polyline[i + 1];
      result.push({
        lat: from.lat + (to.lat - from.lat) * frac,
        lon: from.lon + (to.lon - from.lon) * frac,
      });
      break;
    }
    accumulated += segLen;
    result.push(polyline[i + 1]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  topBarContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  armBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    gap: 4,
  },
  armBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  topBarInfo: {
    flex: 1,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  subSegmentBadge: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  stopAddress: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 2,
  },
  instructions: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  inlineProgressTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "rgba(249, 115, 22, 0.2)",
    marginTop: 8,
    overflow: "hidden",
  },
  inlineProgressFill: {
    height: "100%",
    borderRadius: 1.5,
    backgroundColor: "#22c55e",
  },
  progressContainer: {
    position: "absolute",
    left: 16,
    right: 16,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 4,
    textAlign: "center",
  },
  legend: {
    position: "absolute",
    borderRadius: 10,
    padding: 8,
    gap: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#fff",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  startContainer: {
    gap: 12,
  },
  readyText: {
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  startButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  cancelButton: {
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  trackingControls: {
    gap: 12,
  },
  controlRow: {
    flexDirection: "row",
    gap: 10,
  },
  controlButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  controlButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  stopListToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  stopListToggleText: {
    fontSize: 13,
    fontWeight: "500",
  },
  stopListOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  stopListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  stopListTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  stopList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  stopListRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  stopListDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  stopListInfo: {
    flex: 1,
  },
  stopListName: {
    fontSize: 15,
    fontWeight: "600",
  },
  subSegmentBadgeContainer: {
    marginTop: 2,
  },
  subSegmentBadgeSmall: {
    fontSize: 11,
    fontWeight: "500",
  },
});
