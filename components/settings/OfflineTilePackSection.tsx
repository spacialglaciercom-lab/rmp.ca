/**
 * Offline MapLibre tile pack download — style + tiles for fully offline map viewing.
 * Lists downloaded packs, Delete, and Refresh outdated tiles. Native only.
 */
import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useTheme } from "@/lib/theme-provider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { confirmDestructive } from "@/lib/confirmDestructive";
import {
  getAllOfflinePacks,
  deleteOfflinePack,
  invalidatePack,
  invalidateAmbientCache,
  downloadOfflineRegion,
  type OfflineProgress,
} from "@/lib/offline-map-download";
import { MAPLIBRE_STYLE_OSM, MAPLIBRE_STYLE_OSM_DARK } from "@/components/maplibre/constants";

/** Montreal bounds: [[NE_LNG, NE_LAT], [SW_LNG, SW_LAT]] */
const MONTREAL_BOUNDS: [[number, number], [number, number]] = [
  [-73.5, 45.7],
  [-73.85, 45.41],
];

const PACK_NAME = "Montreal-Offline";
const MIN_ZOOM = 10;
const MAX_ZOOM = 16;

/** Pack shape from MapLibre OfflineManager.getPacks() — may include name, metadata, etc. */
type OfflinePack = { name?: string; [key: string]: unknown };

function getPackName(pack: OfflinePack): string {
  if (pack && typeof pack === "object" && typeof pack.name === "string") {
    return pack.name;
  }
  return "Unnamed pack";
}

export const OfflineTilePackSection: React.FC = () => {
  const colors = useColors();
  const { colorScheme } = useTheme();
  const [packs, setPacks] = useState<OfflinePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [refreshingTiles, setRefreshingTiles] = useState(false);
  const [refreshingPack, setRefreshingPack] = useState<string | null>(null);

  const styleURL =
    colorScheme === "dark" ? MAPLIBRE_STYLE_OSM_DARK : MAPLIBRE_STYLE_OSM;

  const refreshPacks = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      const list = await getAllOfflinePacks();
      setPacks(Array.isArray(list) ? (list as OfflinePack[]) : []);
    } catch (e) {
      console.warn("[OfflineTilePack] getPacks failed:", e);
      setPacks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    refreshPacks();
  }, [refreshPacks]);

  const handleDelete = useCallback(
    (pack: OfflinePack) => {
      if (Platform.OS === "web") return;
      const name = getPackName(pack);
      hapticImpact();
      confirmDestructive(
        "Delete offline pack",
        `Remove "${name}"? Tiles will need to be re-downloaded to use this region offline again.`,
        async () => {
          await deleteOfflinePack(name);
          await refreshPacks();
        }
      );
    },
    [refreshPacks]
  );

  const handleRefreshPack = useCallback(
    async (pack: OfflinePack) => {
      if (Platform.OS === "web") return;
      const name = getPackName(pack);
      hapticImpact();
      setRefreshingPack(name);
      try {
        await invalidatePack(name);
        Alert.alert("Done", `Outdated tiles for "${name}" will be refreshed when you use the map.`);
        await refreshPacks();
      } catch (e) {
        Alert.alert("Error", e instanceof Error ? e.message : "Refresh failed.");
      } finally {
        setRefreshingPack(null);
      }
    },
    [refreshPacks]
  );

  const handleRefreshAmbientCache = useCallback(async () => {
    if (Platform.OS === "web") return;
    hapticImpact();
    setRefreshingTiles(true);
    try {
      await invalidateAmbientCache();
      Alert.alert("Done", "Outdated tiles will be refreshed when you use the map.");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setRefreshingTiles(false);
    }
  }, []);

  const startDownload = useCallback(() => {
    if (Platform.OS === "web") return;
    hapticImpact();
    setIsDownloading(true);
    setProgress(0);

    downloadOfflineRegion(
      PACK_NAME,
      styleURL,
      MONTREAL_BOUNDS,
      MIN_ZOOM,
      MAX_ZOOM,
      (p: OfflineProgress) => setProgress(p.percentage),
      () => {
        Alert.alert("Success", "Offline map ready. You can use the map without connectivity.");
        setIsDownloading(false);
        refreshPacks();
      },
      (err) => {
        Alert.alert(
          "Error",
          err instanceof Error ? err.message : "Download failed. Try again."
        );
        setIsDownloading(false);
      }
    );
  }, [styleURL, refreshPacks]);

  if (Platform.OS === "web") return null;

  return (
    <View style={{ paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
        Download map tiles for offline viewing (MapLibre). Uses the same style as the map tab. Montreal region, zooms 10–16.
      </Text>

      {/* List of downloaded packs */}
      {loading ? (
        <View style={{ marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ fontSize: 13, color: colors.muted }}>Loading packs…</Text>
        </View>
      ) : packs.length > 0 ? (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8 }}>
            Downloaded packs
          </Text>
          {packs.map((pack, index) => {
            const name = getPackName(pack);
            const isRefreshing = refreshingPack === name;
            return (
              <View
                key={name || index}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  backgroundColor: colors.surface,
                  borderRadius: 8,
                  marginBottom: 6,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: "500", color: colors.foreground, flex: 1 }} numberOfLines={1}>
                  {name}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => handleRefreshPack(pack)}
                    disabled={isRefreshing}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: colors.primary + "25",
                    }}
                  >
                    {isRefreshing ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Refresh tiles</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(pack)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 6,
                      backgroundColor: colors.error + "30",
                    }}
                  >
                    <Text style={{ fontSize: 12, color: colors.error, fontWeight: "600" }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Refresh outdated tiles (ambient cache) */}
      <TouchableOpacity
        onPress={handleRefreshAmbientCache}
        disabled={refreshingTiles}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 8,
          marginBottom: 12,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {refreshingTiles ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : null}
        <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>
          {refreshingTiles ? "Refreshing…" : "Refresh outdated tiles"}
        </Text>
      </TouchableOpacity>

      {isDownloading && (
        <View style={{ marginBottom: 16 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <Text style={{ fontSize: 12, color: colors.muted }}>Downloading…</Text>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
              {Math.min(progress, 100)}%
            </Text>
          </View>
          <View
            style={{
              height: 8,
              backgroundColor: colors.border,
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${Math.min(progress, 100)}%`,
                backgroundColor: colors.primary,
                borderRadius: 4,
              }}
            />
          </View>
        </View>
      )}

      <TouchableOpacity
        onPress={startDownload}
        disabled={isDownloading}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 10,
          backgroundColor: isDownloading ? colors.border : colors.primary,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: isDownloading ? colors.muted : "#fff",
          }}
        >
          {isDownloading ? "Downloading…" : "Download Montreal offline tiles"}
        </Text>
      </TouchableOpacity>
    </View>
  );
};
