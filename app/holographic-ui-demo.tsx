import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Platform,
} from "react-native";
import { useEffect, useRef } from "react";

// Holographic Glass UI Demo Component
const HolographicUIDemo = () => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation for status indicator
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
    ).start();

    // Glow pulse for buttons
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 0.8,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  const pulseStyle = {
    transform: [{ scale: pulseAnim }],
  };

  const glowStyle = {
    shadowOpacity: glowAnim,
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Panel */}
        <View style={styles.headerPanel}>
          <Text style={styles.headerTitle}>Holographic Interface</Text>
          <Text style={styles.headerSubtitle}>
            Deep Space Navigation System
          </Text>
        </View>

        {/* Main Content Grid */}
        <View style={styles.gridContainer}>
          {/* Control Panel 1 */}
          <View style={styles.controlPanel}>
            <Text style={styles.panelTitle}>System Status</Text>
            <View style={styles.statusIndicator}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Online</Text>
            </View>
          </View>

          {/* Control Panel 2 */}
          <View style={styles.controlPanel}>
            <Text style={styles.panelTitle}>Navigation</Text>
            <TouchableOpacity style={styles.glowButton}>
              <Text style={styles.buttonText}>Engage Warp Drive</Text>
            </TouchableOpacity>
          </View>

          {/* Control Panel 3 */}
          <View style={styles.controlPanel}>
            <Text style={styles.panelTitle}>Sensors</Text>
            <View style={styles.sensorDisplay}>
              <Text style={styles.sensorValue}>42.7°C</Text>
              <Text style={styles.sensorLabel}>External Temp</Text>
            </View>
          </View>

          {/* Control Panel 4 */}
          <View style={styles.controlPanel}>
            <Text style={styles.panelTitle}>Communications</Text>
            <TouchableOpacity style={styles.glowButtonSecondary}>
              <Text style={styles.buttonText}>Open Channel</Text>
            </TouchableOpacity>
          </View>

          {/* Prism Gradient Display */}
          <View style={styles.prismContainer}>
            <View style={styles.prismGradient} />
            <Text style={styles.prismText}>Energy Flow</Text>
          </View>

          {/* Data Terminal */}
          <View style={styles.terminalPanel}>
            <Text style={styles.terminalTitle}>Log Stream</Text>
            <View style={styles.terminalContent}>
              <Text style={styles.logEntry}>[INFO] System initialized</Text>
              <Text style={styles.logEntry}>[INFO] Sensors online</Text>
              <Text style={styles.logEntry}>[INFO] Navigation ready</Text>
              <Text style={styles.logEntry}>
                [INFO] Communications established
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.buttonText}>Scan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.buttonText}>Lock</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.buttonText}>Jump</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
    padding: 20,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  headerPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "rgba(0, 217, 255, 0.2)",
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 4px 12px rgba(0, 217, 255, 0.3)" }
      : {
          shadowColor: "#00D9FF",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 12,
          elevation: 8,
        }),
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#00D9FF",
    marginBottom: 8,
    ...(Platform.OS === "web"
      ? { textShadow: "0px 2px 4px rgba(0, 217, 255, 0.5)" }
      : {
          textShadowColor: "rgba(0, 217, 255, 0.5)",
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 4,
        }),
  },
  headerSubtitle: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.7)",
  },
  gridContainer: {
    gap: 16,
  },
  controlPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 217, 255, 0.15)",
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 2px 8px rgba(0, 217, 255, 0.2)" }
      : {
          shadowColor: "#00D9FF",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 4,
        }),
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#00D9FF",
    marginBottom: 12,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#00D9FF",
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 0px 4px rgba(0, 217, 255, 0.8)" }
      : {
          shadowColor: "#00D9FF",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 4,
        }),
  },
  statusText: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
  },
  glowButton: {
    backgroundColor: "rgba(0, 217, 255, 0.2)",
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 217, 255, 0.4)",
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 4px 10px rgba(0, 217, 255, 0.4)" }
      : {
          shadowColor: "#00D9FF",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 10,
          elevation: 6,
        }),
  },
  glowButtonSecondary: {
    backgroundColor: "rgba(123, 97, 255, 0.2)",
    borderRadius: 25,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(123, 97, 255, 0.4)",
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 4px 10px rgba(123, 97, 255, 0.4)" }
      : {
          shadowColor: "#7B61FF",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 10,
          elevation: 6,
        }),
  },
  buttonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
  sensorDisplay: {
    alignItems: "center",
    gap: 4,
  },
  sensorValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#00D9FF",
  },
  sensorLabel: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.7)",
  },
  prismContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  prismGradient: {
    width: 100,
    height: 60,
    borderRadius: 8,
    backgroundColor: "#FF006E",
    position: "relative",
    overflow: "hidden",
  },
  prismText: {
    marginTop: 12,
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 14,
  },
  terminalPanel: {
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 217, 255, 0.1)",
  },
  terminalTitle: {
    color: "#00D9FF",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  terminalContent: {
    gap: 4,
  },
  logEntry: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 12,
    fontFamily: "monospace",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  actionButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 2px 6px rgba(255, 255, 255, 0.1)" }
      : {
          shadowColor: "rgba(255, 255, 255, 0.1)",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 6,
          elevation: 3,
        }),
  },
});

export default HolographicUIDemo;
