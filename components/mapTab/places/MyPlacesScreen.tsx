/**
 * My Places screen — segment control: Favorites | Trips.
 * Composes FavoritesTab, TripsTab, ImportExportActions.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useDeviceType } from "@/hooks/useDeviceType";
import { FavoritesTab } from "./FavoritesTab";
import { TripsTab } from "./TripsTab";
import { ImportExportActions } from "./ImportExportActions";

const PANEL_WIDTH_IPAD = 400;

export type MyPlacesTab = "favorites" | "trips";

interface MyPlacesScreenProps {
  visible: boolean;
  onClose: () => void;
}

export function MyPlacesScreen({ visible, onClose }: MyPlacesScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();
  const [activeTab, setActiveTab] = useState<MyPlacesTab>("favorites");

  const handleClose = useCallback(() => {
    hapticImpact();
    onClose();
  }, [onClose]);

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
              My Places
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

          <ImportExportActions />

          <View style={[styles.segmentRow, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={[
                styles.segmentTab,
                activeTab === "favorites" && {
                  borderBottomColor: colors.primary,
                  borderBottomWidth: 2,
                },
              ]}
              onPress={() => {
                hapticImpact();
                setActiveTab("favorites");
              }}
            >
              <MaterialCommunityIcons
                name="star-outline"
                size={20}
                color={activeTab === "favorites" ? colors.primary : colors.muted}
              />
              <Text
                style={[
                  styles.segmentLabel,
                  {
                    color: activeTab === "favorites" ? colors.text : colors.muted,
                  },
                ]}
              >
                Favorites
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentTab,
                activeTab === "trips" && {
                  borderBottomColor: colors.primary,
                  borderBottomWidth: 2,
                },
              ]}
              onPress={() => {
                hapticImpact();
                setActiveTab("trips");
              }}
            >
              <MaterialCommunityIcons
                name="map-marker-path"
                size={20}
                color={activeTab === "trips" ? colors.primary : colors.muted}
              />
              <Text
                style={[
                  styles.segmentLabel,
                  { color: activeTab === "trips" ? colors.text : colors.muted },
                ]}
              >
                Trips
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tabContent}>
            {activeTab === "favorites" ? (
              <FavoritesTab onShowOnMap={handleClose} />
            ) : (
              <TripsTab onClose={handleClose} />
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
  segmentRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
  },
  segmentTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  segmentLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  tabContent: {
    flex: 1,
    minHeight: 200,
  },
});
