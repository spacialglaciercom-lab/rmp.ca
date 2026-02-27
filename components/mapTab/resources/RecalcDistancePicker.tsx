import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";
import { RECALC_DISTANCE_OPTIONS, useRouteParametersStore } from "@/stores/routeParametersStore";

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  optionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkIcon: {
    width: 20,
    height: 20,
  },
});

export function RecalcDistancePicker({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const store = useRouteParametersStore();
  
  const handleSelect = (value: number) => {
    if (Platform.OS !== "web") hapticImpact();
    store.setRecalcDistanceMeters(value as any);
    onClose();
  };

  return (
    <View style={styles.container}>
      <SectionLabel color={colors.primary} style={{ marginTop: 0, marginBottom: 12 }}>
        Minimal distance to recalculate route
      </SectionLabel>
      {RECALC_DISTANCE_OPTIONS.map(({ value, label }) => {
        const isSelected = store.recalcDistanceMeters === value;
        return (
          <TouchableOpacity
            key={value}
            style={[
              styles.optionRow,
              {
                backgroundColor: colors.surface,
                borderColor: isSelected ? colors.primary : colors.border,
              },
            ]}
            onPress={() => handleSelect(value)}
            activeOpacity={0.7}
          >
            <View style={styles.optionLeft}>
              <MaterialCommunityIcons
                name="compass-outline"
                size={22}
                color={isSelected ? colors.primary : colors.muted}
              />
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "500" }}>
                {label}
              </Text>
            </View>
            {isSelected && (
              <MaterialCommunityIcons
                name="check"
                size={20}
                color={colors.primary}
                style={styles.checkIcon}
              />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}