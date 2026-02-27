import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Platform } from "react-native";
import { useMapType, type MapTypePreference } from "@/lib/map-type-preference";
import { useColors } from "@/hooks/use-colors";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { SectionLabel } from "@/components/minimal";

const SOURCES: { value: MapTypePreference; label: string; icon: "theme-light-dark" | "map-outline" }[] = [
  { value: "dark", label: "Dark", icon: "theme-light-dark" },
  { value: "standard", label: "Standard", icon: "map-outline" },
];

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

export function MapSourcePicker() {
  const colors = useColors();
  const [mapType, setMapType] = useMapType();
  const setActiveBaseLayer = useMapLayerStore((s) => s.setActiveBaseLayer);

  const handleSelect = (value: MapTypePreference) => {
    if (Platform.OS !== "web") hapticImpact();
    setMapType(value);
    setActiveBaseLayer(value);
  };

  return (
    <View style={styles.container}>
      <SectionLabel color={colors.primary} style={{ marginTop: 0, marginBottom: 12 }}>
        Map source
      </SectionLabel>
      {SOURCES.map(({ value, label, icon }) => {
        const isSelected = mapType === value;
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
                name={icon}
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
