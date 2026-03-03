/**
 * Zones screen — list saved zone partition results from the Zones store.
 * Opened from map sidebar (Zones, between Layers and My Places).
 */

import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  FlatList,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

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

function ZoneResultRow({
  item,
  onRemove,
  colors,
}: {
  item: SavedZoneResult;
  onRemove: (id: string) => void;
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
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.rowMain}>
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
      <TouchableOpacity
        onPress={handleRemove}
        style={styles.deleteButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MaterialCommunityIcons name="delete-outline" size={22} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

export function ZonesScreen({ visible, onClose }: ZonesScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();
  const savedZones = useZonesStore((s) => s.savedZones);
  const removeSavedZone = useZonesStore((s) => s.removeSavedZone);
  const clearAllSavedZones = useZonesStore((s) => s.clearAllSavedZones);

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
              Zones
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
  deleteButton: {
    padding: 8,
    marginLeft: 8,
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
});
