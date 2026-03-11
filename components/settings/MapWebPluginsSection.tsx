/**
 * Map plugins (web): Marker clustering and Geoman drawing/editing.
 * Shown only on web.
 */
import React, { useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { useMapWebPluginsStore } from "@/stores/mapWebPluginsStore";
import { useTheme } from "@/lib/theme-provider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

export const MapWebPluginsSection: React.FC = () => {
  const theme = useTheme();
  const markerClustering = useMapWebPluginsStore(
    (s) => s.markerClusteringEnabled,
  );
  const geomanDrawing = useMapWebPluginsStore((s) => s.geomanDrawingEnabled);
  const setMarkerClustering = useMapWebPluginsStore(
    (s) => s.setMarkerClusteringEnabled,
  );
  const setGeomanDrawing = useMapWebPluginsStore(
    (s) => s.setGeomanDrawingEnabled,
  );
  const hydrate = useMapWebPluginsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (Platform.OS !== "web") return null;

  const onToggle = (setter: (v: boolean) => void, value: boolean) => {
    hapticImpact();
    setter(!value);
  };

  return (
    <View style={[styles.section, { borderTopColor: theme.borderLight }]}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>
        Map plugins (web)
      </Text>
      <Text style={[styles.sectionDesc, { color: theme.textTertiary }]}>
        Optional Leaflet plugins for the web map
      </Text>
      <View style={styles.rows}>
        <TouchableOpacity
          style={[styles.row, { borderTopColor: theme.borderLight }]}
          onPress={() => onToggle(setMarkerClustering, markerClustering)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.text }]}>
              Marker clustering
            </Text>
            <Text style={[styles.description, { color: theme.textTertiary }]}>
              Group nearby points when zoomed out
            </Text>
          </View>
          <View
            style={[
              styles.toggle,
              {
                backgroundColor: markerClustering ? theme.accent : theme.border,
              },
            ]}
          >
            <View
              style={[
                styles.toggleThumb,
                { marginLeft: markerClustering ? 22 : 2 },
              ]}
            />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.row, { borderTopColor: theme.borderLight }]}
          onPress={() => onToggle(setGeomanDrawing, geomanDrawing)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.text }]}>
              Drawing & editing
            </Text>
            <Text style={[styles.description, { color: theme.textTertiary }]}>
              Draw shapes and edit layers (Leaflet-Geoman)
            </Text>
          </View>
          <View
            style={[
              styles.toggle,
              { backgroundColor: geomanDrawing ? theme.accent : theme.border },
            ]}
          >
            <View
              style={[
                styles.toggleThumb,
                { marginLeft: geomanDrawing ? 22 : 2 },
              ]}
            />
          </View>
        </TouchableOpacity>
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
