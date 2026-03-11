/**
 * Settings section: Power Saving Mode selector, auto-switch toggle, and thresholds.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  StyleSheet,
} from "react-native";
import { usePowerSaving } from "@/src/powerSaving";
import { POWER_MODE_LABELS, type PowerMode } from "@/src/powerSaving";
import { useTheme } from "@/lib/theme-provider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

const MODES: PowerMode[] = ["performance", "balanced", "ultra"];
const BATTERY_IMPACT: Record<PowerMode, string> = {
  performance: "8–12%/hr",
  balanced: "4–6%/hr",
  ultra: "1–2%/hr",
};

export const PowerSavingSettingsSection: React.FC = () => {
  const { mode, state, batteryLevel, setMode, setAutoSwitchEnabled, isReady } =
    usePowerSaving();
  const theme = useTheme();

  const handleSelectMode = (m: PowerMode) => {
    hapticImpact();
    setMode(m);
  };

  const handleToggleAuto = () => {
    hapticImpact();
    setAutoSwitchEnabled(!state.autoSwitchEnabled);
  };

  if (!isReady) return null;

  const batteryPct = Math.round(batteryLevel * 100);

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme.text }]}>
        Power saving mode
      </Text>
      <Text style={[styles.description, { color: theme.textTertiary }]}>
        Balance battery life with navigation accuracy. Battery: {batteryPct}%
      </Text>

      <View style={styles.modeRow}>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => handleSelectMode(m)}
            style={[
              styles.modeButton,
              {
                backgroundColor:
                  mode === m ? theme.accent + "25" : theme.border,
                borderColor: mode === m ? theme.accent : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.modeLabel,
                { color: mode === m ? theme.accent : theme.text },
              ]}
              numberOfLines={1}
            >
              {POWER_MODE_LABELS[m]}
            </Text>
            <Text style={[styles.modeImpact, { color: theme.textTertiary }]}>
              {BATTERY_IMPACT[m]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.toggleRow, { borderTopColor: theme.borderLight }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.toggleLabel, { color: theme.text }]}>
            Auto-switch by battery
          </Text>
          <Text style={[styles.toggleDesc, { color: theme.textTertiary }]}>
            Performance &gt;30%, Balanced 15–30%, Ultra &lt;15%
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.toggleTrack,
            {
              backgroundColor: state.autoSwitchEnabled
                ? theme.accent
                : theme.border,
            },
          ]}
          onPress={handleToggleAuto}
          activeOpacity={0.9}
        >
          <View
            style={[
              styles.toggleThumb,
              { marginLeft: state.autoSwitchEnabled ? 22 : 2 },
            ]}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { paddingVertical: 4 },
  label: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  description: { fontSize: 12, marginBottom: 12 },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
  },
  modeLabel: { fontSize: 12, fontWeight: "600" },
  modeImpact: { fontSize: 10, marginTop: 2 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    borderTopWidth: 1,
  },
  toggleLabel: { fontSize: 15, fontWeight: "500" },
  toggleDesc: { fontSize: 12, marginTop: 2 },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
});
