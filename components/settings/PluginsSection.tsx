/**
 * Settings section: enable/disable app plugins (list from registry).
 * State is stored in Zustand (persisted to AsyncStorage). Optional Firestore sync
 * can be added for cross-device sync (see docs/PLUGIN-DEVELOPMENT.md).
 */
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/lib/theme-provider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { usePluginStore } from "@/stores/pluginStore";
import { getBuiltinPluginDescriptors } from "@/lib/plugins/load";
import { loadPluginConfig } from "@/lib/plugins/config";

export const PluginsSection: React.FC = () => {
  const { theme } = useTheme();
  const [configDefaults, setConfigDefaults] = useState<Record<string, boolean>>(
    {},
  );
  /** Local copy of enabled state so the toggle updates immediately on press (avoids persist/subscribe timing). */
  const [localEnabled, setLocalEnabled] = useState<Record<string, boolean>>({});

  const descriptors = getBuiltinPluginDescriptors();

  // Load config defaults and sync local state from store (including after rehydration)
  useEffect(() => {
    loadPluginConfig()
      .then((config) => {
        const defaults: Record<string, boolean> = {};
        for (const [id, entry] of Object.entries(config.plugins)) {
          defaults[id] = entry.enabled;
        }
        setConfigDefaults(defaults);
        const store = usePluginStore.getState();
        const next: Record<string, boolean> = {};
        descriptors.forEach((d) => {
          next[d.id] = store.isPluginEnabled(d.id, defaults[d.id] ?? true);
        });
        setLocalEnabled(next);
      })
      .catch((err) => {
        console.warn("[PluginsSection] Failed to load plugin config:", err);
      });
  }, []);

  // Keep local state in sync when store changes (e.g. rehydration)
  useEffect(() => {
    return usePluginStore.subscribe(() => {
      const store = usePluginStore.getState();
      const list = getBuiltinPluginDescriptors();
      setLocalEnabled((prev) => {
        const next = { ...prev };
        list.forEach((d) => {
          const defaultEnabled = configDefaults[d.id] ?? true;
          next[d.id] = store.isPluginEnabled(d.id, defaultEnabled);
        });
        return next;
      });
    });
  }, [configDefaults]);

  const onToggle = useCallback((id: string, current: boolean) => {
    hapticImpact();
    const next = !current;
    setLocalEnabled((prev) => ({ ...prev, [id]: next }));
    usePluginStore.getState().setPluginEnabled(id, next);
  }, []);

  return (
    <View style={[styles.section, { borderTopColor: theme.borderLight }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Plugins</Text>
      <Text style={[styles.sectionDesc, { color: theme.textTertiary }]}>
        Enable or disable feature extensions (weather, route optimization,
        Overture extraction). List from plugin registry.
      </Text>
      <View style={styles.rows}>
        {descriptors.map((d) => {
          const defaultEnabled = configDefaults[d.id] ?? true;
          const enabled =
            d.id in localEnabled ? localEnabled[d.id] : defaultEnabled;
          return (
            <Pressable
              key={d.id}
              style={[styles.row, { borderTopColor: theme.borderLight }]}
              onPress={() => onToggle(d.id, enabled)}
              accessibilityRole="switch"
              accessibilityState={{ checked: enabled }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.text }]}>
                  {d.name}
                </Text>
                <Text
                  style={[styles.description, { color: theme.textTertiary }]}
                >
                  {d.description}
                </Text>
              </View>
              <View
                style={[
                  styles.toggle,
                  { backgroundColor: enabled ? theme.accent : theme.border },
                ]}
              >
                <View
                  style={[styles.toggleThumb, { marginLeft: enabled ? 22 : 2 }]}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingVertical: 12,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  sectionDesc: {
    fontSize: 12,
    marginBottom: 12,
  },
  rows: {
    gap: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: "500",
  },
  description: {
    fontSize: 12,
    marginTop: 2,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    marginLeft: 12,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
});
