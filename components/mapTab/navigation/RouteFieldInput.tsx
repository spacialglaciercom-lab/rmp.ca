import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { TECH_NAV } from "./navigationTechStyle";

export interface RoutePoint {
  label: string;
  coords: { lat: number; lon: number } | null;
  useGPS?: boolean;
}

interface RouteFieldInputProps {
  label: "From" | "To";
  point: RoutePoint | null;
  placeholder?: string;
  onPress: () => void;
  onSwap?: () => void;
  onAdd?: () => void;
  showSwap?: boolean;
  showAdd?: boolean;
}

export function RouteFieldInput({
  label,
  point,
  placeholder = "Select destination",
  onPress,
  onSwap,
  onAdd,
  showSwap = false,
  showAdd = false,
}: RouteFieldInputProps) {
  const colors = useColors();

  const handlePress = () => {
    if (Platform.OS !== "web") hapticImpact();
    onPress();
  };

  const displayText = point?.label ?? placeholder;
  const isMyPosition = point?.useGPS === true;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TouchableOpacity
        style={[
          styles.field,
          {
            borderColor: TECH_NAV.inputBorder,
            backgroundColor: colors.surface,
            borderRadius: TECH_NAV.radiusInput,
          },
        ]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.leftContent}>
          <MaterialCommunityIcons
            name={isMyPosition ? "crosshairs-gps" : "map-marker-outline"}
            size={20}
            color={isMyPosition ? colors.primary : colors.muted}
          />
          <Text
            style={[styles.fieldText, { color: point ? colors.text : colors.muted }]}
            numberOfLines={1}
          >
            {displayText}
          </Text>
        </View>
        <View style={styles.actions}>
          {showSwap && onSwap && (
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") hapticImpact();
                onSwap();
              }}
              style={styles.iconButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="swap-vertical" size={22} color={colors.muted} />
            </TouchableOpacity>
          )}
          {showAdd && onAdd && (
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") hapticImpact();
                onAdd();
              }}
              style={styles.iconButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="plus" size={22} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  leftContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  fieldText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconButton: {
    padding: 4,
  },
});
