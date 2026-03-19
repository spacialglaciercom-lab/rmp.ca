/**
 * Map scale indicator — shows approximate scale (e.g. "— 2 km —").
 * Positioned bottom-left per Master Plan. Scale can be wired to map zoom later.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";

function ScaleBarInner() {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: colors.muted }]}>— 2 km —</Text>
    </View>
  );
}

export const ScaleBar = React.memo(ScaleBarInner);

const styles = StyleSheet.create({
  container: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  text: {
    fontSize: 12,
    fontWeight: "500",
  },
});
