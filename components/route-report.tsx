import { View, Text } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import type { WeatherAnalysisResult } from "@/services/weatherAnalysis";

function weatherRiskColor(risk: number, colors: ReturnType<typeof useColors>): string {
  if (risk >= 70) return colors.accentMagenta ?? colors.error ?? "#ff00ff";
  if (risk >= 40) return colors.warning ?? "#ff6b4a";
  return colors.accentCyan ?? colors.primary ?? "#00d9ff";
}

export function RouteReport() {
  const colors = useColors();
  const { state } = useRouting();
  const report = state.report;
  const weatherAnalysis = state.weatherAnalysis;

  if (!report) {
    return (
      <View
        className="bg-surface rounded-2xl p-5 mb-4"
        style={{ backgroundColor: colors.surface }}
      >
        <Text className="text-lg font-semibold text-foreground mb-2">
          Route Report
        </Text>
        <Text className="text-muted text-sm">
          Report will appear here after route generation
        </Text>
      </View>
    );
  }

  const formatTime = (minutes: number) => {
    const capped = Math.min(minutes, 24 * 60);
    const hours = Math.floor(capped / 60);
    const mins = capped % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <View
      className="bg-surface rounded-2xl p-5 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-1">
        Route Report
      </Text>
      <Text className="text-xs text-muted mb-4">
        Generated: {formatDate(report.generatedAt)}
      </Text>

      {/* Title */}
      <View
        className="p-4 rounded-xl mb-4"
        style={{ backgroundColor: colors.primary + "15" }}
      >
        <Text className="text-primary font-semibold">{report.title}</Text>
      </View>

      {/* Guarantees Section */}
      <View className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-3">
          1. Route Guarantees
        </Text>
        <View
          className="p-3 rounded-lg"
          style={{ backgroundColor: colors.background }}
        >
          <View className="flex-row items-center mb-2">
            <Text
              className="mr-2"
              style={{
                color: report.guarantees.singleContinuousTrack
                  ? colors.success
                  : colors.error,
              }}
            >
              {report.guarantees.singleContinuousTrack ? "✓" : "✕"}
            </Text>
            <Text className="text-sm text-foreground">
              Single continuous track:{" "}
              {report.guarantees.singleContinuousTrack ? "YES" : "NO"}
            </Text>
          </View>
          <View className="flex-row items-center mb-2">
            <Text
              className="mr-2"
              style={{
                color: report.guarantees.rightSideArmLogic
                  ? colors.success
                  : colors.error,
              }}
            >
              {report.guarantees.rightSideArmLogic ? "✓" : "✕"}
            </Text>
            <Text className="text-sm text-foreground">
              Right-side arm logic:{" "}
              {report.guarantees.rightSideArmLogic
                ? "Every segment traversed in both directions"
                : "Incomplete"}
            </Text>
          </View>
          <View className="flex-row items-start">
            <Text className="mr-2" style={{ color: colors.success }}>
              ✓
            </Text>
            <Text className="text-sm text-foreground flex-1">
              Turn optimization: {report.guarantees.turnOptimization}
            </Text>
          </View>
        </View>
      </View>

      {/* Data Summary Section */}
      <View className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-3">
          2. Data Summary
        </Text>
        <View
          className="p-3 rounded-lg"
          style={{ backgroundColor: colors.background }}
        >
          <View className="mb-3">
            <Text className="text-xs text-muted mb-1">Included Tags</Text>
            <Text className="text-sm text-foreground">
              {report.dataSummary.includedTags.join(", ")}
            </Text>
          </View>
          <View className="mb-3">
            <Text className="text-xs text-muted mb-1">Excluded Tags</Text>
            <Text className="text-sm text-foreground">
              {report.dataSummary.excludedTags.join(", ")}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs text-muted">Connected Components</Text>
              <Text className="text-lg font-semibold text-foreground">
                {report.dataSummary.connectedComponents}
              </Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Segments Routed</Text>
              <Text
                className="text-lg font-semibold"
                style={{ color: colors.success }}
              >
                {report.dataSummary.segmentsRouted}
              </Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Segments Excluded</Text>
              <Text className="text-lg font-semibold text-muted">
                {report.dataSummary.segmentsExcluded}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Route Stats Section */}
      <View className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-3">
          3. Route Stats
        </Text>
        <View
          className="p-3 rounded-lg"
          style={{ backgroundColor: colors.background }}
        >
          <View className="flex-row justify-between mb-3">
            <View className="items-center flex-1">
              <Text className="text-xl font-bold text-primary">
                {report.routeStats.totalTraversals}
              </Text>
              <Text className="text-xs text-muted">Total Traversals</Text>
            </View>
            <View className="items-center flex-1">
              <Text className="text-xl font-bold text-primary">
                {report.routeStats.totalDistance.toFixed(1)} km
              </Text>
              <Text className="text-xs text-muted">Total Distance</Text>
            </View>
            <View className="items-center flex-1">
              <Text className="text-xl font-bold text-primary">
                {formatTime(Math.min(report.routeStats.estimatedTime, 24 * 60))}
              </Text>
              <Text className="text-xs text-muted">Est. Time (drive + stops)</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Operational Notes Section */}
      <View className="mb-4">
        <Text className="text-sm font-semibold text-foreground mb-3">
          4. Operational Notes
        </Text>
        <View
          className="p-3 rounded-lg"
          style={{ backgroundColor: colors.background }}
        >
          {report.operationalNotes.map((note, index) => (
            <View key={index} className="flex-row items-start mb-2">
              <Text className="text-muted mr-2">•</Text>
              <Text className="text-sm text-foreground flex-1">{note}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Weather along route (when available) */}
      {weatherAnalysis && (
        <View>
          <Text className="text-sm font-semibold text-foreground mb-3">
            5. Weather along route
          </Text>
          <View
            className="p-3 rounded-lg"
            style={{ backgroundColor: colors.background }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-xs text-muted">Overall risk</Text>
              <View
                className="px-3 py-1.5 rounded-lg"
                style={{
                  backgroundColor: weatherRiskColor(weatherAnalysis.overallRiskScore, colors) + "25",
                  borderWidth: 1,
                  borderColor: weatherRiskColor(weatherAnalysis.overallRiskScore, colors),
                }}
              >
                <Text
                  className="text-base font-bold"
                  style={{ color: weatherRiskColor(weatherAnalysis.overallRiskScore, colors) }}
                >
                  {weatherAnalysis.overallRiskScore}/100
                </Text>
              </View>
            </View>
            {weatherAnalysis.totalDelayMinutes > 0 && (
              <Text className="text-sm text-muted mb-3">
                ~{weatherAnalysis.totalDelayMinutes.toFixed(0)} min weather-related delay
              </Text>
            )}
            {weatherAnalysis.segmentRisks.length > 0 && (
              <View className="mb-3">
                <Text className="text-xs text-muted mb-2">Segment risk (start → end)</Text>
                <View className="flex-row flex-wrap gap-1">
                  {weatherAnalysis.segmentRisks.slice(0, 32).map((s) => (
                    <View
                      key={s.segmentIndex}
                      style={{
                        width: 8,
                        height: 20,
                        borderRadius: 2,
                        backgroundColor: weatherRiskColor(s.riskScore, colors),
                      }}
                    />
                  ))}
                </View>
                <Text className="text-xs text-muted mt-1">
                  Cyan = low · Yellow = moderate · Magenta = high
                </Text>
              </View>
            )}
            {weatherAnalysis.alerts.length > 0 && (
              <View
                className="p-2 rounded-lg mb-2"
                style={{ backgroundColor: (colors.warning ?? "#ff6b4a") + "18" }}
              >
                {weatherAnalysis.alerts.slice(0, 3).map((a, i) => (
                  <Text key={i} className="text-xs mb-1" style={{ color: colors.foreground }}>
                    ⚠️ {a}
                  </Text>
                ))}
              </View>
            )}
            {weatherAnalysis.recommendations.length > 0 && (
              <View>
                <Text className="text-xs font-semibold text-foreground mb-1">Recommendations</Text>
                {weatherAnalysis.recommendations.map((r, i) => (
                  <Text key={i} className="text-xs text-muted mb-1 pl-2">
                    • {r}
                  </Text>
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
