import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useState } from "react";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";

export interface GPXSimplificationSettings {
  enabled: boolean;
  tolerance: number; // in kilometers
  presetName: "none" | "light" | "medium" | "aggressive";
}

interface SimplificationPreset {
  name: string;
  description: string;
  tolerance: number;
  estimatedReduction: string;
}

const SIMPLIFICATION_PRESETS: Record<string, SimplificationPreset> = {
  none: {
    name: "No Simplification",
    description: "Keep all points (largest file size)",
    tolerance: 0,
    estimatedReduction: "0%",
  },
  light: {
    name: "Light (5m)",
    description: "Remove points within 5 meters of the route",
    tolerance: 0.005,
    estimatedReduction: "20-30%",
  },
  medium: {
    name: "Medium (10m)",
    description: "Remove points within 10 meters of the route",
    tolerance: 0.01,
    estimatedReduction: "40-50%",
  },
  aggressive: {
    name: "Aggressive (25m)",
    description: "Remove points within 25 meters of the route",
    tolerance: 0.025,
    estimatedReduction: "60-70%",
  },
};

export interface GPXSimplificationProps {
  onSettingsChange?: (settings: GPXSimplificationSettings) => void;
  defaultSettings?: GPXSimplificationSettings;
}

export function GPXSimplification({
  onSettingsChange,
  defaultSettings = {
    enabled: false,
    tolerance: 0.01,
    presetName: "medium",
  },
}: GPXSimplificationProps) {
  const colors = useColors();
  const { state, dispatch } = useRouting();
  const [settings, setSettings] = useState<GPXSimplificationSettings>(defaultSettings);

  const handlePresetSelect = (presetName: keyof typeof SIMPLIFICATION_PRESETS) => {
    hapticImpact();

    const preset = SIMPLIFICATION_PRESETS[presetName];
    const newSettings: GPXSimplificationSettings = {
      enabled: presetName !== "none",
      tolerance: preset.tolerance,
      presetName: presetName as "none" | "light" | "medium" | "aggressive",
    };

    setSettings(newSettings);
    onSettingsChange?.(newSettings);

    dispatch({
      type: "ADD_LOG_ENTRY",
      payload: {
        id: Date.now().toString(),
        timestamp: new Date(),
        message: `GPX simplification set to: ${preset.name}`,
        type: "info",
      },
    });
  };

  const estimateFileSizeReduction = () => {
    if (!state.statistics) return null;

    // Rough estimation: each point is ~200 bytes in GPX
    const originalSize = (state.statistics.totalTraversals * 200) / 1024; // KB
    const preset = SIMPLIFICATION_PRESETS[settings.presetName];

    // Parse reduction percentage
    const reductionStr = preset.estimatedReduction.split("-")[0].replace("%", "");
    const reductionPercent = parseInt(reductionStr) / 100;
    const savedSize = originalSize * reductionPercent;

    return {
      original: originalSize.toFixed(1),
      saved: savedSize.toFixed(1),
      final: (originalSize - savedSize).toFixed(1),
    };
  };

  const fileSizeEstimate = estimateFileSizeReduction();

  return (
    <View
      className="bg-surface rounded-2xl p-5 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-2">
        GPX Simplification
      </Text>
      <Text className="text-sm text-muted mb-4">
        Reduce file size by removing redundant points while preserving route accuracy
      </Text>

      {/* Preset Buttons */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mb-4"
        scrollEventThrottle={16}
      >
        <View className="flex-row gap-2">
          {Object.entries(SIMPLIFICATION_PRESETS).map(([key, preset]) => (
            <TouchableOpacity
              key={key}
              onPress={() => handlePresetSelect(key as "none" | "light" | "medium" | "aggressive")}
              style={{
                backgroundColor:
                  settings.presetName === (key as "none" | "light" | "medium" | "aggressive") ? colors.primary : colors.background,
                borderColor: settings.presetName === (key as "none" | "light" | "medium" | "aggressive") ? colors.primary : colors.border,
                borderWidth: 1,
              }}
              className="px-4 py-3 rounded-lg min-w-fit active:opacity-70"
            >
              <Text
                style={{
                  color: settings.presetName === key ? "#fff" : colors.foreground,
                }}
                className="font-medium text-sm"
              >
                {preset.name}
              </Text>
              <Text
                style={{
                  color: settings.presetName === key ? "#fff" : colors.muted,
                }}
                className="text-xs mt-1"
              >
                {preset.estimatedReduction}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Current Preset Description */}
      <View
        className="p-3 rounded-lg mb-4"
        style={{ backgroundColor: colors.background }}
      >
        <Text className="text-sm font-medium text-foreground">
          {SIMPLIFICATION_PRESETS[settings.presetName].description}
        </Text>
      </View>

      {/* File Size Estimate */}
      {fileSizeEstimate && settings.enabled && (
        <View
          className="p-3 rounded-lg mb-4"
          style={{ backgroundColor: colors.success + "15" }}
        >
          <Text style={{ color: colors.success }} className="text-xs font-medium mb-2">
            📊 Estimated File Size Savings
          </Text>
          <View className="flex-row justify-between">
            <Text style={{ color: colors.success }} className="text-xs">
              Original: {fileSizeEstimate.original} KB
            </Text>
            <Text style={{ color: colors.success }} className="text-xs font-bold">
              → {fileSizeEstimate.final} KB
            </Text>
          </View>
          <Text style={{ color: colors.success }} className="text-xs mt-1">
            Saves ~{fileSizeEstimate.saved} KB
          </Text>
        </View>
      )}

      {/* Info Box */}
      <View
        className="p-3 rounded-lg"
        style={{ backgroundColor: colors.warning + "15" }}
      >
        <Text style={{ color: colors.warning }} className="text-xs font-medium mb-1">
          💡 Tip
        </Text>
        <Text style={{ color: colors.warning }} className="text-xs">
          Use "Light" or "Medium" for most cases. "Aggressive" is best for very large routes
          with thousands of points.
        </Text>
      </View>
    </View>
  );
}
