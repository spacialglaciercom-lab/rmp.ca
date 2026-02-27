import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import type { PresetName } from "@/hooks/useTurnPenaltyConfig";

const MIN_TOUCH_SIZE = 44;

export interface PresetSelectorProps {
  presets: readonly ("balanced" | "aggressive" | "minimal")[];
  activePreset: PresetName;
  onSelect: (preset: "balanced" | "aggressive" | "minimal") => void;
}

function formatLabel(preset: string): string {
  return preset.charAt(0).toUpperCase() + preset.slice(1);
}

export function PresetSelector({
  presets,
  activePreset,
  onSelect,
}: PresetSelectorProps) {
  const colors = useColors();

  return (
    <View style={styles.container}>
      {presets.map((preset) => {
        const isActive = activePreset === preset;
        return (
          <TouchableOpacity
            key={preset}
            style={[
              styles.presetButton,
              {
                backgroundColor: isActive ? colors.primary + "20" : colors.muted + "20",
                borderColor: isActive ? colors.primary : colors.border,
              },
            ]}
            onPress={() => {
              hapticImpact();
              onSelect(preset);
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[
                styles.label,
                { color: isActive ? colors.primary : colors.foreground },
              ]}
              numberOfLines={1}
            >
              {formatLabel(preset)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  presetButton: {
    flex: 1,
    minWidth: 80,
    minHeight: MIN_TOUCH_SIZE,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
});
