/**
 * Trips tab — list saved tracks from Record tab.
 * Reuses trackStorage from lib/track-storage.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { trackStorage, type SavedTrack } from "@/lib/track-storage";
import { useRouting } from "@/lib/routing-context";
import { Fonts, glassStyle } from "@/lib/_core/theme";
import { StreetViewPreview } from "@/components/StreetViewPreview";

function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

interface TripsTabProps {
  onClose?: () => void;
}

export function TripsTab({ onClose }: TripsTabProps) {
  const colors = useColors();
  const router = useRouter();
  const { dispatch } = useRouting();
  const [savedTracks, setSavedTracks] = useState<SavedTrack[]>([]);
  const [streetViewTrack, setStreetViewTrack] = useState<SavedTrack | null>(
    null,
  );

  useEffect(() => {
    trackStorage.loadTracks().then(setSavedTracks);
  }, []);

  const handlePreview = useCallback(
    (track: SavedTrack) => {
      dispatch({
        type: "SET_PREVIEW_ROUTE",
        payload: track.points.map((p) => ({ lat: p.lat, lon: p.lon })),
      });
      onClose?.();
      router.push("/(tabs)/map");
    },
    [dispatch, router, onClose],
  );

  const handleExport = useCallback(async (track: SavedTrack) => {
    if (Platform.OS === "web") {
      const blob = new Blob([track.gpxData], {
        type: "application/gpx+xml",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${track.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      try {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        const filename = `${track.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.gpx`;
        const path = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, track.gpxData);
        await Sharing.shareAsync(path, {
          mimeType: "application/gpx+xml",
          dialogTitle: "Export GPX Track",
        });
      } catch (err) {
        console.error("Export failed:", err);
        Alert.alert("Export Failed", "Could not export the track.");
      }
    }
  }, []);

  const handleDelete = useCallback(async (track: SavedTrack) => {
    if (Platform.OS === "web") {
      const confirmed =
        typeof window !== "undefined" &&
        window.confirm(`Delete "${track.name}"? This cannot be undone.`);
      if (!confirmed) return;
      await trackStorage.deleteTrack(track.id);
      setSavedTracks(await trackStorage.loadTracks());
    } else {
      Alert.alert(
        "Delete Track?",
        `Delete "${track.name}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await trackStorage.deleteTrack(track.id);
              setSavedTracks(await trackStorage.loadTracks());
            },
          },
        ],
      );
    }
  }, []);

  if (savedTracks.length === 0) {
    return (
      <View style={styles.empty}>
        <MaterialCommunityIcons
          name="map-marker-path"
          size={48}
          color={colors.muted}
        />
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          No recorded trips yet. Go to the Record tab to start recording.
        </Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={savedTracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const date = new Date(item.createdAt);
          const dateStr = date.toLocaleDateString();
          const timeStr = date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <View
              style={[
                styles.item,
                glassStyle,
                { borderColor: colors.gridLine ?? colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.itemContent}
                onPress={() => handlePreview(item)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="map-marker-path"
                  size={20}
                  color={colors.primary}
                />
                <View style={styles.itemText}>
                  <Text
                    style={[styles.itemName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    style={[
                      styles.itemMeta,
                      { color: colors.muted, fontFamily: Fonts!.mono },
                    ]}
                  >
                    {dateStr} {timeStr} •{" "}
                    {formatDistance(item.totalDistanceMeters)} •{" "}
                    {formatElapsed(item.elapsedMs)}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={colors.muted}
                />
              </TouchableOpacity>
              <View style={styles.actions}>
                {Platform.OS !== "web" && (
                  <TouchableOpacity
                    style={[
                      styles.iconBtn,
                      { backgroundColor: colors.primary + "22" },
                    ]}
                    onPress={() => setStreetViewTrack(item)}
                  >
                    <MaterialCommunityIcons
                      name="play-circle-outline"
                      size={18}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[
                    styles.iconBtn,
                    { backgroundColor: colors.primary + "22", marginLeft: 6 },
                  ]}
                  onPress={() => handleExport(item)}
                >
                  <MaterialCommunityIcons
                    name="export-variant"
                    size={18}
                    color={colors.primary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconBtn,
                    {
                      backgroundColor: (colors.error ?? "#ef4444") + "22",
                      marginLeft: 6,
                    },
                  ]}
                  onPress={() => handleDelete(item)}
                >
                  <MaterialCommunityIcons
                    name="delete-outline"
                    size={18}
                    color={colors.error ?? "#ef4444"}
                  />
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
      {Platform.OS !== "web" && streetViewTrack && (
        <StreetViewPreview
          points={streetViewTrack.points.map((p) => ({
            lat: p.lat,
            lon: p.lon,
          }))}
          isVisible={!!streetViewTrack}
          onClose={() => setStreetViewTrack(null)}
          trackName={streetViewTrack.name}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 20,
  },
  listContent: {
    paddingBottom: 24,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  itemContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  itemText: {
    flex: 1,
    marginLeft: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  itemMeta: {
    fontSize: 11,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
});
