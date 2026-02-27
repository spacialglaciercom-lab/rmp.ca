import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { useColors } from "@/hooks/use-colors";

const TURN_LABELS: Record<string, string> = {
  straight: "Straight ahead",
  right: "Right turns",
  left: "Left turns",
  uturn: "U-turns (last resort)",
};

export interface PriorityOrderDisplayProps {
  order: string[];
}

export function PriorityOrderDisplay({ order }: PriorityOrderDisplayProps) {
  const colors = useColors();
  const fullOrder = ["straight", ...order];

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.primary + "12" },
      ]}
    >
      <Text style={[styles.label, { color: colors.primary }]}>
        Turn Priority Order
      </Text>
      <View style={styles.chain}>
        {fullOrder.map((turn, index) => (
          <React.Fragment key={turn}>
            <Text
              style={[styles.item, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {TURN_LABELS[turn] ?? turn}
            </Text>
            {index < fullOrder.length - 1 && (
              <Text style={[styles.arrow, { color: colors.muted }]}>→</Text>
            )}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
  },
  chain: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  item: {
    fontSize: 13,
  },
  arrow: {
    fontSize: 13,
    fontWeight: "300",
  },
});
