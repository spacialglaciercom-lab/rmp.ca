/**
 * Weather condition icon with neon glow (cyberpunk aesthetic).
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";

let MCIcon: React.ComponentType<{
  name: string;
  size: number;
  color: string;
}> | null = null;
try {
  MCIcon = require("@expo/vector-icons/MaterialCommunityIcons").default;
} catch {
  //
}

export type WeatherConditionType =
  | "clear"
  | "clouds"
  | "rain"
  | "snow"
  | "wind"
  | "unknown";

function conditionToIcon(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle")) return "weather-rainy";
  if (c.includes("snow")) return "weather-snowy";
  if (c.includes("cloud")) return "cloud";
  if (c.includes("wind")) return "weather-windy";
  return "weather-sunny";
}

export interface WeatherIndicatorProps {
  condition: string;
  size?: number;
  /** When true, applies neon glow (shadow). */
  glow?: boolean;
}

function WeatherIndicatorInner({
  condition,
  size = 24,
  glow = true,
}: WeatherIndicatorProps) {
  const colors = useColors();
  const iconName = conditionToIcon(condition);
  const glowColor = colors.accentCyan ?? colors.primary ?? "#00d9ff";

  if (!MCIcon) {
    return (
      <View style={[styles.wrapper, { width: size, height: size }]}>
        <Text style={{ fontSize: size * 0.6, color: colors.muted }}>?</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrapper,
        {
          width: size + (glow ? 8 : 0),
          height: size + (glow ? 8 : 0),
          ...(glow && {
            shadowColor: glowColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 6,
            elevation: 6,
          }),
        },
      ]}
    >
      <MCIcon
        name={iconName}
        size={size}
        color={glow ? glowColor : colors.foreground}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    justifyContent: "center",
    alignItems: "center",
  },
});

export const WeatherIndicator = React.memo(WeatherIndicatorInner);
