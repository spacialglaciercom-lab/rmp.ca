/**
 * Route-based bbox map download section for Settings.
 * Downloads only the tiles within a route's bounding box from Cloudflare R2 PMTiles.
 * Native only (iOS/Android).
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { confirmDestructive } from "@/lib/confirmDestructive";
import {
  getDownloadedRouteMaps,
  downloadRouteMap,
  deleteRouteMap,
  estimateRouteMapDownload,
  formatBytes,
  type DownloadedRouteMap,
  type RouteMapEstimate,
} from "@/lib/route-bbox-map-download";

export const RouteMapDownloadSection: React.FC = () => {
  const colors = useColors();
  const { state } = useRouting();
  const gpxData = state.gpxData;

  const [downloaded, setDownloaded] = useState<DownloadedRouteMap[]>([]);
  const [estimate, setEstimate] = useState<RouteMapEstimate | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    phase: string;
  } | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const maps = await getDownloadedRouteMaps();
    setDownloaded(maps);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!gpxData) {
      setEstimate(null);
      return;
    }
    try {
      setEstimate(estimateRouteMapDownload(gpxData));
    } catch {
      setEstimate(null);
    }
  }, [gpxData]);

  const handleDownload = useCallback(async () => {
    if (Platform.OS === "web" || !gpxData || !estimate) return;
    hapticImpact();

    if (!estimate.city) {
      Alert.alert(
        "No coverage",
        "This route is outside available map tile coverage. Currently supported: Montreal, Toronto, Vancouver.",
      );
      return;
    }

    const routeId = `route_${Date.now()}`;
    const routeName = state.statistics?.totalDistance
      ? `Route (${state.statistics.totalDistance.toFixed(1)} km)`
      : "Current route";

    const controller = new AbortController();
    abortRef.current = controller;
    setDownloading(true);
    setProgress({ done: 0, total: estimate.tileCount, phase: "Starting…" });

    try {
      const result = await downloadRouteMap(
        routeId,
        routeName,
        gpxData,
        (done, total, phase) => setProgress({ done, total, phase }),
        controller.signal,
      );
      setProgress(null);

      if (result.success) {
        await refresh();
        Alert.alert(
          "Done",
          `Downloaded ${result.tileCount} tiles (${formatBytes(result.sizeBytes)}) for this route.`,
        );
      } else {
        Alert.alert("Info", result.error ?? "Download failed. Try again.");
      }
    } catch (e) {
      setProgress(null);
      Alert.alert("Error", e instanceof Error ? e.message : "Download failed.");
    } finally {
      abortRef.current = null;
      setDownloading(false);
    }
  }, [gpxData, estimate, state.statistics, refresh]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleDelete = useCallback(
    (routeMap: DownloadedRouteMap) => {
      if (Platform.OS === "web") return;
      hapticImpact();
      confirmDestructive(
        "Delete route map",
        `Remove offline tiles for "${routeMap.routeName}" (${routeMap.tileCount} tiles, ${formatBytes(routeMap.sizeBytes)})?`,
        async () => {
          await deleteRouteMap(routeMap.routeId);
          await refresh();
        },
      );
    },
    [refresh],
  );

  if (Platform.OS === "web") return null;

  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <View style={{ paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>
        Download map tiles along your route from Cloudflare R2. Only tiles
        within the route bounding box (zoom 10–14) are fetched via HTTP Range
        requests — no API key needed. Saves ~95–98% vs a full city download.
      </Text>

      {/* Downloaded route maps */}
      {downloaded.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: colors.muted,
              marginBottom: 8,
            }}
          >
            Downloaded route maps
          </Text>
          {downloaded.map((rm) => (
            <View
              key={rm.routeId}
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
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "500",
                    color: colors.foreground,
                  }}
                >
                  {rm.routeName}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {rm.tileCount} tiles · {formatBytes(rm.sizeBytes)} · z
                  {rm.zoomRange[0]}–{rm.zoomRange[1]} · {rm.city}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>
                  {new Date(rm.downloadedAt).toLocaleDateString()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDelete(rm)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: colors.error + "30",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: colors.error,
                    fontWeight: "600",
                  }}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Current route download */}
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: colors.muted,
          marginBottom: 8,
        }}
      >
        Current route
      </Text>

      {!gpxData ? (
        <Text
          style={{ fontSize: 13, color: colors.muted, fontStyle: "italic" }}
        >
          No route loaded. Generate or import a route first, then return here to
          download offline map tiles along the route.
        </Text>
      ) : !estimate ? (
        <Text
          style={{ fontSize: 13, color: colors.muted, fontStyle: "italic" }}
        >
          Could not compute bounding box from route GPX.
        </Text>
      ) : !estimate.city ? (
        <View
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: colors.surface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 13, color: colors.muted }}>
            Route is outside available tile coverage. Currently supported:
            Montreal, Toronto, Vancouver.
          </Text>
        </View>
      ) : downloading ? (
        <View
          style={{
            paddingVertical: 12,
            paddingHorizontal: 12,
            backgroundColor: colors.surface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "500",
                  color: colors.foreground,
                }}
              >
                Downloading tiles…
              </Text>
              {progress && (
                <Text
                  style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}
                >
                  {progress.done}/{progress.total} · {progressPct}%
                </Text>
              )}
              {progress && (
                <Text style={{ fontSize: 11, color: colors.muted }}>
                  {progress.phase}
                </Text>
              )}
            </View>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <ActivityIndicator size="small" color={colors.primary} />
              <TouchableOpacity
                onPress={handleCancel}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: colors.error + "30",
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.error,
                    fontWeight: "600",
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Progress bar */}
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.primary,
                width: `${progressPct}%`,
              }}
            />
          </View>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: colors.surface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "500",
                color: colors.foreground,
              }}
            >
              {estimate.city.charAt(0).toUpperCase() + estimate.city.slice(1)}{" "}
              area
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {estimate.tileCount} tiles · ~
              {formatBytes(estimate.estimatedBytes)} estimated · z{MIN_ZOOM}–z
              {MAX_ZOOM}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleDownload}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ fontSize: 13, color: "#fff", fontWeight: "600" }}>
              Download
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const MIN_ZOOM = 10;
const MAX_ZOOM = 14;
