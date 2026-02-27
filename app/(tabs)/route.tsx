/**
 * Route tab — driver's primary route view showing the minimal stop list
 * with stats (distance, stops remaining, ETA).
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/lib/theme-provider";
import { ScreenContainer } from "@/components/screen-container";
import { MinimalRouteView } from "@/components/route/MinimalRouteView";

export default function RouteScreen() {
  const { theme } = useTheme();

  return (
    <ScreenContainer style={{ backgroundColor: theme.bg }}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Route</Text>
      </View>

      <MinimalRouteView />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
});
