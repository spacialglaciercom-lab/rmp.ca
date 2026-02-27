/**
 * Mistral API key — info only. Key is set on the server (Railway).
 * No client-side input/Save/Clear UI.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";

export function MistralApiKeySection() {
  const colors = useColors();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.foreground }]}>
        Mistral API key
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Used for AI-enhanced route reports. Key is set on the server (Railway).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  description: {
    fontSize: 12,
  },
});
