/**
 * Home / Work quick destination shortcuts. Per Master Plan §7.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";

export type QuickDestinationType = "home" | "work";

export interface QuickDestination {
  label: string;
  coords: { lat: number; lon: number };
}

interface QuickDestinationsProps {
  home: QuickDestination | null;
  work: QuickDestination | null;
  onSelect: (coords: { lat: number; lon: number }, label: string) => void;
  onAdd: (type: QuickDestinationType) => void;
}

export function QuickDestinations({
  home,
  work,
  onSelect,
  onAdd,
}: QuickDestinationsProps) {
  const colors = useColors();

  const handlePress = (
    dest: QuickDestination | null,
    type: QuickDestinationType,
  ) => {
    hapticImpact();
    if (dest) {
      onSelect(dest.coords, dest.label);
    } else {
      onAdd(type);
    }
  };

  return (
    <View style={[styles.section, { marginTop: 20 }]}>
      <SectionLabel color={colors.muted} style={{ marginTop: 0 }}>
        Quick destinations
      </SectionLabel>
      <View style={styles.row}>
        <TouchableOpacity
          style={[
            styles.card,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={() => handlePress(home, "home")}
        >
          <MaterialCommunityIcons
            name="home-outline"
            size={24}
            color={colors.primary}
          />
          <Text
            style={[styles.label, { color: colors.text }]}
            numberOfLines={1}
          >
            {home ? home.label : "Home"}
          </Text>
          <Text style={[styles.sublabel, { color: colors.muted }]}>
            {home
              ? `${home.coords.lat.toFixed(4)}, ${home.coords.lon.toFixed(4)}`
              : "Add"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.card,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={() => handlePress(work, "work")}
        >
          <MaterialCommunityIcons
            name="office-building-outline"
            size={24}
            color={colors.primary}
          />
          <Text
            style={[styles.label, { color: colors.text }]}
            numberOfLines={1}
          >
            {work ? work.label : "Work"}
          </Text>
          <Text style={[styles.sublabel, { color: colors.muted }]}>
            {work
              ? `${work.coords.lat.toFixed(4)}, ${work.coords.lon.toFixed(4)}`
              : "Add"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  row: {
    flexDirection: "row",
    gap: 12,
  },
  card: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
  },
  sublabel: {
    fontSize: 12,
    marginTop: 2,
  },
});
