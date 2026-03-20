import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import {
  getGoogleMapsApiKey,
  setGoogleMapsApiKey,
  getNavigationProvider,
  setNavigationProvider,
  type NavigationProvider,
} from "@/lib/google-maps-config";

export function NavigationProviderPicker() {
  const colors = useColors();
  const [provider, setProvider] = useState<NavigationProvider>("osrm");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, k] = await Promise.all([
        getNavigationProvider(),
        getGoogleMapsApiKey(),
      ]);
      setProvider(p);
      setApiKey(k ?? "");
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

  const handleSaveKey = async () => {
    hapticImpact();
    setMessage(null);
    setSaving(true);
    try {
      await setGoogleMapsApiKey(apiKey);
      const k = await getGoogleMapsApiKey();
      setApiKey(k ?? "");
      setMessage("Google Maps API key saved.");
    } catch {
      setMessage("Failed to save.");
    } finally {
      setSaving(false);
    }
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
      <Text style={[styles.label, { color: colors.primary }]}>
        Navigation Provider
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Choose which service provides driving directions
      </Text>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            { borderColor: colors.border },
            provider === "google" && {
              backgroundColor: colors.primary + "20",
              borderColor: colors.primary,
            },
          ]}
          onPress={() => handleToggle("google")}
        >
          <Text
            style={[
              styles.toggleText,
              { color: provider === "google" ? colors.primary : colors.muted },
            ]}
          >
            Google Maps
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            { borderColor: colors.border },
            provider === "osrm" && {
              backgroundColor: colors.primary + "20",
              borderColor: colors.primary,
            },
          ]}
          onPress={() => handleToggle("osrm")}
        >
          <Text
            style={[
              styles.toggleText,
              { color: provider === "osrm" ? colors.primary : colors.muted },
            ]}
          >
            OSRM
          </Text>
        </TouchableOpacity>
      </View>

      {provider === "google" && (
        <>
          <Text
            style={[styles.description, { marginTop: 12, color: colors.muted }]}
          >
            Google Maps API key (set GOOGLE_MAPS_API_KEY on Railway for web).
            Same key for Directions, Elevation, Weather, Places — enable in
            Cloud Console.
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                color: colors.text,
              },
            ]}
            placeholder="AIzaSy…"
            placeholderTextColor={colors.muted + "99"}
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
          />
          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.button,
                {
                  backgroundColor: colors.primary + "40",
                  borderColor: colors.primary,
                },
                saving && styles.buttonDisabled,
              ]}
              onPress={handleSaveKey}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.text }]}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {message && (
        <Text style={[styles.message, { color: colors.muted }]}>{message}</Text>
      )}
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
  },
  description: {
    fontSize: 12,
    marginBottom: 10,
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
    alignItems: "center",
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "500",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "web" ? 10 : 12,
    fontSize: 15,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  message: {
    fontSize: 12,
    marginTop: 8,
  },
  hint: {
    fontSize: 14,
  },
});
