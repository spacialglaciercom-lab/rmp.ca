/**
 * Sync Conflict Resolution Sheet
 * 
 * A bottom sheet that shows sync conflicts to the user and lets them
 * choose how to resolve each one (server wins, client wins, or merge).
 */
import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  syncConflictStore,
  useIsConflictSheetVisible,
  useUnresolvedConflicts,
  useUnresolvedCount,
} from "@/stores/syncConflictStore";
import type { ConflictResolution } from "@/stores/syncConflictStore";

const TABLE_LABELS: Record<string, string> = {
  waste_points: "Waste Bin",
  routes: "Route",
  collection_points: "Collection Point",
  zones: "Zone",
  favorites: "Favorite",
};

function getTableLabel(tableName: string): string {
  return TABLE_LABELS[tableName] || tableName;
}

function formatFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value.length > 80) return value.slice(0, 80) + "…";
    return value;
  }
  return String(value);
}

interface ConflictCardProps {
  conflict: {
    id: string;
    tableName: string;
    displayName: string;
    conflictFields: string[];
    localRecord: Record<string, unknown>;
    serverRecord: Record<string, unknown>;
  };
  onResolve: (id: string, resolution: ConflictResolution) => void;
}

function ConflictCard({ conflict, onResolve }: ConflictCardProps) {
  const tableLabel = getTableLabel(conflict.tableName);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.iconContainer}>
            <Ionicons name="warning" size={18} color="#f97316" />
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.cardTitle}>{conflict.displayName}</Text>
            <Text style={styles.cardSubtitle}>{tableLabel}</Text>
          </View>
        </View>
      </View>

      {/* Conflicting fields */}
      <ScrollView
        style={styles.fieldsContainer}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {conflict.conflictFields.map((field) => (
          <View key={field} style={styles.fieldRow}>
            <Text style={styles.fieldName}>{formatFieldName(field)}</Text>
            <View style={styles.fieldValues}>
              <View style={styles.fieldValueLocal}>
                <Text style={styles.fieldValueLabel}>Local</Text>
                <Text style={styles.fieldValueText}>
                  {formatValue(conflict.localRecord[field])}
                </Text>
              </View>
              <View style={styles.fieldValueServer}>
                <Text style={styles.fieldValueLabel}>Server</Text>
                <Text style={styles.fieldValueText}>
                  {formatValue(conflict.serverRecord[field])}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Resolution buttons */}
      <View style={styles.resolutionButtons}>
        <TouchableOpacity
          style={[styles.resolutionBtn, styles.serverWinsBtn]}
          onPress={() => onResolve(conflict.id, "server_wins")}
          activeOpacity={0.7}
        >
          <Ionicons name="cloud-download" size={16} color="#fff" />
          <Text style={styles.resolutionBtnText}>Use Server</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.resolutionBtn, styles.clientWinsBtn]}
          onPress={() => onResolve(conflict.id, "client_wins")}
          activeOpacity={0.7}
        >
          <Ionicons name="phone-portrait" size={16} color="#fff" />
          <Text style={styles.resolutionBtnText}>Use Local</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.resolutionBtn, styles.mergeBtn]}
          onPress={() => onResolve(conflict.id, "merge")}
          activeOpacity={0.7}
        >
          <Ionicons name="git-merge" size={16} color="#fff" />
          <Text style={styles.resolutionBtnText}>Merge</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function SyncConflictSheet() {
  const isVisible = useIsConflictSheetVisible();
  const unresolvedConflicts = useUnresolvedConflicts();
  const unresolvedCount = useUnresolvedCount();
  const resolveConflict = syncConflictStore((s) => s.resolveConflict);
  const resolveAllConflicts = syncConflictStore((s) => s.resolveAllConflicts);
  const setSheetVisible = syncConflictStore((s) => s.setSheetVisible);

  const handleResolve = useCallback(
    (id: string, resolution: ConflictResolution) => {
      resolveConflict(id, resolution);
    },
    [resolveConflict],
  );

  const handleResolveAll = useCallback(
    (resolution: ConflictResolution) => {
      resolveAllConflicts(resolution);
    },
    [resolveAllConflicts],
  );

  const handleClose = useCallback(() => {
    setSheetVisible(false);
  }, [setSheetVisible]);

  if (!isVisible || unresolvedConflicts.length === 0) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Ionicons name="warning-outline" size={24} color="#f97316" />
              <View style={styles.headerText}>
                <Text style={styles.headerTitle}>Sync Conflicts</Text>
                <Text style={styles.headerSubtitle}>
                  {unresolvedCount} conflict{unresolvedCount !== 1 ? "s" : ""}{" "}
                  need your attention
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          {/* Description */}
          <Text style={styles.description}>
            Your local changes conflict with changes from the server. Choose how
            to resolve each conflict:
          </Text>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#3b82f6" }]} />
              <Text style={styles.legendText}>Server — keep server version</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#22c55e" }]} />
              <Text style={styles.legendText}>Local — keep your changes</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: "#8b5cf6" }]} />
              <Text style={styles.legendText}>Merge — combine both</Text>
            </View>
          </View>

          {/* Conflict list */}
          <ScrollView
            style={styles.conflictList}
            contentContainerStyle={styles.conflictListContent}
            showsVerticalScrollIndicator={false}
          >
            {unresolvedConflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                onResolve={handleResolve}
              />
            ))}
          </ScrollView>

          {/* Bulk actions */}
          {unresolvedConflicts.length > 1 && (
            <View style={styles.bulkActions}>
              <Text style={styles.bulkTitle}>Resolve all:</Text>
              <View style={styles.bulkButtons}>
                <TouchableOpacity
                  style={[styles.bulkBtn, styles.serverWinsBtn]}
                  onPress={() => handleResolveAll("server_wins")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.bulkBtnText}>Server</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bulkBtn, styles.clientWinsBtn]}
                  onPress={() => handleResolveAll("client_wins")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.bulkBtnText}>Local</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bulkBtn, styles.mergeBtn]}
                  onPress={() => handleResolveAll("merge")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.bulkBtnText}>Merge All</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#ddd",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  description: {
    fontSize: 14,
    color: "#555",
    paddingHorizontal: 20,
    marginBottom: 12,
    lineHeight: 20,
  },
  legend: {
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: "#777",
  },
  conflictList: {
    flex: 1,
  },
  conflictListContent: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  card: {
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeaderText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  cardSubtitle: {
    fontSize: 12,
    color: "#888",
    marginTop: 1,
  },
  fieldsContainer: {
    maxHeight: 160,
  },
  fieldRow: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  fieldName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#555",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldValues: {
    flexDirection: "row",
    gap: 8,
  },
  fieldValueLocal: {
    flex: 1,
    backgroundColor: "#f0fdf4",
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  fieldValueServer: {
    flex: 1,
    backgroundColor: "#eff6ff",
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  fieldValueLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#888",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  fieldValueText: {
    fontSize: 13,
    color: "#333",
  },
  resolutionButtons: {
    flexDirection: "row",
    padding: 10,
    gap: 8,
  },
  resolutionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  resolutionBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  serverWinsBtn: {
    backgroundColor: "#3b82f6",
  },
  clientWinsBtn: {
    backgroundColor: "#22c55e",
  },
  mergeBtn: {
    backgroundColor: "#8b5cf6",
  },
  bulkActions: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  bulkTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
    marginBottom: 8,
  },
  bulkButtons: {
    flexDirection: "row",
    gap: 8,
  },
  bulkBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  bulkBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
