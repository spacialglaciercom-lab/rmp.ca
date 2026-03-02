import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Platform, TouchableOpacity, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { useDeviceType } from "@/hooks/useDeviceType";
import { useIsLandscape } from "@/hooks/useDeviceType";
import { SIDEBAR_MENU_ITEMS, SIDEBAR_WIDTH_IPHONE, SIDEBAR_WIDTH_IPAD } from "@/constants/sidebarConfig";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SidebarMenuItemRow } from "./SidebarMenuItem";
import { useColors } from "@/hooks/use-colors";

const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.5 };

export function MapSidebar() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const deviceType = useDeviceType();
  const isOpen = useMapSidebarStore((s) => s.isOpen);
  const closeSidebar = useMapSidebarStore((s) => s.closeSidebar);
  const openNavigationPanel = useMapSidebarStore((s) => s.openNavigationPanel);
  const openMapsResources = useMapSidebarStore((s) => s.openMapsResources);
  const openConfigureScreen = useMapSidebarStore((s) => s.openConfigureScreen);
  const openMyPlacesPanel = useMapSidebarStore((s) => s.openMyPlacesPanel);
  const openMapMarkersPanel = useMapSidebarStore((s) => s.openMapMarkersPanel);
  const openMapStylePicker = useMapSidebarStore((s) => s.openMapStylePicker);
  const openRouteParametersPanel = useMapSidebarStore((s) => s.openRouteParametersPanel);
  const openOSMExtractor = useMapSidebarStore((s) => s.openOSMExtractor);
  const openRecordingPanel = useMapSidebarStore((s) => s.openRecordingPanel);
  const isPinned = useMapSidebarStore((s) => s.isPinned);
  const togglePin = useMapSidebarStore((s) => s.togglePin);

  const isLandscape = useIsLandscape();
  const isCompact = useWindowDimensions().width < 600;
  const showPinButton = deviceType === "ipad" && isLandscape && !isCompact;

  const sidebarWidth = deviceType === "ipad" ? SIDEBAR_WIDTH_IPAD : SIDEBAR_WIDTH_IPHONE;
  const translateX = useSharedValue(-sidebarWidth);

  useEffect(() => {
    const targetX = isPinned ? 0 : isOpen ? 0 : -sidebarWidth;
    translateX.value = withSpring(targetX, SPRING_CONFIG);
  }, [isOpen, isPinned, sidebarWidth]);

  const closeWithHaptic = () => {
    if (Platform.OS !== "web") hapticImpact();
    closeSidebar();
  };

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationX < 0) {
        translateX.value = Math.max(-sidebarWidth, e.translationX);
      }
    })
    .onEnd((e) => {
      if (e.velocityX < -200 || e.translationX < -sidebarWidth / 2) {
        translateX.value = withSpring(-sidebarWidth, SPRING_CONFIG, () => {
          runOnJS(closeWithHaptic)();
        });
      } else {
        translateX.value = withSpring(0, SPRING_CONFIG);
      }
    });

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const handleMenuPress = (id: string) => {
    switch (id) {
      case "map":
        openMapStylePicker();
        break;
      case "layers":
        closeSidebar();
        router.push("/(tabs)/map-layers");
        break;
      case "navigation":
        openNavigationPanel();
        break;
      case "places":
        openMyPlacesPanel();
        break;
      case "resources":
        openMapsResources();
        break;
      case "configure":
        openConfigureScreen();
        break;
      case "routeParameters":
        openRouteParametersPanel();
        break;
      case "osmExtractor":
        openOSMExtractor();
        break;
      case "recording":
        openRecordingPanel();
        break;
      case "markers":
        openMapMarkersPanel();
        break;
      case "settings":
        closeSidebar();
        router.push("/(tabs)/settings");
        break;
      case "help":
        closeSidebar();
        router.push("/(tabs)/help");
        break;
      default:
        break;
    }
  };

  // When pinned, no backdrop (sidebar is docked); backdrop closes sidebar when not pinned
  const showBackdrop = isOpen && !isPinned;

  return (
    <>
      {showBackdrop && (
        <Pressable
          style={[
            styles.backdrop,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
          onPress={closeWithHaptic}
        />
      )}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          pointerEvents={isOpen || isPinned ? "auto" : "none"}
          style={[
            styles.sidebar,
            {
              width: sidebarWidth,
              paddingTop: insets.top + 20,
              backgroundColor: colors.surface,
              borderRightColor: colors.border,
            },
            sidebarAnimatedStyle,
          ]}
        >
          <View style={[styles.header, styles.headerRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              trashroute-mobile
            </Text>
            {showPinButton && (
              <TouchableOpacity
                onPress={() => {
                  hapticImpact();
                  togglePin();
                }}
                style={styles.pinButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons
                  name={isPinned ? "pin" : "pin-outline"}
                  size={22}
                  color={isPinned ? colors.primary : colors.muted}
                />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.menuList}>
            {SIDEBAR_MENU_ITEMS.map((item) =>
              item.isSeparator ? (
                <SidebarMenuItemRow key={item.id} item={item} />
              ) : (
                <SidebarMenuItemRow
                  key={item.id}
                  item={item}
                  onPress={() => handleMenuPress(item.id)}
                />
              )
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    zIndex: 999,
  },
  sidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    borderRightWidth: 1,
    zIndex: 1000,
  },
  header: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pinButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  menuList: {
    flex: 1,
    paddingTop: 8,
  },
});
