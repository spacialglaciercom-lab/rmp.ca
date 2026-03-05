/**
 * Zones screen — list saved zone partition results from the Zones store.
 * Opened from map sidebar (Zones, between Layers and My Places).
 * Supports preview on map and export (GeoJSON / JSON).
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import * as FileSystem from "expo-file-system/legacy";

import { useColors } from "@/hooks/use-colors";
import { useDeviceType } from "@/hooks/useDeviceType";
import { useZonesStore, type SavedZoneResult } from "@/stores/zonesStore";
import { Fonts } from "@/lib/_core/theme";

const PANEL_WIDTH_IPAD = 400;

interface ZonesScreenProps {
  visible: boolean;
  onClose: () => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "";
  }
}

function zoneToGeoJSON(item: SavedZoneResult): string {
  const coords = item.polygon.map(([lat, lon]) => [lon, lat] as [number, number]);
  const ring = coords.length >= 3 ? [...coords, coords[0]] : [];
  const totalTime = item.zones.reduce((s, z) => s + z.estimated_time, 0);
  const feature = {
    type: "Feature" as const,
    properties: {
      name: item.name,
      zones: item.zones.length,
      truck_count: item.truck_count,
      balance_metric: item.balance_metric,
      total_estimated_time: totalTime,
      createdAt: item.createdAt,
    },
    geometry: {
      type: "Polygon" as const,
      coordinates: [ring],
    },
  };
  return JSON.stringify({ type: "FeatureCollection" as const, features: [feature] }, null, 2);
}

function ZoneResultRow({
  item,
  onRemove,
  onRename,
  onPreview,
  onExport,
  isDisplayed,
  colors,
}: {
  item: SavedZoneResult;
  onRemove: (id: string) => void;
  onRename: (item: SavedZoneResult) => void;
  onPreview: (item: SavedZoneResult) => void;
  onExport: (item: SavedZoneResult) => void;
  isDisplayed: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const totalTime = item.zones.reduce((s, z) => s + z.estimated_time, 0);
  const handleRemove = useCallback(() => {
    hapticImpact();
    Alert.alert(
      "Remove zone result",
      `Remove "${item.name}" from Zones?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => onRemove(item.id) },
      ]
    );
  }, [item.id, item.name, onRemove]);

  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]} pointerEvents="box-none">
      <View style={styles.rowMain} pointerEvents="box-none">
        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
          {item.name || "Unnamed zones"}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.muted }]}>
          {item.zones.length} zones · {item.truck_count} trucks · {formatDate(item.createdAt)}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.muted, fontSize: 12 }]}>
          Total estimated time: {totalTime.toFixed(1)} · {item.balance_metric}
        </Text>
      </View>
      <View style={styles.rowActions} pointerEvents="box-none">
        <Pressable
          onPress={() => {
            hapticImpact();
            onRename(item);
          }}
          style={({ pressed }) => [
            styles.rowActionButton,
            styles.rowActionButtonMinTouch,
            pressed && { opacity: 0.6 },
          ]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialCommunityIcons name="pencil" size={20} color={colors.muted} />
        </Pressable>
        <TouchableOpacity
          onPress={() => onPreview(item)}
          style={styles.rowActionButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons
            name={isDisplayed ? "map-marker-check" : "map-marker"}
            size={22}
            color={isDisplayed ? colors.primary : colors.muted}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onExport(item)}
          style={styles.rowActionButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="export" size={22} color={colors.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleRemove}
          style={styles.deleteButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialCommunityIcons name="delete-outline" size={22} color={colors.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function ZonesScreen({ visible, onClose }: ZonesScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();
  const savedZones = useZonesStore((s) => s.savedZones);
  const removeSavedZone = useZonesStore((s) => s.removeSavedZone);
  const updateSavedZoneName = useZonesStore((s) => s.updateSavedZoneName);
  const clearAllSavedZones = useZonesStore((s) => s.clearAllSavedZones);
  const displayedZoneId = useZonesStore((s) => s.displayedZoneId);
  const setDisplayedZoneId = useZonesStore((s) => s.setDisplayedZoneId);
  const [exporting, setExporting] = useState(false);
  const [renamingZoneId, setRenamingZoneId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  const handleClose = useCallback(() => {
    hapticImpact();
    onClose();
  }, [onClose]);

  const handleClearAll = useCallback(() => {
    if (savedZones.length === 0) return;
    hapticImpact();
    Alert.alert(
      "Clear all zones",
      `Remove all ${savedZones.length} saved zone result(s)?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear all", style: "destructive", onPress: clearAllSavedZones },
      ]
    );
  }, [savedZones.length, clearAllSavedZones]);

  const handleRename = useCallback((item: SavedZoneResult) => {
    hapticImpact();
    setRenamingZoneId(item.id);
    setRenamingName(item.name || "");
  }, []);

  const handleRenameSave = useCallback(() => {
    const trimmed = renamingName.trim();
    if (renamingZoneId && trimmed) {
      updateSavedZoneName(renamingZoneId, trimmed);
    }
    setRenamingZoneId(null);
    setRenamingName("");
  }, [renamingZoneId, renamingName, updateSavedZoneName]);

  const handleRenameCancel = useCallback(() => {
    setRenamingZoneId(null);
    setRenamingName("");
  }, []);

  const handlePreview = useCallback(
    (item: SavedZoneResult) => {
      hapticImpact();
      setDisplayedZoneId(item.id);
      onClose();
    },
    [setDisplayedZoneId, onClose]
  );

  const handleExport = useCallback(
    async (item: SavedZoneResult) => {
      hapticImpact();
      if (exporting) return;
      const baseName = (item.name || "zones").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
      Alert.alert(
        "Export zone",
        "Choose format to share",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "GeoJSON",
            onPress: async () => {
              setExporting(true);
              try {
                const Sharing = await import("expo-sharing");
                const content = zoneToGeoJSON(item);
                const path = `${FileSystem.cacheDirectory}${baseName}.geojson`;
                await FileSystem.writeAsStringAsync(path, content, {
                  encoding: FileSystem.EncodingType.UTF8,
                });
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(path, {
                    mimeType: "application/geo+json",
                    dialogTitle: "Share zone (GeoJSON)",
                  });
                } else if (Platform.OS === "web") {
                  const blob = new Blob([content], { type: "application/geo+json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${baseName}.geojson`;
                  a.click();
                  URL.revokeObjectURL(url);
                }
              } finally {
                setExporting(false);
              }
            },
          },
          {
            text: "JSON",
            onPress: async () => {
              setExporting(true);
              try {
                const Sharing = await import("expo-sharing");
                const content = JSON.stringify(item, null, 2);
                const path = `${FileSystem.cacheDirectory}${baseName}.json`;
                await FileSystem.writeAsStringAsync(path, content, {
                  encoding: FileSystem.EncodingType.UTF8,
                });
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(path, {
                    mimeType: "application/json",
                    dialogTitle: "Share zone (JSON)",
                  });
                } else if (Platform.OS === "web") {
                  const blob = new Blob([content], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${baseName}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }
              } finally {
                setExporting(false);
              }
            },
          },
        ]
      );
    },
    [exporting]
  );

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
    <>
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
              Zones
            </Text>
            <View style={styles.headerActions}>
              {displayedZoneId ? (
                <TouchableOpacity
                  onPress={() => {
                    hapticImpact();
                    setDisplayedZoneId(null);
                  }}
                  style={[styles.clearPreviewButton, { borderColor: colors.border }]}
                >
                  <MaterialCommunityIcons name="map-marker-remove" size={18} color={colors.muted} />
                  <Text style={[styles.clearPreviewText, { color: colors.muted }]}>Clear preview</Text>
                </TouchableOpacity>
              ) : null}
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
          </View>

          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Saved zone partition results. Add new results from the Extract tab after calculating zones.
          </Text>

          {savedZones.length > 0 && (
            <TouchableOpacity
              onPress={handleClearAll}
              style={[styles.clearButton, { borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="broom" size={18} color={colors.muted} />
              <Text style={[styles.clearButtonText, { color: colors.muted }]}>
                Clear all
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.listContainer}>
            {savedZones.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons
                  name="vector-polygon"
                  size={48}
                  color={colors.muted}
                />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  No saved zones
                </Text>
                <Text style={[styles.emptyHint, { color: colors.muted }]}>
                  Zone results you save will appear here.
                </Text>
              </View>
            ) : (
              <FlatList
                data={savedZones}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <ZoneResultRow
                    item={item}
                    onRemove={removeSavedZone}
                    onRename={handleRename}
                    onPreview={handlePreview}
                    onExport={handleExport}
                    isDisplayed={displayedZoneId === item.id}
                    colors={colors}
                  />
                )}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={true}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>

    <Modal
      visible={!!renamingZoneId}
      transparent
      animationType="fade"
      onRequestClose={handleRenameCancel}
    >
      <Pressable style={styles.renameBackdrop} onPress={handleRenameCancel}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.renameModalCenter}
        >
          <Pressable style={[styles.renameBox, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.renameTitle, { color: colors.text }]}>Rename zone</Text>
            <TextInput
              value={renamingName}
              onChangeText={setRenamingName}
              placeholder="Zone name"
              placeholderTextColor={colors.muted}
              style={[styles.renameInput, { color: colors.text, borderColor: colors.border }]}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={handleRenameSave}
            />
            <View style={styles.renameActions}>
              <TouchableOpacity onPress={handleRenameCancel} style={[styles.renameButton, { borderColor: colors.border }]}>
                <Text style={[styles.renameButtonText, { color: colors.muted }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRenameSave}
                style={[styles.renameButton, styles.renameButtonPrimary, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.renameButtonText, styles.renameButtonTextPrimary]}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  panelWrapperIpad: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    borderRightWidth: 1,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    overflow: "hidden",
  },
  panelWrapperIphone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  panelIpad: {
    flex: 1,
  },
  panelIphone: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  clearPreviewButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  clearPreviewText: {
    fontSize: 13,
    ...Fonts?.medium,
  },
  closeButton: {
    padding: 4,
  },
  subtitle: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  clearButtonText: {
    fontSize: 14,
    ...Fonts?.medium,
  },
  listContainer: {
    flex: 1,
    minHeight: 120,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  rowMeta: {
    fontSize: 13,
    marginBottom: 1,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowActionButton: {
    padding: 8,
  },
  rowActionButtonMinTouch: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButton: {
    padding: 8,
    marginLeft: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: "center",
  },
  renameBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  renameModalCenter: {
    width: "100%",
    maxWidth: 340,
  },
  renameBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
  renameTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 12,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
  },
  renameActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  renameButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
  },
  renameButtonPrimary: {
    borderWidth: 0,
  },
  renameButtonText: {
    fontSize: 16,
    ...Fonts?.medium,
  },
  renameButtonTextPrimary: {
    color: "#fff",
  },
});
