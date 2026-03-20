/**
 * In-navigation power mode indicator – subtle badge showing current mode.
 * Long-press on battery area could open quick switcher (future).
 */
import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { usePowerSaving } from "@/src/powerSaving";
import { POWER_MODE_LABELS, type PowerMode } from "@/src/powerSaving";
import { useTheme } from "@/lib/theme-provider";

const MODE_COLORS: Record<PowerMode, { bg: string; text: string }> = {
  performance: { bg: "rgba(34,197,94,0.2)", text: "#22c55e" },
  balanced: { bg: "rgba(234,179,8,0.2)", text: "#eab308" },
  ultra: { bg: "rgba(239,68,68,0.2)", text: "#ef4444" },
};

interface PowerSavingIndicatorProps {
  /** Show compact (icon/short label) or full label */
  compact?: boolean;
}

export function PowerSavingIndicator({
  compact = true,
}: PowerSavingIndicatorProps) {
  const { mode, batteryLevel, isReady } = usePowerSaving();
  const theme = useTheme();
  if (!isReady) return null;

  const colors = MODE_COLORS[mode];
  const label = compact
    ? mode === "performance"
      ? "Perf"
      : mode === "balanced"
        ? "Bal"
        : "Ultra"
    : POWER_MODE_LABELS[mode];
  const batteryPct = Math.round(batteryLevel * 100);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      {!compact && (
        <Text style={[styles.battery, { color: theme.textTertiary }]}>
          {batteryPct}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  label: { fontSize: 11, fontWeight: "600" },
  battery: { fontSize: 10 },
});
