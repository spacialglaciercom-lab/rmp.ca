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

interface ApiKeySectionProps {
  label: string;
  description: string;
  placeholder: string;
  getKey: () => Promise<string | null>;
  setKey: (value: string) => Promise<void>;
  savedMessage: string;
  clearedMessage: string;
}

export function ApiKeySection({
  label,
  description,
  placeholder,
  getKey,
  setKey,
  savedMessage,
  clearedMessage,
}: ApiKeySectionProps) {
  const colors = useColors();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadKey = useCallback(async () => {
    setLoading(true);
    try {
      const key = await getKey();
      setSaved(key);
      setValue(key ?? "");
    } finally {
      setLoading(false);
    }
  }, [getKey]);

  useEffect(() => {
    loadKey();
  }, [loadKey]);

  const handleSave = async () => {
    hapticImpact();
    setMessage(null);
    setSaving(true);
    try {
      await setKey(value);
      const key = await getKey();
      setSaved(key);
      setValue(key ?? "");
      setMessage(savedMessage);
    } catch (e) {
      setMessage("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    hapticImpact();
    setMessage(null);
    setSaving(true);
    try {
      await setKey("");
      setSaved(null);
      setValue("");
      setMessage(clearedMessage);
    } catch (e) {
      setMessage("Failed to clear.");
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
      <Text style={[styles.label, { color: colors.foreground }]}>
        {label}
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        {description}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: colors.border,
            backgroundColor: colors.background,
            color: colors.foreground,
          },
        ]}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={setValue}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
      />
      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.primary },
            saving && styles.buttonDisabled,
          ]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save</Text>
          )}
        </TouchableOpacity>
        {saved && (
          <TouchableOpacity
            style={[
              styles.button,
              styles.buttonSecondary,
              { borderColor: colors.border },
              saving && styles.buttonDisabled,
            ]}
            onPress={handleClear}
            disabled={saving}
          >
            <Text style={[styles.buttonTextSecondary, { color: colors.muted }]}>
              Clear
            </Text>
          </TouchableOpacity>
        )}
      </View>
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
    borderColor: "transparent",
  },
  buttonSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  buttonTextSecondary: {
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
