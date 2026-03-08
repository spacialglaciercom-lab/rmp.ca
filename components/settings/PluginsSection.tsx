/**
 * Settings section: enable/disable app plugins (list from registry).
 * State is stored in Zustand (persisted to AsyncStorage). Optional Firestore sync
 * can be added for cross-device sync (see docs/PLUGIN-DEVELOPMENT.md).
 */
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTheme } from "@/lib/theme-provider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { usePluginStore } from "@/stores/pluginStore";
import { getBuiltinPluginDescriptors } from "@/lib/plugins/load";
import { loadPluginConfig } from "@/lib/plugins/config";

export const PluginsSection: React.FC = () => {
  const theme = useTheme();
  const [, forceUpdate] = useState(0);
  const setPluginEnabled = usePluginStore((s) => s.setPluginEnabled);
  const isPluginEnabled = usePluginStore((s) => s.isPluginEnabled);
  const [configDefaults, setConfigDefaults] = useState<Record<string, boolean>>({});

  // Subscribe to store so toggles re-render when enabledPlugins changes (persist can delay ref updates)
  useEffect(() => {
    return usePluginStore.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    loadPluginConfig().then((config) => {
      const defaults: Record<string, boolean> = {};
      for (const [id, entry] of Object.entries(config.plugins)) {
        defaults[id] = entry.enabled;
      }
      setConfigDefaults(defaults);
    });
  }, []);

  const descriptors = getBuiltinPluginDescriptors();

  const onToggle = (id: string, current: boolean) => {
    hapticImpact();
    setPluginEnabled(id, !current);
  };

  return (
    <View style={[styles.section, { borderTopColor: theme.borderLight }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Plugins</Text>
      <Text style={[styles.sectionDesc, { color: theme.textTertiary }]}>
        Enable or disable feature extensions (weather, route optimization, Overture extraction). List from plugin registry.
      </Text>
      <View style={styles.rows}>
        {descriptors.map((d) => {
          const defaultEnabled = configDefaults[d.id] ?? true;
          const enabled = isPluginEnabled(d.id, defaultEnabled);
          return (
            <TouchableOpacity
              key={d.id}
              style={[styles.row, { borderTopColor: theme.borderLight }]}
              onPress={() => onToggle(d.id, enabled)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.text }]}>{d.name}</Text>
                <Text style={[styles.description, { color: theme.textTertiary }]}>
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
                  style={[
                    styles.toggleThumb,
                    { marginLeft: enabled ? 22 : 2 },
                  ]}
                />
              </View>
            </TouchableOpacity>
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
