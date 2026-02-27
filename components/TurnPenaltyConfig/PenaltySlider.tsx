import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  type ViewStyle,
} from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";

const MIN_TOUCH_SIZE = 44;
const STEP = 5;

export interface PenaltySliderProps {
  icon?: string;
  color: string;
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}

export function PenaltySlider({
  icon,
  color,
  label,
  description,
  value,
  onChange,
}: PenaltySliderProps) {
  const colors = useColors();

  const decrement = () => {
    hapticImpact();
    onChange(Math.max(0, value - STEP));
  };

  const increment = () => {
    hapticImpact();
    onChange(Math.min(100, value + STEP));
  };

  const buttonStyle: ViewStyle = {
    width: MIN_TOUCH_SIZE,
    height: MIN_TOUCH_SIZE,
    borderRadius: 8,
    backgroundColor: colors.muted + "30",
    justifyContent: "center",
    alignItems: "center",
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <View style={styles.labelGroup}>
          {icon != null ? (
            <Text style={[styles.icon, { color }]}>{icon}</Text>
          ) : (
            <View style={[styles.dot, { backgroundColor: color }]} />
          )}
          <Text style={[styles.label, { color: colors.foreground }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Text style={[styles.value, { color }]}>{value}</Text>
      </View>

      <Text style={[styles.description, { color: colors.muted }]} numberOfLines={2}>
        {description}
      </Text>

      <View style={styles.control}>
        <TouchableOpacity
          style={buttonStyle}
          onPress={decrement}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
        >
          <Text style={[styles.adjustText, { color: colors.foreground }]}>−</Text>
        </TouchableOpacity>

        <View style={[styles.track, { backgroundColor: colors.muted + "30" }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${value}%`,
                backgroundColor: color,
              },
            ]}
          />
        </View>

        <TouchableOpacity
          style={buttonStyle}
          onPress={increment}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
        >
          <Text style={[styles.adjustText, { color: colors.foreground }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: "transparent",
    borderRadius: 10,
    padding: 16,
    marginBottom: 24,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  labelGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  icon: {
    fontSize: 14,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
  value: {
    fontSize: 16,
    fontWeight: "700",
    minWidth: 30,
    textAlign: "right",
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  control: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 4,
  },
  adjustText: {
    fontSize: 18,
    fontWeight: "300",
  },
});
