import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import {
  getNavigationProvider,
  setNavigationProvider,
  type NavigationProvider,
} from "@/lib/google-maps-config";

export function NavigationProviderSection() {
  const colors = useColors();
  const [provider, setProvider] = useState<NavigationProvider>("osrm");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await getNavigationProvider();
      setProvider(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggle = async (p: NavigationProvider) => {
    hapticImpact();
    setProvider(p);
    await setNavigationProvider(p);
    setMessage(`Switched to ${p === "google" ? "Google Maps" : "OSRM"}.`);
  };

  if (loading) {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.hint, { color: colors.muted }]}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Navigation Provider</Text>
      <Text style={styles.description}>
        Choose which service provides driving directions
      </Text>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            provider === "google" && styles.toggleActive,
          ]}
          onPress={() => handleToggle("google")}
        >
          <Text
            style={[
              styles.toggleText,
              provider === "google" && styles.toggleTextActive,
            ]}
          >
            Google Maps
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            provider === "osrm" && styles.toggleActive,
          ]}
          onPress={() => handleToggle("osrm")}
        >
          <Text
            style={[
              styles.toggleText,
              provider === "osrm" && styles.toggleTextActive,
            ]}
          >
            OSRM
          </Text>
        </TouchableOpacity>
      </View>

      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
    color: "#00D9FF",
  },
  description: {
    fontSize: 12,
    marginBottom: 10,
    color: "rgba(255, 255, 255, 0.7)",
  },
  toggleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0, 217, 255, 0.2)",
    backgroundColor: "transparent",
    alignItems: "center",
  },
  toggleActive: {
    backgroundColor: "rgba(0, 217, 255, 0.2)",
    borderColor: "rgba(0, 217, 255, 0.5)",
    shadowColor: "#00D9FF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.5)",
  },
  toggleTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  message: {
    fontSize: 12,
    marginTop: 8,
    color: "rgba(255, 255, 255, 0.7)",
  },
  hint: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.7)",
  },
});
