import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { NeoHeader, NeonCard, NeoPrimaryButton } from "@/components/neo";
import { AIRouteAnalysisPanel } from "@/components/ai-route-analysis-panel";
import { ProcessorBackground } from "@/components/neo/ProcessorBackground";

export default function HolographicTestScreen() {
  return (
    <View style={styles.container}>
      <ProcessorBackground />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Section */}
        <NeoHeader
          title="HOLGRAPHIC // ROUTE OS"
          statusLabel="AI ANALYSIS"
          subtitle="Deep Space Navigation System"
        />

        {/* AI Analysis Panel */}
        <AIRouteAnalysisPanel
          analysis={{
            averageSpeedMph: 28.5,
            totalEstimatedTimeMinutes: 125,
            confidenceScore: 0.87,
            weatherImpactSeverity: "moderate",
            reasoning:
              "Moderate crosswinds detected along the route. AI recommends adjusting turn penalties for optimal efficiency. Weather conditions may reduce average speed by 12-15% compared to clear conditions.",
          }}
          visible={true}
          loading={false}
        />

        {/* Control Panel */}
        <NeonCard variant="cyan" padding={20} style={{ marginBottom: 20 }}>
          <Text style={styles.cardTitle}>Navigation Controls</Text>
          <View style={styles.controlGrid}>
            <TouchableOpacity style={styles.controlButton}>
              <Text style={styles.controlButtonText}>Warp Drive</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton}>
              <Text style={styles.controlButtonText}>Shields</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton}>
              <Text style={styles.controlButtonText}>Sensors</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton}>
              <Text style={styles.controlButtonText}>Comms</Text>
            </TouchableOpacity>
          </View>
        </NeonCard>

        {/* Status Panel */}
        <NeonCard variant="magenta" padding={20} style={{ marginBottom: 20 }}>
          <Text style={styles.cardTitle}>System Status</Text>
          <View style={styles.statusRow}>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Energy</Text>
              <Text style={styles.statusValue}>84%</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Shields</Text>
              <Text style={styles.statusValue}>Active</Text>
            </View>
            <View style={styles.statusItem}>
              <Text style={styles.statusLabel}>Sensors</Text>
              <Text style={styles.statusValue}>Online</Text>
            </View>
          </View>
        </NeonCard>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <NeoPrimaryButton
            title="Engage Warp Drive"
            onPress={() => {}}
            variant="primary"
          />
          <NeoPrimaryButton
            title="Run Diagnostics"
            onPress={() => {}}
            variant="secondary"
            style={{ marginTop: 12 }}
          />
        </View>

        {/* Info Panel */}
        <NeonCard variant="cyan" padding={20} style={{ marginBottom: 20 }}>
          <Text style={styles.cardTitle}>Mission Briefing</Text>
          <Text style={styles.infoText}>
            The holographic interface provides real-time navigation data with
            AI-powered route optimization. All systems are operational and ready
            for deep space navigation.
          </Text>
        </NeonCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#00D9FF",
    marginBottom: 16,
  },
  controlGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  controlButton: {
    flex: 1,
    minWidth: "48%",
    backgroundColor: "rgba(0, 217, 255, 0.2)",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 217, 255, 0.3)",
    shadowColor: "#00D9FF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  controlButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  statusItem: {
    flex: 1,
    alignItems: "center",
  },
  statusLabel: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.7)",
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#00D9FF",
  },
  buttonContainer: {
    marginBottom: 24,
  },
  infoText: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 14,
    lineHeight: 22,
  },
});
