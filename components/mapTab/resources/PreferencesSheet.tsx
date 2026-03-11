import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";
import { useRouteParametersStore } from "@/stores/routeParametersStore";

const PREFER_OPTIONS = [
  {
    key: "allowPrivateAccess",
    label: "Allow private access",
    icon: "home-off-outline",
  },
  {
    key: "goodsDelivery",
    label: "Goods delivery",
    icon: "truck-delivery-outline",
  },
  { key: "fuelEfficientWay", label: "Fuel-efficient way", icon: "fuel" },
  {
    key: "considerTemporaryLimitations",
    label: "Consider temporary limitations",
    icon: "walk",
  },
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

export function PreferencesSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const store = useRouteParametersStore();

  const handleToggle = (key: keyof typeof store) => {
    if (Platform.OS !== "web") hapticImpact();
    // This will be handled by the parent component
    onClose();
  };

  return (
    <View style={styles.container}>
      <SectionLabel
        color={colors.primary}
        style={{ marginTop: 0, marginBottom: 12 }}
      >
        Route preferences
      </SectionLabel>
      {PREFER_OPTIONS.map(({ key, label, icon }) => {
        const value = store[key as keyof typeof store];
        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.optionRow,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            onPress={() => handleToggle(key as any)}
            activeOpacity={0.7}
          >
            <View style={styles.optionLeft}>
              <MaterialCommunityIcons
                name={icon as any}
                size={22}
                color={colors.muted}
              />
              <Text
                style={{ color: colors.text, fontSize: 16, fontWeight: "500" }}
              >
                {label}
              </Text>
            </View>
            <MaterialCommunityIcons
              name={value ? "checkbox-marked" : "checkbox-blank-outline"}
              size={20}
              color={value ? colors.primary : colors.muted}
              style={styles.checkIcon}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
