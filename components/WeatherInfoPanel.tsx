/**
 * Weather info panel: real stats along the route (temp, wind, precip, conditions).
 * Replaces the previous risk/delay/segment-bar UI with actual weather data.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { WeatherIndicator } from "./WeatherIndicator";
import type {
  WeatherAnalysisResult,
  RouteWeatherSummary,
} from "@/services/weatherAnalysis";

function windDegToLabel(deg: number): string {
  if (deg >= 338 || deg < 23) return "N";
  if (deg >= 23 && deg < 68) return "NE";
  if (deg >= 68 && deg < 113) return "E";
  if (deg >= 113 && deg < 158) return "SE";
  if (deg >= 158 && deg < 203) return "S";
  if (deg >= 203 && deg < 248) return "SW";
  if (deg >= 248 && deg < 293) return "W";
  return "NW";
}

function StatRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

export interface WeatherInfoPanelProps {
  analysis: WeatherAnalysisResult;
  /** Optional main condition for header icon */
  mainCondition?: string;
}

export function WeatherInfoPanel({
  analysis,
  mainCondition = "Clear",
}: WeatherInfoPanelProps) {
  const colors = useColors();
  const summary: RouteWeatherSummary | undefined = analysis.routeWeatherSummary;

  return (
    <View
      style={[
        styles.glass,
        {
          backgroundColor: (colors.surface ?? "#1a1a1a") + "e6",
          borderColor: colors.border ?? "rgba(128,128,128,0.3)",
        },
      ]}
    >
      <View style={styles.header}>
        <WeatherIndicator condition={mainCondition} size={28} glow />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Weather along route
        </Text>
      </View>

      {summary ? (
        <View style={styles.stats}>
          <StatRow
            label="Temperature"
            value={
              summary.tempMin === summary.tempMax
                ? `${summary.tempMax}°C (feels like ${summary.feelsLike}°C)`
                : `${summary.tempMin}–${summary.tempMax}°C (feels like ${summary.feelsLike}°C)`
            }
            colors={colors}
          />
          <StatRow
            label="Wind"
            value={`${(summary.windSpeedMax * 3.6).toFixed(1)} km/h ${windDegToLabel(summary.windDeg)}`}
            colors={colors}
          />
          <StatRow
            label="Humidity"
            value={`${summary.humidity}%`}
            colors={colors}
          />
          {(summary.rainMmh > 0 || summary.snowMmh > 0) && (
            <StatRow
              label="Precipitation"
              value={[
                summary.rainMmh > 0
                  ? `Rain ${summary.rainMmh.toFixed(1)} mm/h`
                  : null,
                summary.snowMmh > 0
                  ? `Snow ${summary.snowMmh.toFixed(1)} mm/h`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              colors={colors}
            />
          )}
          {summary.visibilityMin < 10000 && (
            <StatRow
              label="Visibility"
              value={
                summary.visibilityMin >= 1000
                  ? `${(summary.visibilityMin / 1000).toFixed(1)} km`
                  : `${summary.visibilityMin} m`
              }
              colors={colors}
            />
          )}
          {summary.conditions.length > 0 && (
            <StatRow
              label="Conditions"
              value={summary.conditions.join(", ")}
              colors={colors}
            />
          )}
        </View>
      ) : (
        <Text style={[styles.fallback, { color: colors.muted }]}>
          No weather data for this route. Enable Weather-Optimized Routing and
          generate a route.
        </Text>
      )}

      {analysis.alerts.length > 0 && (
        <View
          style={[
            styles.alertStrip,
            {
              backgroundColor: (colors.warning ?? "#ff6b4a") + "18",
              borderLeftColor: colors.warning ?? "#ff6b4a",
            },
          ]}
        >
          {analysis.alerts.slice(0, 3).map((a, i) => (
            <Text
              key={i}
              style={[styles.alertText, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {a}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginVertical: 8,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 12,
  },
  stats: {
    gap: 6,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },
  statLabel: {
    fontSize: 13,
  },
  statValue: {
    fontSize: 13,
    fontWeight: "500",
  },
  fallback: {
    fontSize: 13,
    marginBottom: 4,
  },
  alertStrip: {
    borderLeftWidth: 4,
    paddingLeft: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
  alertText: {
    fontSize: 12,
    marginVertical: 1,
  },
});
