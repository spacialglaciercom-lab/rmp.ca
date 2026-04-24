import React from "react";
import { View, Text, Switch, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";

interface ToggleSwitchRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  description?: string;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  labelContainer: {
    flex: 1,
    marginRight: 12,
  },
  label: {
    fontSize: 16,
  },
  description: {
    fontSize: 13,
    marginTop: 2,
  },
});

function ToggleSwitchRowInner({
  label,
  value,
  onValueChange,
  description,
}: ToggleSwitchRowProps) {
  const colors = useColors();

  return (
    <View style={[styles.row, { backgroundColor: colors.surface }]}>
      <View style={styles.labelContainer}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        {description && (
          <Text style={[styles.description, { color: colors.muted }]}>
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary + "60" }}
        thumbColor={value ? colors.primary : colors.muted}
      />
    </View>
  );
}

export const ToggleSwitchRow = React.memo(ToggleSwitchRowInner);
