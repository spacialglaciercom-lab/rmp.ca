/**
 * Map Orientation setting: North up, direction of movement, or compass.
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  StyleSheet,
} from "react-native";
import {
  useMapOrientation,
  MAP_ORIENTATION_LABELS,
  type MapOrientation,
} from "@/lib/map-orientation-preference";
import { useTheme } from "@/lib/theme-provider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

const OPTIONS: MapOrientation[] = ["north", "course", "compass"];

export const MapOrientationSection: React.FC = () => {
  const [orientation, setOrientation] = useMapOrientation();
  const theme = useTheme();

  const handleSelect = (opt: MapOrientation) => {
    hapticImpact();
    setOrientation(opt);
  };

  const handlePress = () => {
    if (Platform.OS !== "web") {
      hapticImpact();
      Alert.alert("Map Orientation", "Choose how the map rotates:", [
        { text: "Cancel", style: "cancel" },
        ...OPTIONS.map((opt) => ({
          text: MAP_ORIENTATION_LABELS[opt],
          onPress: () => setOrientation(opt),
        })),
      ]);
    }
  };

  if (Platform.OS === "web") {
    return (
      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.text }]}>
          Map Orientation
        </Text>
        <Text style={[styles.description, { color: theme.textTertiary }]}>
          North up, direction of movement, or compass
        </Text>
        <View style={styles.optionsRow}>
          {OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt}
              onPress={() => handleSelect(opt)}
              style={[
                styles.optionButton,
                {
                  backgroundColor:
                    orientation === opt ? theme.accent + "30" : theme.border,
                  borderColor:
                    orientation === opt ? theme.accent : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  {
                    color:
                      orientation === opt ? theme.accent : theme.textSecondary,
                  },
                ]}
                numberOfLines={2}
              >
                {opt === "north"
                  ? "North up"
                  : opt === "course"
                    ? "Direction"
                    : "Compass"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.row}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: theme.text }]}>
          Map Orientation
        </Text>
        <Text style={[styles.description, { color: theme.textTertiary }]}>
          North up, direction of movement, or compass
        </Text>
      </View>
      <Text style={[styles.value, { color: theme.textSecondary }]}>
        {MAP_ORIENTATION_LABELS[orientation]}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  label: {
    fontSize: 15,
    fontWeight: "500",
  },
  description: {
    fontSize: 12,
    marginTop: 4,
  },
  value: {
    fontSize: 14,
    marginLeft: 12,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
  },
  optionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
