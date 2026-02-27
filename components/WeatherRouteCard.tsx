/**
 * Weather info card for route: glassmorphic panel + recommendations + refresh.
 * Uses WeatherInfoPanel for gradient risk (cyan → yellow → magenta) and neon indicator.
 */

import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/use-colors";
import type { WeatherAnalysisResult } from "@/services/weatherAnalysis";
import { WeatherInfoPanel } from "./WeatherInfoPanel";

export interface WeatherRouteCardProps {
  analysis: WeatherAnalysisResult;
  /** When provided, shows a "Refresh weather" button to update in real time. */
  onRefreshWeather?: () => void | Promise<void>;
  /** User-friendly error to show (e.g. "Weather data unavailable. Using cached data.") */
  errorMessage?: string | null;
}

export function WeatherRouteCard({
  analysis,
  onRefreshWeather,
  errorMessage,
}: WeatherRouteCardProps) {
  const colors = useColors();
  const [refreshing, setRefreshing] = useState(false);
  const mainCondition = analysis.segmentRisks[0]?.condition ?? "Clear";

  const handleRefresh = async () => {
    if (!onRefreshWeather || refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshWeather();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      {errorMessage ? (
        <View style={[styles.errorBanner, { backgroundColor: (colors.warning ?? "#ff6b4a") + "20", borderColor: colors.warning ?? "#ff6b4a" }]}>
          <Text style={[styles.errorText, { color: colors.foreground }]}>{errorMessage}</Text>
        </View>
      ) : null}
      <WeatherInfoPanel analysis={analysis} mainCondition={mainCondition} />
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {onRefreshWeather && (
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={refreshing}
            style={[styles.refreshButton, { borderColor: colors.accentCyan ?? colors.primary }]}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.refreshLabel, { color: colors.accentCyan ?? colors.primary }]}>
                Refresh weather
              </Text>
            )}
          </TouchableOpacity>
        )}
        {analysis.recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recommendations</Text>
            {analysis.recommendations.map((r, i) => (
              <Text key={i} style={[styles.rec, { color: colors.muted }]}>{r}</Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 8,
  },
  errorBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
  },
  footer: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
  },
  refreshButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  refreshLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontWeight: "600",
    fontSize: 13,
    marginBottom: 6,
  },
  rec: {
    fontSize: 13,
    marginBottom: 4,
    lineHeight: 18,
  },
});
