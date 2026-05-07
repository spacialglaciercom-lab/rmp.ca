import React from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import type { PlannerState, PlannerActions } from "./usePlannerViewModel";

// The View component takes only State and Actions. It has ZERO knowledge of backend services,
// data fetching mechanisms, or external stores. It is 100% pure UI and testable with mock props.
type DecoupledPlannerViewProps = PlannerState & PlannerActions;

export function DecoupledPlannerView({
  coordinates,
  vehicles,
  loading,
  error,
  result,
  setCoordinates,
  setVehicles,
  handleOptimize,
  reset
}: DecoupledPlannerViewProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Decoupled VRP Planner</Text>

      <View style={styles.inputGroup}>
        <Text>Coordinates (comma separated):</Text>
        <TextInput
          style={styles.input}
          value={coordinates}
          onChangeText={setCoordinates}
          placeholder="e.g. 45.5,-73.5;45.6,-73.6"
          editable={!loading}
        />
      </View>

      <View style={styles.inputGroup}>
        <Text>Number of Vehicles:</Text>
        <TextInput
          style={styles.input}
          value={vehicles}
          onChangeText={setVehicles}
          keyboardType="numeric"
          editable={!loading}
        />
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton, loading && styles.disabledButton]}
          onPress={handleOptimize}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Optimize</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={reset}
          disabled={loading}
        >
          <Text style={styles.buttonTextSecondary}>Reset</Text>
        </TouchableOpacity>
      </View>

      {result && (
        <View style={styles.resultContainer}>
          <Text style={styles.successText}>Route Optimized Successfully!</Text>
          <Text>Route ID: {result.id}</Text>
          <Text>Total Distance: {result.totalDistanceMeters}m</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: "#fff", borderRadius: 8 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 16 },
  inputGroup: { marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 8, borderRadius: 4, marginTop: 4 },
  buttonRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  button: { flex: 1, padding: 12, borderRadius: 4, alignItems: "center" },
  primaryButton: { backgroundColor: "#007AFF" },
  secondaryButton: { backgroundColor: "#E5E5EA" },
  disabledButton: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "bold" },
  buttonTextSecondary: { color: "#000", fontWeight: "bold" },
  errorText: { color: "red", marginTop: 8 },
  successText: { color: "green", fontWeight: "bold" },
  resultContainer: { marginTop: 24, padding: 16, backgroundColor: "#F2F2F7", borderRadius: 8 }
});
