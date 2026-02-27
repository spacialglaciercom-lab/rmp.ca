import React from "react";
import { TouchableOpacity, Text, StyleSheet, ViewStyle, Platform } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";

export interface NeoPrimaryButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "destructive";
  style?: ViewStyle;
  disabled?: boolean;
}

/**
 * Large CTA: primary = green with glow, secondary = gray, destructive = coral.
 * All caps, rounded, full-width with horizontal margins.
 */
export function NeoPrimaryButton({
  title,
  onPress,
  variant = "primary",
  style,
  disabled = false,
}: NeoPrimaryButtonProps) {
  const colors = useColors();

  const bg =
    variant === "primary"
      ? "rgba(0, 217, 255, 0.2)"
      : variant === "destructive"
        ? "rgba(255, 107, 74, 0.2)"
        : "rgba(255, 255, 255, 0.1)";
  const textColor = "white";

  const borderColor =
    variant === "primary"
      ? "#00D9FF"
      : variant === "destructive"
        ? "#FF6B4A"
        : "rgba(0, 217, 255, 0.3)";

  const shadow =
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
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => {
        hapticImpact();
        onPress();
      }}
      disabled={disabled}
      style={[
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: borderColor,
          borderWidth: 1,
          opacity: disabled ? 0.6 : 1,
          ...shadow,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { color: textColor }]}>{title.toUpperCase()}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  text: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: '#00D9FF',
    textShadowColor: 'rgba(0, 217, 255, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});
