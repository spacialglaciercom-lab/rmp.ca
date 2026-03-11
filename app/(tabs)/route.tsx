/**
 * Route tab — driver's primary route view showing the minimal stop list
 * with stats (distance, stops remaining, ETA).
 * When the Collection Route plugin is disabled, redirect to Home so the Route tab is fully hidden.
 */

import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme-provider";
import { ScreenContainer } from "@/components/screen-container";
import { MinimalRouteView } from "@/components/route/MinimalRouteView";
import { usePluginStore } from "@/stores/pluginStore";

export default function RouteScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const collectionRouteEnabled = usePluginStore((s) =>
    s.isPluginEnabled("collection-route", true),
  );

  useEffect(() => {
    if (!collectionRouteEnabled) {
      router.replace("/(tabs)");
    }
  }, [collectionRouteEnabled, router]);

  if (!collectionRouteEnabled) {
    return null;
  }

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
