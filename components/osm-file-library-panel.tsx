/**
 * OSM File Library Panel
 *
 * Shows saved OSM files with load/delete actions.
 * Integrates into the Planner page above the import button.
 */

import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { Fonts } from "@/lib/_core/theme";
import {
  listOSMFiles,
  loadOSMFileContent,
  deleteOSMFile,
  formatFileSize,
  type OSMFileEntry,
} from "@/lib/osm-file-library";

interface OSMFileLibraryPanelProps {
  /** Called when user selects a file to load. Receives the raw XML content and file name. May be async. */
  onLoadFile: (xmlContent: string, fileName: string) => void | Promise<void>;
  /** Refresh trigger — increment to re-fetch the file list. */
  refreshKey?: number;
}

export function OSMFileLibraryPanel({
  onLoadFile,
  refreshKey,
}: OSMFileLibraryPanelProps) {
  const colors = useColors();
  const [files, setFiles] = useState<OSMFileEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listOSMFiles();
    setFiles(list);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  if (files.length === 0) return null;

  const handleLoad = async (entry: OSMFileEntry) => {
    setLoading(entry.id);
    try {
      const content = await loadOSMFileContent(entry.id);
      if (!content) {
        Alert.alert(
          "Error",
          "File content not found. It may have been cleared.",
        );
        await refresh();
        return;
      }
      await onLoadFile(content, entry.name);
    } catch (err) {
      Alert.alert("Error", "Failed to load file");
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = (entry: OSMFileEntry) => {
    const doDelete = async () => {
      await deleteOSMFile(entry.id);
      await refresh();
    };

    if (Platform.OS === "web") {
      if (confirm(`Delete "${entry.name}"?`)) doDelete();
    } else {
      Alert.alert("Delete File", `Remove "${entry.name}" from library?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        backgroundColor: colors.surface,
      }}
    >
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            fontSize: 16,
            fontWeight: "700",
            fontFamily: Fonts.heading,
            color: colors.foreground,
          }}
        >
          📁 Saved OSM Files ({files.length})
        </Text>
        <Text style={{ color: colors.muted, fontSize: 14 }}>
          {expanded ? "Hide ▲" : "Show ▼"}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 12, gap: 8 }}>
          {files.map((entry) => (
            <View
              key={entry.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 10,
                borderRadius: 8,
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: colors.foreground,
                  }}
                  numberOfLines={1}
                >
                  {entry.name}
                </Text>
                <Text
                  style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}
                >
                  {formatDate(entry.importedAt)} ·{" "}
                  {formatFileSize(entry.sizeBytes)} · {entry.wayCount} ways ·{" "}
                  {entry.nodeCount} nodes
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => handleLoad(entry)}
                disabled={loading === entry.id}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor:
                    loading === entry.id ? colors.muted : colors.primary,
                  marginRight: 6,
                }}
              >
                <Text
                  style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}
                >
                  {loading === entry.id ? "Loading..." : "Load"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleDelete(entry)}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text
                  style={{
                    color: colors.error,
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  ✕
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
