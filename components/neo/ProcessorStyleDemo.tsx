/**
 * Processor Style Demo Component
 * Shows the processor aesthetic with animations
 */

import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { ProcessorBackground } from "./ProcessorBackground";
import { NeonCard } from "./NeonCard";

export function ProcessorStyleDemo() {
  const colors = useColors();
  const [processorActive, setProcessorActive] = useState(false);
  const [efficiency, setEfficiency] = useState(75);

  useEffect(() => {
    const interval = setInterval(() => {
      setProcessorActive((prev) => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const ProcessorStatusIndicator = () => (
    <View
      style={[
        styles.processorIndicator,
        { backgroundColor: colors.surface + "80" },
      ]}
    >
      <View
        style={[
          styles.processorPulse,
          {
            backgroundColor: processorActive ? colors.success : colors.primary,
            shadowColor: processorActive ? colors.success : colors.primary,
          },
        ]}
      />
      <Text style={[styles.processorText, { color: colors.foreground }]}>
        PROCESSOR {processorActive ? "ACTIVE" : "STANDBY"}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ProcessorBackground />
      <View style={{ padding: 20, paddingTop: 60 }}>
        <ProcessorStatusIndicator />

        <Text
          style={[styles.title, { color: colors.foreground, marginBottom: 20 }]}
        >
          Processor-Style UI Demo
        </Text>

        <NeonCard variant="cyan" padding={20} style={{ marginBottom: 20 }}>
          <View style={styles.processorRow}>
            <View
              style={[
                styles.processorIcon,
                { backgroundColor: colors.success + "20" },
              ]}
            >
              <Text
                style={[styles.processorIconText, { color: colors.success }]}
              >
                ▶
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.processorTitle, { color: colors.foreground }]}
              >
                Route Processor Active
              </Text>
              <Text style={[styles.processorSubtitle, { color: colors.muted }]}>
                Processing collection points
              </Text>
            </View>
          </View>

          <View style={styles.processorMetrics}>
            <View style={styles.processorMetric}>
              <Text
                style={[styles.processorMetricLabel, { color: colors.muted }]}
              >
                COMPLETED
              </Text>
              <Text
                style={[styles.processorMetricValue, { color: colors.success }]}
              >
                24
              </Text>
            </View>
            <View style={styles.processorMetric}>
              <Text
                style={[styles.processorMetricLabel, { color: colors.muted }]}
              >
                PENDING
              </Text>
              <Text
                style={[styles.processorMetricValue, { color: colors.warning }]}
              >
                8
              </Text>
            </View>
            <View style={styles.processorMetric}>
              <Text
                style={[styles.processorMetricLabel, { color: colors.muted }]}
              >
                EFFICIENCY
              </Text>
              <Text
                style={[styles.processorMetricValue, { color: colors.primary }]}
              >
                {efficiency}%
              </Text>
            </View>
          </View>

          <View style={styles.processorProgressBar}>
            <View
              style={[
                styles.processorProgressFill,
                {
                  width: `${efficiency}%`,
                  backgroundColor:
                    efficiency >= 80
                      ? colors.success
                      : efficiency >= 50
                        ? colors.warning
                        : colors.primary,
                },
              ]}
            />
          </View>
        </NeonCard>

        <NeonCard variant="magenta" padding={16} style={{ marginBottom: 20 }}>
          <View style={styles.processorRow}>
            <View
              style={[
                styles.processorIcon,
                { backgroundColor: colors.accentMagenta + "20" },
              ]}
            >
              <Text
                style={[
                  styles.processorIconText,
                  { color: colors.accentMagenta },
                ]}
              >
                🔄
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.processorTitle, { color: colors.foreground }]}
              >
                VRP Optimization Engine
              </Text>
              <Text style={[styles.processorSubtitle, { color: colors.muted }]}>
                Advanced route processing algorithms
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.demoButton, { backgroundColor: colors.primary }]}
            onPress={() => setEfficiency((prev) => Math.min(100, prev + 5))}
          >
            <Text style={[styles.demoButtonText, { color: colors.background }]}>
              Increase Efficiency
            </Text>
          </TouchableOpacity>
        </NeonCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
  },
  processorIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 16,
    alignSelf: "center",
  },
  processorPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  processorText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
  },
  processorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  processorIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  processorIconText: {
    fontSize: 20,
  },
  processorTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 2,
  },
  processorSubtitle: {
    fontSize: 14,
  },
  processorHint: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 18,
  },
  processorMetrics: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  processorMetric: {
    alignItems: "center",
  },
  processorMetricLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 4,
  },
  processorMetricValue: {
    fontSize: 20,
    fontWeight: "700",
  },
  processorProgressBar: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    marginTop: 12,
    overflow: "hidden",
  },
  processorProgressFill: {
    height: "100%",
    borderRadius: 2,
  },
  demoButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
    alignItems: "center",
  },
  demoButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
