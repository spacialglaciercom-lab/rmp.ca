import React from "react";
import { View, ViewStyle, StyleSheet, Platform } from "react-native";

import { useColors } from "@/hooks/use-colors";

type BorderVariant = "cyan" | "magenta" | "default";

export interface NeonCardProps {
  children: React.ReactNode;
  variant?: BorderVariant;
  style?: ViewStyle;
  /** Corner notch length in px */
  notchSize?: number;
  /** Border radius for the panel */
  borderRadius?: number;
  /** Inner padding */
  padding?: number;
}

/**
 * Semi-transparent panel with neon border and corner bracket notches.
 */
export function NeonCard({
  children,
  variant = "cyan",
  style,
  notchSize = 12,
  borderRadius = 16,
  padding = 18,
}: NeonCardProps) {
  const colors = useColors();
  const borderColor =
    variant === "cyan"
      ? "#00D9FF"
      : variant === "magenta"
        ? "#7B61FF"
        : "rgba(0, 217, 255, 0.3)";

  const glowShadow =
    Platform.OS === "ios"
      ? {
          shadowColor: borderColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 12,
        }
      : Platform.OS === "android"
        ? { elevation: 8 }
        : {};

  return (
    <View
      style={[
        styles.outer,
        {
          borderRadius,
          borderWidth: 1,
          borderColor,
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          padding,
          ...glowShadow,
        },
        style,
      ]}
    >
      {/* Corner notches - simple overlay squares */}
      <View style={[styles.notch, styles.notchTL, { width: notchSize, height: notchSize, borderColor }]} />
      <View style={[styles.notch, styles.notchTR, { width: notchSize, height: notchSize, borderColor }]} />
      <View style={[styles.notch, styles.notchBL, { width: notchSize, height: notchSize, borderColor }]} />
      <View style={[styles.notch, styles.notchBR, { width: notchSize, height: notchSize, borderColor }]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.15)',
  },
  content: {
    zIndex: 1,
  },
  notch: {
    position: "absolute",
    borderWidth: 2,
    backgroundColor: "transparent",
    zIndex: 0,
  },
  notchTL: { top: -1, left: -1, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  notchTR: { top: -1, right: -1, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  notchBL: { bottom: -1, left: -1, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  notchBR: { bottom: -1, right: -1, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
});
