/**
 * Map Markers screen — lists Active Route Markers and Custom Markers.
 * Per Master Plan Section 9.
 */

import React, {
  useMemo,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";
import { confirmDestructive } from "@/lib/confirmDestructive";
import { useDeviceType } from "@/hooks/useDeviceType";
import { useMarkersStore } from "@/stores/markersStore";
import { useRouting } from "@/lib/routing-context";
import { reverseGeocode } from "@/lib/geocode";
import { MarkerListItem, type MarkerItem } from "./MarkerListItem";
import { MediaNoteRecorder } from "./MediaNoteRecorder";
import type { CollectionPoint } from "@/types";

const PANEL_WIDTH_IPAD = 400;
const MAX_ROUTE_MARKERS_LIST = 50;

interface RoutePointLike {
  lat: number;
  lon: number;
  label?: string;
}

interface MapMarkersScreenProps {
  visible: boolean;
  onClose: () => void;
  /** Collection points from current route (waypoints + depot) */
  collectionPoints: CollectionPoint[];
  /** Display route points (geometry) — first = start, rest = waypoints */
  displayRoutePoints?:
    | ({ lat: number; lon: number } & { label?: string })[]
    | null;
  /** Called when user clears route markers */
  onClearRouteMarkers?: () => void;
}

export function MapMarkersScreen({
  visible,
  onClose,
  collectionPoints,
  displayRoutePoints,
  onClearRouteMarkers,
}: MapMarkersScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();
  const { dispatch } = useRouting();
  const {
    customMarkers,
    removeMarker,
    renameMarker,
    setMarkerLocation,
    clearAllCustomMarkers,
    addMediaNote,
  } = useMarkersStore();
  const geocodedRef = useRef<Set<string>>(new Set());
  const [recordingMarkerId, setRecordingMarkerId] = useState<string | null>(
    null,
  );

  // Reverse geocode markers that don't have a cached location
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      for (const m of customMarkers) {
        if (cancelled) break;
        if (m.location || geocodedRef.current.has(m.id)) continue;
        geocodedRef.current.add(m.id);
        const result = await reverseGeocode(m.lat, m.lon);
        if (cancelled) break;
        const loc = [result.city, result.country].filter(Boolean).join(", ");
        if (loc) setMarkerLocation(m.id, loc);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, customMarkers.length]);

  const { routeMarkers, totalRouteCount } = useMemo(() => {
    const pts = displayRoutePoints?.length ? displayRoutePoints : [];
    let list: MarkerItem[];
    if (pts.length === 0 && collectionPoints.length > 0) {
      list = collectionPoints.map((p, i) => ({
        id: p.id,
        name: p.address || p.locationName || `Stop ${i + 1}`,
        lat: p.latitude,
        lon: p.longitude,
        type: i === 0 ? "start" : "waypoint",
      }));
    } else {
      list = pts.map((p, i) => ({
        id: `route-${i}`,
        name:
          (p as { label?: string }).label ||
          collectionPoints[i]?.address ||
          collectionPoints[i]?.locationName ||
          (i === 0 ? "Depot (Start)" : `Stop ${i + 1}`),
        lat: p.lat,
        lon: p.lon,
        type: i === 0 ? "start" : "waypoint",
      }));
    }
    const total = list.length;
    const shown =
      total > MAX_ROUTE_MARKERS_LIST
        ? list.slice(0, MAX_ROUTE_MARKERS_LIST)
        : list;
    return { routeMarkers: shown, totalRouteCount: total };
  }, [collectionPoints, displayRoutePoints]);

  const customMarkerItems: MarkerItem[] = useMemo(
    () =>
      customMarkers.map((m) => ({
        id: m.id,
        name: m.name,
        lat: m.lat,
        lon: m.lon,
        type: "custom" as const,
        location: m.location,
        mediaNotesCount: m.mediaNotes?.length ?? 0,
      })),
    [customMarkers],
  );

  const handleClose = () => {
    hapticImpact();
    onClose();
  };

  const handleClearRouteMarkers = () => {
    hapticImpact();
    confirmDestructive(
      "Clear Route Markers",
      "Remove the current route and its markers from the map?",
      () => onClearRouteMarkers?.(),
      "Clear",
    );
  };

  const handleAddMarker = () => {
    hapticImpact();
    Alert.alert(
      "Add Marker",
      "Long-press on the map to add a custom marker at that location.",
      [{ text: "OK" }],
    );
  };

  const handleRenameMarker = (id: string, currentName: string) => {
    if (Platform.OS === "web") {
      const newName = window.prompt("Rename marker:", currentName);
      if (newName?.trim()) renameMarker(id, newName.trim());
    } else {
      Alert.prompt(
        "Rename Marker",
        "Enter a new name:",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Rename",
            onPress: (newName?: string) => {
              if (newName?.trim()) renameMarker(id, newName.trim());
            },
          },
        ],
        "plain-text",
        currentName,
      );
    }
  };

  const handlePreviewMarker = (lat: number, lon: number) => {
    hapticImpact();
    dispatch({
      type: "SET_PREVIEW_ROUTE",
      payload: [{ lat, lon, label: "P" }],
    });
    onClose();
  };

  const handleClearCustomMarkers = () => {
    hapticImpact();
    if (customMarkers.length === 0) return;
    confirmDestructive(
      "Clear Custom Markers",
      `Remove all ${customMarkers.length} custom marker(s)?`,
      clearAllCustomMarkers,
      "Clear",
    );
  };

  const handleAddNote = useCallback((markerId: string) => {
    hapticImpact();
    setRecordingMarkerId(markerId);
  }, []);

  const handleNoteSaved = useCallback(
    (uri: string, type: "audio" | "video", duration?: number) => {
      if (recordingMarkerId) {
        addMediaNote(recordingMarkerId, { uri, type, duration });
      }
      setRecordingMarkerId(null);
    },
    [recordingMarkerId, addMediaNote],
  );

  const handleNoteCancel = useCallback(() => {
    setRecordingMarkerId(null);
  }, []);

  const isIpad = deviceType === "ipad";
  const panelStyle = isIpad
    ? [
        styles.panelIpad,
        {
          width: PANEL_WIDTH_IPAD,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          backgroundColor: colors.surface,
          borderRightColor: colors.border,
        },
      ]
    : [
        styles.panelIphone,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          maxHeight: "85%",
        },
      ];

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View
          style={[
            isIpad ? styles.panelWrapperIpad : styles.panelWrapperIphone,
            panelStyle,
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Map Markers
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={colors.muted}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <SectionLabel color={colors.primary} style={{ marginTop: 0 }}>
              Active Route Markers ({totalRouteCount})
            </SectionLabel>
            {totalRouteCount > MAX_ROUTE_MARKERS_LIST && (
              <Text style={[styles.cappedHint, { color: colors.muted }]}>
                Showing first {MAX_ROUTE_MARKERS_LIST} of {totalRouteCount}{" "}
                points.
              </Text>
            )}
            {routeMarkers.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                No route markers. Load a route from Planner or import GPX.
              </Text>
            ) : (
              routeMarkers.map((m) => (
                <MarkerListItem
                  key={m.id}
                  marker={m}
                  showDelete={false}
                  onPress={() => handlePreviewMarker(m.lat, m.lon)}
                />
              ))
            )}

            <SectionLabel color={colors.primary} style={{ marginTop: 24 }}>
              Custom Markers ({customMarkers.length})
            </SectionLabel>
            {customMarkerItems.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                No custom markers. Long-press the map to add one.
              </Text>
            ) : (
              customMarkerItems.map((m) => (
                <MarkerListItem
                  key={m.id}
                  marker={m}
                  showDelete
                  onPress={() => handlePreviewMarker(m.lat, m.lon)}
                  onDelete={() => removeMarker(m.id)}
                  onRename={() => handleRenameMarker(m.id, m.name)}
                  onAddNote={() => handleAddNote(m.id)}
                />
              ))
            )}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                    marginBottom: 10,
                  },
                  routeMarkers.length === 0 && styles.actionDisabled,
                ]}
                onPress={handleClearRouteMarkers}
                disabled={routeMarkers.length === 0}
              >
                <MaterialCommunityIcons
                  name="map-marker-off"
                  size={20}
                  color={
                    routeMarkers.length ? colors.muted : colors.muted + "80"
                  }
                />
                <Text
                  style={[
                    styles.actionButtonText,
                    {
                      color: routeMarkers.length
                        ? colors.text
                        : colors.muted + "80",
                    },
                  ]}
                >
                  Clear Route Markers
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    borderColor: colors.primary,
                    backgroundColor: colors.primary + "20",
                  },
                ]}
                onPress={handleAddMarker}
              >
                <MaterialCommunityIcons
                  name="map-marker-plus"
                  size={20}
                  color={colors.primary}
                />
                <Text
                  style={[styles.actionButtonText, { color: colors.primary }]}
                >
                  Add Marker
                </Text>
              </TouchableOpacity>
            </View>
            {customMarkers.length > 0 && (
              <TouchableOpacity
                style={[styles.clearCustom, { marginTop: 8 }]}
                onPress={handleClearCustomMarkers}
              >
                <Text style={[styles.clearCustomText, { color: colors.muted }]}>
                  Clear all custom markers
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>

      {recordingMarkerId && (
        <MediaNoteRecorder
          visible={!!recordingMarkerId}
          onSave={handleNoteSaved}
          onCancel={handleNoteCancel}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  panelWrapperIpad: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    borderRightWidth: 1,
  },
  panelWrapperIphone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
  },
  panelIpad: { flex: 1 },
  panelIphone: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeButton: { padding: 4 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  emptyText: {
    fontSize: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    fontStyle: "italic",
  },
  cappedHint: {
    fontSize: 12,
    marginBottom: 8,
    fontStyle: "italic",
  },
  actions: {
    marginTop: 24,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionDisabled: { opacity: 0.6 },
  actionButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  clearCustom: { alignSelf: "center" },
  clearCustomText: { fontSize: 13 },
});
