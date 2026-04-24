/**
 * AvoidedNodesPanel — right-side overlay listing all avoided route nodes.
 * Web-only. Shown when nodeInspectorEnabled is true and there are avoided nodes.
 */
import { Platform, StyleSheet, Text, TouchableOpacity, View, ScrollView } from "react-native";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { useMapWebPluginsStore } from "@/stores/mapWebPluginsStore";
import { useTheme } from "@/lib/theme-provider";

export function AvoidedNodesPanel() {
  if (Platform.OS !== "web") return null;

  return <AvoidedNodesPanelInner />;
}

function AvoidedNodesPanelInner() {
  const theme = useTheme();
  const nodeInspectorEnabled = useMapWebPluginsStore((s) => s.nodeInspectorEnabled);
  const avoidedNodesPanelEnabled = useMapWebPluginsStore((s) => s.avoidedNodesPanelEnabled);
  const avoidedNodes = useMapStateStore((s) => s.avoidedNodes);
  const actions = useMapActions();

  if (!nodeInspectorEnabled || !avoidedNodesPanelEnabled || avoidedNodes.length === 0) return null;

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.text,
        },
      ]}
      style={[styles.panel, { pointerEvents: "box-none" }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{avoidedNodes.length}</Text>
          </View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            Avoided nodes
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => actions.clearAvoidedNodes()}
          style={[styles.clearBtn, { borderColor: theme.border }]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={[styles.clearBtnText, { color: theme.textSecondary }]}>
            Clear all
          </Text>
        </TouchableOpacity>
      </View>

      {/* Node list */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {avoidedNodes.map((node, index) => (
          <View
            key={index}
            style={[
              styles.row,
              { borderBottomColor: theme.borderLight },
              index === avoidedNodes.length - 1 && styles.rowLast,
            ]}
          >
            <View style={styles.rowLeft}>
              <Text
                style={[styles.rowLabel, { color: theme.text }]}
                numberOfLines={1}
              >
                {node.wayName || node.label || "(unnamed)"}
              </Text>
              <Text style={[styles.rowCoords, { color: theme.textTertiary }]}>
                {node.lat.toFixed(5)}, {node.lon.toFixed(5)}
              </Text>
              {node.nodeId != null && (
                <Text style={[styles.rowNodeId, { color: theme.textSecondary }]}>
                  Node {node.nodeId}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => actions.removeAvoidedNode(index)}
              style={[styles.removeBtn, { backgroundColor: theme.surfaceAlt }]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={[styles.removeBtnText, { color: theme.textSecondary }]}>
                ✕
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 80,
    right: 12,
    width: 240,
    maxHeight: 360,
    borderRadius: 12,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 900,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  badge: {
    backgroundColor: "#ef4444",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  clearBtn: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  clearBtnText: {
    fontSize: 11,
    fontWeight: "500",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLeft: {
    flex: 1,
    marginRight: 8,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 1,
  },
  rowCoords: {
    fontSize: 10,
    fontFamily: "monospace",
  },
  rowNodeId: {
    fontSize: 10,
    fontFamily: "monospace",
    marginTop: 1,
  },
  removeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
  },
});
