import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { TECH_NAV } from "./navigationTechStyle";

export type TransportMode = "car" | "bike" | "walk";

interface TransportModeSelectorProps {
  value: TransportMode;
  onChange: (mode: TransportMode) => void;
}

const MODES: { id: TransportMode; icon: "car" | "bike" | "walk"; label: string }[] = [
  { id: "car", icon: "car", label: "Drive" },
  { id: "bike", icon: "bike", label: "Bike" },
  { id: "walk", icon: "walk", label: "Walk" },
];

export function TransportModeSelector({ value, onChange }: TransportModeSelectorProps) {
  const colors = useColors();

  const handlePress = (mode: TransportMode) => {
    if (Platform.OS !== "web") hapticImpact();
    onChange(mode);
  };

  return (
    <View style={styles.container}>
      {MODES.map((m) => {
        const active = value === m.id;
        return (
          <TouchableOpacity
            key={m.id}
            style={[
              styles.button,
              { borderColor: TECH_NAV.glassBorder },
              active && {
                backgroundColor: "rgba(59, 130, 246, 0.2)",
                borderColor: "rgba(59, 130, 246, 0.5)",
              },
            ]}
            onPress={() => handlePress(m.id)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={m.icon}
              size={22}
              color={active ? TECH_NAV.blueLight : colors.muted}
            />
            <Text
              style={[
                styles.label,
                { color: active ? TECH_NAV.blueLight : colors.muted },
              ]}
            >
              {m.label}
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
    gap: 10,
  },
  button: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: TECH_NAV.radiusInput,
    borderWidth: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
  },
});
