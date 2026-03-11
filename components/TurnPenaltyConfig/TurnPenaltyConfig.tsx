import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import {
  impactAsync as hapticImpact,
  ImpactFeedbackStyle,
} from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useTurnPenaltyConfig } from "@/hooks/useTurnPenaltyConfig";
import type { TurnPenalties } from "@/types/routing";
import { PresetSelector } from "./PresetSelector";
import { PenaltySlider } from "./PenaltySlider";
import { PriorityOrderDisplay } from "./PriorityOrderDisplay";

const MIN_TOUCH_SIZE = 44;

const TURN_TYPES: {
  key: keyof TurnPenalties;
  label: string;
  description: string;
  colorKey: "warning" | "error" | "success";
}[] = [
  {
    key: "leftTurn",
    label: "Left Turn Penalty",
    description: "Penalty applied when the route requires a left turn",
    colorKey: "warning",
  },
  {
    key: "uTurn",
    label: "U-Turn Penalty",
    description: "Penalty applied when the route requires a U-turn (>150°)",
    colorKey: "error",
  },
  {
    key: "rightTurn",
    label: "Right Turn Penalty",
    description:
      "Penalty applied for right turns (usually 0 for right-side collection)",
    colorKey: "success",
  },
];

export interface TurnPenaltyConfigProps {
  initialConfig?: TurnPenalties | null;
  onApply?: (penalties: TurnPenalties) => void;
  className?: string;
}

export function TurnPenaltyConfig({
  initialConfig,
  onApply,
}: TurnPenaltyConfigProps) {
  const colors = useColors();
  const {
    config,
    isDirty,
    priorityOrder,
    setPreset,
    updatePenalty,
    applySettings,
    resetSettings,
    presets,
  } = useTurnPenaltyConfig(initialConfig ?? null);

  const handleApply = () => {
    hapticImpact(ImpactFeedbackStyle.Medium);
    const applied = applySettings();
    onApply?.(applied);
  };

  const handleReset = () => {
    hapticImpact();
    resetSettings();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Turn Penalty Configuration
        </Text>
        <Text style={[styles.sectionDescription, { color: colors.muted }]}>
          Adjust how aggressively the route avoids different turn types. Higher
          values mean stronger avoidance.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.subLabel, { color: colors.muted }]}>
          Quick Presets
        </Text>
        <PresetSelector
          presets={presets}
          activePreset={config.preset}
          onSelect={setPreset}
        />
      </View>

      <View style={styles.slidersContainer}>
        {TURN_TYPES.map((turnType) => (
          <PenaltySlider
            key={turnType.key}
            color={colors[turnType.colorKey]}
            label={turnType.label}
            description={turnType.description}
            value={config[turnType.key]}
            onChange={(val) => updatePenalty(turnType.key, val)}
          />
        ))}
      </View>

      <PriorityOrderDisplay order={priorityOrder} />

      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.applyButton,
            {
              backgroundColor: isDirty ? colors.primary : colors.muted,
              opacity: isDirty ? 1 : 0.6,
            },
          ]}
          onPress={handleApply}
          disabled={!isDirty}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>Apply Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.resetButton,
            {
              backgroundColor: colors.muted + "40",
              opacity: isDirty ? 1 : 0.6,
            },
          ]}
          onPress={handleReset}
          disabled={!isDirty}
          activeOpacity={0.7}
        >
          <Text style={[styles.resetButtonText, { color: colors.foreground }]}>
            Reset
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  subLabel: {
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  slidersContainer: {
    marginBottom: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  applyButton: {
    flex: 2,
    minHeight: MIN_TOUCH_SIZE,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  resetButton: {
    flex: 1,
    minHeight: MIN_TOUCH_SIZE,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
