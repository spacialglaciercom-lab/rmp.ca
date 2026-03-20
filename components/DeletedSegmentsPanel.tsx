/**
 * DeletedSegmentsPanel — right-side overlay listing route segments the user has
 * clicked to delete (added via segment edit mode).  Web-only.
 *
 * "Deleted" segments are stored as AvoidedNodes whose label starts with
 * "Segment:" — they use the same rerouting pipeline as avoided nodes.
 */
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { useTheme } from "@/lib/theme-provider";

export function DeletedSegmentsPanel() {
  if (Platform.OS !== "web") return null;
  return <DeletedSegmentsPanelInner />;
}

function DeletedSegmentsPanelInner() {
  const theme = useTheme();
  const avoidedNodes = useMapStateStore((s) => s.avoidedNodes);
  const actions = useMapActions();

  // Only show nodes that were added as deleted segments
  const deletedSegments = avoidedNodes
    .map((node, originalIndex) => ({ node, originalIndex }))
    .filter(({ node }) => node.label?.startsWith("Segment"));

  if (deletedSegments.length === 0) return null;

  // Offset below the AvoidedNodesPanel (which sits at top: 80).
  // Each panel row is ~50 px, header ~42 px, so stack below.
  const avoidedNodesCount = avoidedNodes.filter(
    (n) => !n.label?.startsWith("Segment"),
  ).length;
  const topOffset = avoidedNodesCount > 0 ? 80 + 42 + avoidedNodesCount * 50 + 8 : 80;

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.text,
          top: topOffset,
        },
      ]}
      pointerEvents="box-none"
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerLeft}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{deletedSegments.length}</Text>
          </View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            Deleted segments
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            // Remove only the "Segment:" avoided nodes
            // Iterate in reverse so indices stay valid
            const indicesToRemove = deletedSegments
              .map((d) => d.originalIndex)
              .sort((a, b) => b - a);
            for (const idx of indicesToRemove) {
              actions.removeAvoidedNode(idx);
            }
          }}
          style={[styles.clearBtn, { borderColor: theme.border }]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={[styles.clearBtnText, { color: theme.textSecondary }]}>
            Clear all
          </Text>
        </TouchableOpacity>
      </View>

      {/* Segment list */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {deletedSegments.map(({ node, originalIndex }, listIdx) => (
          <View
            key={originalIndex}
            style={[
              styles.row,
              { borderBottomColor: theme.borderLight },
              listIdx === deletedSegments.length - 1 && styles.rowLast,
            ]}
          >
            <View style={styles.rowLeft}>
              <Text
                style={[styles.rowLabel, { color: theme.text }]}
                numberOfLines={1}
              >
                {node.label.replace(/^Segment:\s*/, "") || "(unnamed)"}
              </Text>
              <Text style={[styles.rowCoords, { color: theme.textTertiary }]}>
                {node.lat.toFixed(5)}, {node.lon.toFixed(5)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => actions.removeAvoidedNode(originalIndex)}
              style={[styles.removeBtn, { backgroundColor: theme.surfaceAlt }]}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text
                style={[styles.removeBtnText, { color: theme.textSecondary }]}
              >
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
    right: 12,
    width: 240,
    maxHeight: 300,
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
    backgroundColor: "#f97316",
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
