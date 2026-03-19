/**
 * AI Route Analysis Panel - displays weather-aware AI analysis results
 */

import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/use-colors";

interface AIRouteAnalysisPanelProps {
  analysis: {
    averageSpeedMph: number;
    totalEstimatedTimeMinutes: number;
    confidenceScore: number;
    weatherImpactSeverity: "none" | "low" | "moderate" | "high";
    reasoning: string;
  } | null;
  visible: boolean;
  loading?: boolean;
}

function getImpactColor(
  severity: "none" | "low" | "moderate" | "high",
  colors: ReturnType<typeof useColors>,
): string {
  switch (severity) {
    case "none":
      return colors.success;
    case "low":
      return colors.primary;
    case "moderate":
      return colors.warning;
    case "high":
      return colors.error;
    default:
      return colors.muted;
  }
}

function getImpactText(severity: "none" | "low" | "moderate" | "high"): string {
  switch (severity) {
    case "none":
      return "No Impact";
    case "low":
      return "Low Impact";
    case "moderate":
      return "Moderate Impact";
    case "high":
      return "High Impact";
    default:
      return "Unknown";
  }
}

export function AIRouteAnalysisPanel({
  analysis,
  visible,
  loading = false,
}: AIRouteAnalysisPanelProps) {
  const colors = useColors();

  if (!visible) return null;

  if (loading) {
    return (
      <View
        className="rounded-2xl p-5 mb-4"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.08)",
          borderWidth: 1,
          borderColor: "rgba(0, 217, 255, 0.15)",
          shadowColor: "#00D9FF",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 4,
        }}
      >
        <Text
          className="text-lg font-semibold mb-4"
          style={{ color: "#00D9FF" }}
        >
          AI Route Analysis
        </Text>
        <View className="items-center py-4">
          <ActivityIndicator size="large" color="#00D9FF" />
          <Text
            className="text-sm mt-3"
            style={{ color: "rgba(255, 255, 255, 0.7)" }}
          >
            Analyzing route with AI...
          </Text>
        </View>
      </View>
    );
  }

  if (!analysis) {
    return (
      <View
        className="rounded-2xl p-5 mb-4"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.08)",
          borderWidth: 1,
          borderColor: "rgba(0, 217, 255, 0.15)",
          shadowColor: "#00D9FF",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 4,
        }}
      >
        <Text
          className="text-lg font-semibold mb-4"
          style={{ color: "#00D9FF" }}
        >
          AI Route Analysis
        </Text>
        <Text className="text-sm" style={{ color: "rgba(255, 255, 255, 0.7)" }}>
          No AI analysis available. Refresh weather data to analyze route
          conditions.
        </Text>
      </View>
    );
  }

  return (
    <View
      className="rounded-2xl p-5 mb-4"
      style={{
        backgroundColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        borderColor: "rgba(0, 217, 255, 0.15)",
        shadowColor: "#00D9FF",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
      }}
    >
      <Text className="text-lg font-semibold mb-4" style={{ color: "#00D9FF" }}>
        AI Route Analysis
      </Text>

      {/* Weather Impact */}
      <View className="mb-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text
            className="text-sm"
            style={{ color: "rgba(255, 255, 255, 0.7)" }}
          >
            Weather Impact
          </Text>
          <View
            className="px-3 py-1.5 rounded-lg"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              borderWidth: 1,
              borderColor: "rgba(0, 217, 255, 0.15)",
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: "#00D9FF" }}
            >
              {getImpactText(analysis.weatherImpactSeverity)}
            </Text>
          </View>
        </View>
      </View>

      {/* Speed and Time */}
      <View className="mb-4">
        <View className="flex-row justify-between mb-2">
          <Text
            className="text-sm"
            style={{ color: "rgba(255, 255, 255, 0.7)" }}
          >
            Estimated Avg Speed
          </Text>
          <Text className="text-sm font-semibold" style={{ color: "#00D9FF" }}>
            {analysis.averageSpeedMph.toFixed(1)} mph
          </Text>
        </View>
        <View className="flex-row justify-between mb-2">
          <Text
            className="text-sm"
            style={{ color: "rgba(255, 255, 255, 0.7)" }}
          >
            Total Time
          </Text>
          <Text className="text-sm font-semibold" style={{ color: "#00D9FF" }}>
            {analysis.totalEstimatedTimeMinutes.toFixed(0)} min
          </Text>
        </View>
      </View>

      {/* Confidence Score */}
      <View className="mb-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text
            className="text-sm"
            style={{ color: "rgba(255, 255, 255, 0.7)" }}
          >
            AI Confidence
          </Text>
          <Text className="text-sm font-semibold" style={{ color: "#00D9FF" }}>
            {(analysis.confidenceScore * 100).toFixed(0)}%
          </Text>
        </View>
        <View
          className="w-full h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: "rgba(255, 255, 255, 0.1)" }}
        >
          <View
            className="h-full rounded-full"
            style={{
              width: `${analysis.confidenceScore * 100}%`,
              backgroundColor: "#00D9FF",
            }}
          />
        </View>
      </View>

      {/* Reasoning */}
      {analysis.reasoning && (
        <View className="mb-2">
          <Text
            className="text-sm font-semibold mb-2"
            style={{ color: "#00D9FF" }}
          >
            Analysis
          </Text>
          <Text
            className="text-sm leading-5"
            style={{ color: "rgba(255, 255, 255, 0.7)" }}
          >
            {analysis.reasoning}
          </Text>
        </View>
      )}

      <Text
        className="text-xs mt-4"
        style={{ color: "rgba(255, 255, 255, 0.5)" }}
      >
        Powered by Liquid Leap AI • Cache: 10 min
      </Text>
    </View>
  );
}
