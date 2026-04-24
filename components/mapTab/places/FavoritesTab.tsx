/**
 * Favorites tab — list saved places with name and coords.
 * Links depot/collection points from Planner (current route).
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
  Switch,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { useFavoritesStore, type FavoriteItem } from "@/stores/favoritesStore";
import { useRouting } from "@/lib/routing-context";
import { trackStorage, type SavedTrack } from "@/lib/track-storage";
import { impactAsync } from "@/lib/safe-haptics";
import { storage } from "@/lib/storage";
import type { CollectionPoint } from "@/types";
import { Fonts, glassStyle } from "@/lib/_core/theme";

interface FavoritesTabProps {
  /** Called when user taps a row (show on map) or toggles Preview on — closes panel so map is visible. */
  onShowOnMap?: (lat: number, lon: number) => void;
}

/** Sanitize a string for use as a filename (no path chars, reasonable length). */
function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[^\w\s-.]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40) || "waypoint"
  );
}

export function FavoritesTab({ onShowOnMap }: FavoritesTabProps) {
  const colors = useColors();
  const favorites = useFavoritesStore((s) => s.favorites);
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);
  const clearAllFavorites = useFavoritesStore((s) => s.clearAllFavorites);
  const exportFavoriteToGPX = useFavoritesStore((s) => s.exportFavoriteToGPX);
  const { dispatch } = useRouting();

  const [plannerPoints, setPlannerPoints] = useState<
    {
      id: string;
      name: string;
      lat: number;
      lon: number;
      source: "depot" | "collection";
    }[]
  >([]);
  /** ID of the item currently previewed on the map (only one at a time). */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [savedTracks, setSavedTracks] = useState<SavedTrack[]>([]);

  useEffect(() => {
    trackStorage.loadTracks().then(setSavedTracks);
  }, []);

  useEffect(() => {
    storage.loadRoute().then((route) => {
      if (!route || route.points.length === 0) {
        setPlannerPoints([]);
        return;
      }
      const pts: typeof plannerPoints = [];
      route.points.forEach((p: CollectionPoint, i: number) => {
        const name = p.locationName || p.address || `Point ${i + 1}`;
        pts.push({
          id: p.id,
          name: i === 0 ? `Depot — ${name}` : `Collection — ${name}`,
          lat: p.latitude,
          lon: p.longitude,
          source: i === 0 ? "depot" : "collection",
        });
      });
      setPlannerPoints(pts);
    });
  }, []);

  /** Find a saved trip whose name matches a favorite (imported GPX routes are saved as both). */
  const findMatchingTrack = useCallback(
    (name: string, lat: number, lon: number): SavedTrack | undefined => {
      return savedTracks.find(
        (t) =>
          t.name === name &&
          t.points.length >= 2 &&
          Math.abs(t.points[0].lat - lat) < 0.001 &&
          Math.abs(t.points[0].lon - lon) < 0.001,
      );
    },
    [savedTracks],
  );

  const handleShowOnMap = useCallback(
    (lat: number, lon: number, name?: string) => {
      const track = name ? findMatchingTrack(name, lat, lon) : undefined;
      if (track) {
        dispatch({
          type: "SET_PREVIEW_ROUTE",
          payload: track.points.map((p) => ({ lat: p.lat, lon: p.lon })),
        });
      } else {
        dispatch({
          type: "SET_PREVIEW_ROUTE",
          payload: [{ lat, lon, label: "P" }],
        });
      }
      onShowOnMap?.(lat, lon);
    },
    [dispatch, onShowOnMap, findMatchingTrack],
  );

  const handlePreviewToggle = useCallback(
    (
      item: { id: string; name: string; lat: number; lon: number },
      on: boolean,
    ) => {
      impactAsync?.();
      if (on) {
        setPreviewId(item.id);
        const track = findMatchingTrack(item.name, item.lat, item.lon);
        if (track) {
          dispatch({
            type: "SET_PREVIEW_ROUTE",
            payload: track.points.map((p) => ({ lat: p.lat, lon: p.lon })),
          });
        } else {
          dispatch({
            type: "SET_PREVIEW_ROUTE",
            payload: [{ lat: item.lat, lon: item.lon, label: "P" }],
          });
        }
        onShowOnMap?.(item.lat, item.lon);
      } else {
        setPreviewId(null);
        dispatch({ type: "SET_PREVIEW_ROUTE", payload: null });
      }
    },
    [dispatch, onShowOnMap, findMatchingTrack],
  );

  const handleRemove = useCallback(
    (fav: FavoriteItem) => {
      if (Platform.OS === "web") {
        if (
          typeof window !== "undefined" &&
          window.confirm(`Remove "${fav.name}" from favorites?`)
        ) {
          removeFavorite(fav.id);
        }
      } else {
        Alert.alert("Remove Favorite?", `Remove "${fav.name}"?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => removeFavorite(fav.id),
          },
        ]);
      }
    },
    [removeFavorite],
  );

  const handleClearAllFavorites = useCallback(() => {
    const totalCount = plannerPoints.length + favorites.length;
    if (totalCount === 0) return;
    const message =
      Platform.OS === "web"
        ? `Remove all ${totalCount} item(s) — favorites and current route from this list? This cannot be undone.`
        : `Remove all ${totalCount} item(s) — favorites and current route from this list? This cannot be undone.`;
    const onConfirm = async () => {
      impactAsync?.();
      clearAllFavorites();
      setPlannerPoints([]);
      try {
        await storage.clearRoute();
      } catch (_) {}
      setPreviewId(null);
      dispatch({ type: "SET_PREVIEW_ROUTE", payload: null });
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) onConfirm();
    } else {
      Alert.alert("Clear all?", message, [
        { text: "Cancel", style: "cancel" },
        { text: "Clear all", style: "destructive", onPress: onConfirm },
      ]);
    }
  }, [plannerPoints.length, favorites.length, clearAllFavorites, dispatch]);

  const handleExportGPX = useCallback(
    async (fav: FavoriteItem) => {
      try {
        if (Platform.OS !== "web") {
          try {
            impactAsync?.();
          } catch (_) {
            /* ignore haptics */
          }
        }
        const gpx = exportFavoriteToGPX(fav);
        const filename = `${sanitizeFilename(fav.name)}.gpx`;

        if (Platform.OS === "web") {
          const blob = new Blob([gpx], { type: "application/gpx+xml" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          const FileSystem = await import("expo-file-system/legacy");
          const Sharing = await import("expo-sharing");
          const path = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(path, gpx);
          const isAvailable = await Sharing.isAvailableAsync();
          if (isAvailable) {
            await Sharing.shareAsync(path, {
              mimeType: "application/gpx+xml",
              dialogTitle: "Export as GPX",
            });
          } else {
            Alert.alert("Sharing unavailable", "Could not share the file.");
          }
        }
      } catch (err) {
        console.error("Export failed:", err);
        Alert.alert("Export failed", "Could not export as GPX.");
      }
    },
    [exportFavoriteToGPX],
  );

  const allItems = [
    ...plannerPoints.map((p) => ({ ...p, isPlanner: true })),
    ...favorites.map((f) => ({ ...f, isPlanner: false })),
  ];

  if (allItems.length === 0) {
    return (
      <View style={styles.empty}>
        <MaterialCommunityIcons
          name="star-outline"
          size={48}
          color={colors.muted}
        />
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          No saved places yet. Import GPX/KML or add from the map (long-press).
        </Text>
      </View>
    );
  }

  const totalListCount = plannerPoints.length + favorites.length;
  const clearAllHeader =
    totalListCount > 0 ? (
      <TouchableOpacity
        style={[
          styles.clearAllRow,
          {
            borderColor: colors.border,
            backgroundColor: (colors.error ?? "#ef4444") + "12",
          },
        ]}
        onPress={handleClearAllFavorites}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons
          name="delete-sweep"
          size={20}
          color={colors.error ?? "#ef4444"}
        />
        <Text
          style={[styles.clearAllLabel, { color: colors.error ?? "#ef4444" }]}
        >
          Clear all ({totalListCount})
        </Text>
      </TouchableOpacity>
    ) : null;

  return (
    <FlatList
      data={allItems}
      keyExtractor={(item) => (item as any).id}
      ListHeaderComponent={clearAllHeader}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => {
        const isPlanner = (item as any).isPlanner;
        const name = item.name;
        const lat = item.lat;
        const lon = item.lon;
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
              onPress={() => handleShowOnMap(lat, lon, name)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={isPlanner ? "map-marker" : "star"}
                size={20}
                color={
                  isPlanner
                    ? colors.primary
                    : (colors.accentCyan ?? colors.primary)
                }
              />
              <View style={styles.itemText}>
                <Text
                  style={[styles.itemName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
                <Text
                  style={[
                    styles.itemCoords,
                    { color: colors.muted, fontFamily: Fonts!.mono },
                  ]}
                >
                  {lat.toFixed(5)}, {lon.toFixed(5)}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={colors.muted}
              />
            </TouchableOpacity>
            <View style={styles.previewToggleWrap}>
              <Text
                style={[styles.previewLabel, { color: colors.muted }]}
                numberOfLines={1}
              >
                Preview
              </Text>
              <Switch
                value={previewId === (item as any).id}
                onValueChange={(on) => handlePreviewToggle(item as any, on)}
                trackColor={{
                  false: colors.border,
                  true: (colors.primary ?? "#3b82f6") + "99",
                }}
                thumbColor={
                  previewId === (item as any).id
                    ? (colors.primary ?? "#3b82f6")
                    : colors.muted
                }
              />
            </View>
            {!isPlanner && (
              <>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    { backgroundColor: (colors.primary ?? "#3b82f6") + "22" },
                  ]}
                  onPress={() => handleExportGPX(item as FavoriteItem)}
                >
                  <MaterialCommunityIcons
                    name="export-variant"
                    size={18}
                    color={colors.primary ?? "#3b82f6"}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    { backgroundColor: (colors.error ?? "#ef4444") + "22" },
                  ]}
                  onPress={() => handleRemove(item as FavoriteItem)}
                >
                  <MaterialCommunityIcons
                    name="delete-outline"
                    size={18}
                    color={colors.error ?? "#ef4444"}
                  />
                </TouchableOpacity>
              </>
            )}
          </View>
        );
      }}
    />
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
  itemCoords: {
    fontSize: 11,
  },
  previewToggleWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
    gap: 6,
  },
  previewLabel: {
    fontSize: 11,
    maxWidth: 48,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  clearAllRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  clearAllLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
});
