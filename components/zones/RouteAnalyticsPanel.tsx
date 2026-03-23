/**
 * Route Analytics Panel — AI-powered post-route analysis.
 * Uses Vercel AI Gateway to generate logistics insights from PostGIS metrics.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";

interface RouteAnalyticsPanelProps {
  selectedRouteName: string | null;
}

export function RouteAnalyticsPanel({
  selectedRouteName,
}: RouteAnalyticsPanelProps) {
  const colors = useColors();
  const [aiReport, setAiReport] = useState<string | null>(null);

  const analyzeRoute = trpc.spatial.analyzeRoutePerformance.useMutation({
    onSuccess: (data) => {
      setAiReport(data.analysis);
    },
    onError: (error) => {
      console.error("AI Analysis failed:", error.message);
      setAiReport(`Error: ${error.message}`);
    },
  });

  const handleAnalyze = () => {
    if (!selectedRouteName) return;
    setAiReport(null);
    analyzeRoute.mutate({ routeName: selectedRouteName });
  };

  if (!selectedRouteName) {
    return null;
  }

  return (
    <View style={styles.panelContainer}>
      <View style={styles.headerRow}>
        <MaterialCommunityIcons
          name="robot-outline"
          size={20}
          color={colors.primary}
        />
        <Text style={[styles.header, { color: colors.text }]}>
          AI Insights
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.aiButton,
          { backgroundColor: analyzeRoute.isPending ? colors.muted : colors.primary },
        ]}
        onPress={handleAnalyze}
        disabled={analyzeRoute.isPending}
      >
        {analyzeRoute.isPending ? (
          <View style={styles.buttonContent}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.buttonText}>Analyzing Spatial Data...</Text>
          </View>
        ) : (
          <View style={styles.buttonContent}>
            <MaterialCommunityIcons
              name="chart-scatter-plot"
              size={18}
              color="#fff"
            />
            <Text style={styles.buttonText}>Run AI Route Analysis</Text>
          </View>
        )}
      </TouchableOpacity>

      {analyzeRoute.isPending && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>
            Processing route metrics via PostGIS...
          </Text>
        </View>
      )}

      {aiReport && (
        <ScrollView
          style={[styles.reportCard, { backgroundColor: colors.background }]}
          contentContainerStyle={styles.reportContent}
        >
          <View style={styles.reportHeader}>
            <MaterialCommunityIcons
              name="lightbulb-outline"
              size={18}
              color={colors.primary}
            />
            <Text style={[styles.reportTitle, { color: colors.primary }]}>
              AI Analysis
            </Text>
          </View>
          <Text style={[styles.reportText, { color: colors.text }]}>
            {aiReport}
          </Text>
          {analyzeRoute.data?.rawStats && (
            <View style={styles.statsRow}>
              <Text style={[styles.statsLabel, { color: colors.muted }]}>
                Route: {analyzeRoute.data.rawStats.routeName}
              </Text>
              <Text style={[styles.statsValue, { color: colors.muted }]}>
                {analyzeRoute.data.rawStats.totalBinsCollected} bins ·{" "}
                {analyzeRoute.data.rawStats.totalDistanceKm.toFixed(2)} km
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {analyzeRoute.isError && !aiReport && (
        <View style={[styles.errorCard, { backgroundColor: colors.background }]}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={20}
            color="#ef4444"
          />
          <Text style={[styles.errorText, { color: "#ef4444" }]}>
            Analysis failed. Check your AI Gateway API key.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panelContainer: {
    marginTop: 16,
    paddingHorizontal: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  header: {
    fontSize: 16,
    fontWeight: "600",
  },
  aiButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  loadingContainer: {
    marginTop: 20,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
  },
  reportCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.3)",
  },
  reportContent: {
    flexGrow: 1,
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  reportTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  reportText: {
    fontSize: 14,
    lineHeight: 22,
  },
  statsRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 4,
  },
  statsLabel: {
    fontSize: 12,
  },
  statsValue: {
    fontSize: 12,
  },
  errorCard: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
});