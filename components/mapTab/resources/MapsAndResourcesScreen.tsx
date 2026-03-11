import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useDeviceType } from "@/hooks/useDeviceType";
import { MapSourcePicker } from "./MapSourcePicker";
import { OverlayToggles } from "./OverlayToggles";
import { DisplayOptionsToggles } from "./DisplayOptionsToggles";
import { OSMEditingSection } from "@/components/mapTab/resources/OSMEditingSection";

const PANEL_WIDTH_IPAD = 400;

interface MapsAndResourcesScreenProps {
  visible: boolean;
  onClose: () => void;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  panelIpad: {
    flex: 1,
    borderRightWidth: 1,
  },
  panelIphone: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  scroll: {
    flex: 1,
    paddingBottom: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  section: {
    marginBottom: 28,
  },
});

export function MapsAndResourcesScreen({
  visible,
  onClose,
}: MapsAndResourcesScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();

  const handleClose = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onClose();
  }, [onClose]);

  if (!visible) return null;

  const isIpad = deviceType === "ipad";

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
            isIpad ? styles.panelIpad : styles.panelIphone,
            {
              width: isIpad ? PANEL_WIDTH_IPAD : undefined,
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 16,
              backgroundColor: colors.surface,
              borderRightColor: isIpad ? colors.border : undefined,
              borderTopLeftRadius: isIpad ? 0 : 16,
              borderTopRightRadius: isIpad ? 0 : 16,
              maxHeight: isIpad ? "100%" : "85%",
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity style={styles.backButton} onPress={handleClose}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={24}
                color={colors.text}
              />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Maps & Resources
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
          >
            <View style={styles.section}>
              <MapSourcePicker />
            </View>

            <View style={styles.section}>
              <OverlayToggles />
            </View>

            <View style={styles.section}>
              <DisplayOptionsToggles />
            </View>

            <View style={styles.section}>
              <OSMEditingSection />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
