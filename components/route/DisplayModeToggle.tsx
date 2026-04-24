/**
 * Segmented toggle for switching between Minimal and Full route display modes.
 * Pill-style with animated selection indicator.
 */

import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "@/lib/theme-provider";
import {
  useDisplayModeStore,
  type AppDisplayMode,
} from "@/stores/displayModeStore";

const TOGGLE_WIDTH = 220;
const SEGMENT_WIDTH = TOGGLE_WIDTH / 2;
const PILL_INSET = 3;

export function DisplayModeToggle() {
  const { theme } = useTheme();
  const mode = useDisplayModeStore((s) => s.mode);
  const setMode = useDisplayModeStore((s) => s.setMode);

  const translateX = useRef(
    new Animated.Value(
      mode === "minimal" ? PILL_INSET : SEGMENT_WIDTH + PILL_INSET,
    ),
  ).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: mode === "minimal" ? PILL_INSET : SEGMENT_WIDTH + PILL_INSET,
      useNativeDriver: true,
      tension: 300,
      friction: 25,
    }).start();
  }, [mode, translateX]);

  const handlePress = (newMode: AppDisplayMode) => {
    if (newMode !== mode) setMode(newMode);
  };

  const isDark = theme.bg === "#0C0C0C";
  const pillBg = isDark ? "#2A2A2A" : "#FFFFFF";
  const trackBg = isDark ? "#161616" : "#F0EEEC";
  const activeText = theme.text;
  const inactiveText = theme.textTertiary;

  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: trackBg,
          borderColor: theme.border,
          width: TOGGLE_WIDTH,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: pillBg,
            width: SEGMENT_WIDTH - PILL_INSET * 2,
            transform: [{ translateX }],
          },
        ]}
      />

      <TouchableOpacity
        style={styles.segment}
        activeOpacity={0.7}
        onPress={() => handlePress("minimal")}
      >
        <MaterialCommunityIcons
          name="format-list-bulleted"
          size={14}
          color={mode === "minimal" ? activeText : inactiveText}
        />
        <Text
          style={[
            styles.label,
            { color: mode === "minimal" ? activeText : inactiveText },
          ]}
        >
          Minimal
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.segment}
        activeOpacity={0.7}
        onPress={() => handlePress("full")}
      >
        <MaterialCommunityIcons
          name="map-outline"
          size={14}
          color={mode === "full" ? activeText : inactiveText}
        />
        <Text
          style={[
            styles.label,
            { color: mode === "full" ? activeText : inactiveText },
          ]}
        >
          Full Map
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  pill: {
    position: "absolute",
    top: PILL_INSET,
    bottom: PILL_INSET,
    borderRadius: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    zIndex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
});
