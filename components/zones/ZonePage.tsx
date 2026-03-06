/**
 * Dedicated Zones page — map-centric view of truck zone partitions.
 * Layout: top toolbar, main map (70–80%), sidebar with zone list accordion and global stats.
 */
import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { useZonesStore, type SavedZoneResult } from "@/stores/zonesStore";
import { useDeviceType } from "@/hooks/useDeviceType";
import { RouteMap } from "@/components/route-map";
import type { ZoneOutput } from "@/services/overtureOptimizerService";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Fonts } from "@/lib/_core/theme";

const ZONE_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#a855f7", "#eab308", "#ef4444"];
const SIDEBAR_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 280;

function computeBoundsFromZones(result: SavedZoneResult): { minLat: number; minLon: number; maxLat: number; maxLon: number } | null {
  const hasPolygons = result.zones?.some((z) => z.zone_polygon?.length >= 3);
  if (hasPolygons && result.zones) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const z of result.zones) {
      if (!z.zone_polygon?.length) continue;
      for (const [lon, lat] of z.zone_polygon) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
      }
    }
    if (minLat !== Infinity) return { minLat, maxLat, minLon, maxLon };
  }
  if (result.polygon?.length >= 3) {
    const lats = result.polygon.map(([lat]) => lat);
    const lons = result.polygon.map(([, lon]) => lon);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    };
  }
  return null;
}

function zoneToPolygonLatLon(z: ZoneOutput): Array<{ latitude: number; longitude: number }> | null {
  if (!z.zone_polygon || z.zone_polygon.length < 3) return null;
  return z.zone_polygon.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
}

function zoneResultToGeoJSON(item: SavedZoneResult): string {
  const coords = item.polygon.map(([lat, lon]) => [lon, lat] as [number, number]);
  const ring = coords.length >= 3 ? [...coords, coords[0]] : [];
  const totalTime = item.zones.reduce((s, z) => s + z.estimated_time, 0);
  const feature = {
    type: "Feature" as const,
    properties: {
      name: item.name,
      zones: item.zones.length,
      truck_count: item.truck_count,
      balance_metric: item.balance_metric,
      total_estimated_time: totalTime,
      createdAt: item.createdAt,
    },
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
  return JSON.stringify({ type: "FeatureCollection" as const, features: [feature] }, null, 2);
}

function ZoneAccordionItem({
  zone,
  index,
  colors,
  expanded,
  onToggle,
}: {
  zone: ZoneOutput;
  index: number;
  colors: ReturnType<typeof useColors>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = ZONE_COLORS[index % ZONE_COLORS.length];
  const nodePreview = zone.node_ids.length <= 8
    ? zone.node_ids.join(", ")
    : `${zone.node_ids.slice(0, 5).join(", ")} … +${zone.node_ids.length - 5} more`;

  return (
    <View style={[styles.zoneItem, { borderLeftColor: color, borderBottomColor: colors.border }]}>
      <Pressable
        onPress={() => {
          hapticImpact();
          onToggle();
        }}
        style={({ pressed }) => [
          styles.zoneItemHeader,
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={[styles.zoneSwatch, { backgroundColor: color }]} />
        <Text style={[styles.zoneItemTitle, { color: colors.text }]}>Zone {zone.zone_id + 1}</Text>
        <Text style={[styles.zoneItemTime, { color: colors.muted }]}>
          {zone.estimated_time.toFixed(1)} min
          {zone.estimated_distance != null ? ` · ${(zone.estimated_distance / 1000).toFixed(2)} km` : ""}
        </Text>
        <MaterialCommunityIcons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={colors.muted}
        />
      </Pressable>
      {expanded && (
        <View style={[styles.zoneItemBody, { backgroundColor: colors.surface }]}>
          <Text style={[styles.zoneItemMeta, { color: colors.muted }]}>
            Nodes: {zone.node_ids.length}
          </Text>
          <Text style={[styles.zoneItemNodes, { color: colors.text }]} numberOfLines={4}>
            {nodePreview}
          </Text>
        </View>
      )}
    </View>
  );
}

export function ZonePage() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const deviceType = useDeviceType();
  const router = useRouter();

  const savedZones = useZonesStore((s) => s.savedZones);
  const displayedZoneId = useZonesStore((s) => s.displayedZoneId);
  const setDisplayedZoneId = useZonesStore((s) => s.setDisplayedZoneId);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedZoneIds, setExpandedZoneIds] = useState<Set<number>>(new Set([0]));

  /** Selected result to view: prefer displayedZoneId, else first saved (user can change via sidebar). */
  const selectedId = displayedZoneId ?? (savedZones.length > 0 ? savedZones[0].id : null);
  const selectedResult = useMemo(
    () => savedZones.find((z) => z.id === selectedId) ?? savedZones[0] ?? null,
    [savedZones, selectedId]
  );

  const selectResult = useCallback(
    (id: string) => {
      hapticImpact();
      setDisplayedZoneId(id);
    },
    [setDisplayedZoneId]
  );

  const zonesPreviewPolygons = useMemo(() => {
    if (!selectedResult?.zones) return undefined;
    const polys = selectedResult.zones
      .map(zoneToPolygonLatLon)
      .filter((p): p is NonNullable<typeof p> => p != null);
    return polys.length > 0 ? polys : undefined;
  }, [selectedResult]);

  const initialBounds = useMemo(
    () => (selectedResult ? computeBoundsFromZones(selectedResult) : null),
    [selectedResult]
  );

  const mapWidth = useMemo(() => {
    const sidebarW = sidebarCollapsed ? 0 : Math.min(SIDEBAR_WIDTH, winWidth * 0.3);
    return Math.max(200, winWidth - sidebarW);
  }, [winWidth, sidebarCollapsed]);

  const mapHeight = useMemo(() => {
    const toolbarH = 56 + insets.top;
    return Math.max(300, winHeight - toolbarH);
  }, [winHeight, insets.top]);

  const toggleZoneExpanded = useCallback((zoneId: number) => {
    setExpandedZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }, []);

  const handleShowOnMap = useCallback(() => {
    if (!selectedId) return;
    hapticImpact();
    setDisplayedZoneId(selectedId);
    router.replace("/(tabs)/map");
  }, [selectedId, setDisplayedZoneId, router]);

  const handleExport = useCallback(() => {
    if (!selectedResult) return;
    hapticImpact();
    const baseName = (selectedResult.name || "zones").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
    Alert.alert("Export zone", "Choose format", [
      { text: "Cancel", style: "cancel" },
      {
        text: "GeoJSON",
        onPress: async () => {
          try {
            const content = zoneResultToGeoJSON(selectedResult);
            const path = `${FileSystem.cacheDirectory}${baseName}.geojson`;
            await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 });
            const Sharing = await import("expo-sharing");
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(path, { mimeType: "application/geo+json", dialogTitle: "Share zone (GeoJSON)" });
            } else if (Platform.OS === "web") {
              const blob = new Blob([content], { type: "application/geo+json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${baseName}.geojson`;
              a.click();
              URL.revokeObjectURL(url);
            }
          } catch (e) {
            Alert.alert("Export failed", (e as Error).message);
          }
        },
      },
      {
        text: "JSON",
        onPress: async () => {
          try {
            const content = JSON.stringify(selectedResult, null, 2);
            const path = `${FileSystem.cacheDirectory}${baseName}.json`;
            await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 });
            const Sharing = await import("expo-sharing");
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: "Share zone (JSON)" });
            } else if (Platform.OS === "web") {
              const blob = new Blob([content], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${baseName}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }
          } catch (e) {
            Alert.alert("Export failed", (e as Error).message);
          }
        },
      },
    ]);
  }, [selectedResult]);

  const totalTime = selectedResult
    ? selectedResult.zones.reduce((s, z) => s + z.estimated_time, 0)
    : 0;
  const avgTime = selectedResult && selectedResult.zones.length > 0
    ? totalTime / selectedResult.zones.length
    : 0;
  const times = selectedResult?.zones.map((z) => z.estimated_time) ?? [];
  const maxTime = times.length ? Math.max(...times) : 0;
  const minTime = times.length ? Math.min(...times) : 0;
  const imbalanceRatio = minTime > 0 ? maxTime / minTime : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Toolbar */}
      <View
        style={[
          styles.toolbar,
          {
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <View style={styles.toolbarLeft}>
          <Text style={[styles.toolbarTitle, { color: colors.text }]}>Zones</Text>
          {savedZones.length > 0 && (
            <TouchableOpacity
              onPress={() => setSidebarCollapsed((c) => !c)}
              style={[styles.toolbarButton, { borderColor: colors.border }]}
            >
              <MaterialCommunityIcons
                name={sidebarCollapsed ? "panel-right" : "panel-left"}
                size={20}
                color={colors.muted}
              />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.toolbarRight}>
          {selectedResult && (
            <>
              <TouchableOpacity
                onPress={handleExport}
                style={[styles.toolbarButton, { borderColor: colors.border }]}
              >
                <MaterialCommunityIcons name="export" size={18} color={colors.muted} />
                <Text style={[styles.toolbarButtonLabel, { color: colors.muted }]}>Export</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleShowOnMap}
                style={[styles.toolbarButton, { borderColor: colors.border }]}
              >
                <MaterialCommunityIcons name="map-marker" size={18} color={colors.primary} />
                <Text style={[styles.toolbarButtonLabel, { color: colors.primary }]}>Show on Map</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Body: map + sidebar */}
      <View style={styles.body}>
        <View style={[styles.mapWrap, { width: mapWidth, height: mapHeight }]}>
          {selectedResult && zonesPreviewPolygons && zonesPreviewPolygons.length > 0 ? (
            <RouteMap
              collectionPoints={[]}
              height={mapHeight}
              width={mapWidth}
              zonesPreviewPolygons={zonesPreviewPolygons}
              initialBounds={initialBounds ?? undefined}
              onLoad={() => {}}
            />
          ) : (
            <View style={[styles.mapPlaceholder, { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons name="vector-polygon" size={48} color={colors.muted} />
              <Text style={[styles.mapPlaceholderText, { color: colors.text }]}>
                {savedZones.length === 0
                  ? "No zone results yet"
                  : "Select a result in the sidebar"}
              </Text>
              <Text style={[styles.mapPlaceholderHint, { color: colors.muted }]}>
                {savedZones.length === 0
                  ? "Run zone partition from the Extract tab, then open Zones to view."
                  : "Pick a saved partition to view zones on the map."}
              </Text>
            </View>
          )}
        </View>

        {!sidebarCollapsed && (
          <View
            style={[
              styles.sidebar,
              {
                width: Math.min(SIDEBAR_WIDTH, winWidth - mapWidth),
                minWidth: SIDEBAR_MIN_WIDTH,
                borderLeftColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <ScrollView
              style={styles.sidebarScroll}
              contentContainerStyle={styles.sidebarContent}
              showsVerticalScrollIndicator
            >
              {savedZones.length > 1 && (
                <>
                  <Text style={[styles.sidebarSectionTitle, { color: colors.muted }]}>
                    Saved results
                  </Text>
                  {savedZones.map((item) => {
                    const isSelected = item.id === selectedId;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => selectResult(item.id)}
                        style={[
                          styles.resultRow,
                          {
                            backgroundColor: isSelected ? colors.primary + "20" : "transparent",
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.resultRowName,
                            { color: isSelected ? colors.primary : colors.text },
                          ]}
                          numberOfLines={1}
                        >
                          {item.name || "Unnamed"}
                        </Text>
                        <Text style={[styles.resultRowMeta, { color: colors.muted }]}>
                          {item.zones.length} zones
                        </Text>
                      </Pressable>
                    );
                  })}
                </>
              )}
              {selectedResult ? (
                <>
                  <Text style={[styles.sidebarSectionTitle, { color: colors.muted, marginTop: savedZones.length > 1 ? 16 : 0 }]}>
                    {selectedResult.name || "Unnamed zones"}
                  </Text>
                  <View style={[styles.statsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.statsRow, { color: colors.text }]}>
                      Zones: <Text style={Fonts?.medium}>{selectedResult.zones.length}</Text>
                    </Text>
                    <Text style={[styles.statsRow, { color: colors.text }]}>
                      Total time: <Text style={Fonts?.medium}>{totalTime.toFixed(1)} min</Text>
                    </Text>
                    <Text style={[styles.statsRow, { color: colors.text }]}>
                      Avg per zone: <Text style={Fonts?.medium}>{avgTime.toFixed(1)} min</Text>
                    </Text>
                    {imbalanceRatio > 0 && (
                      <Text style={[styles.statsRow, { color: colors.muted }]}>
                        Imbalance (max/min): {imbalanceRatio.toFixed(2)}×
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.sidebarSectionTitle, { color: colors.muted, marginTop: 16 }]}>
                    Zone list
                  </Text>
                  {selectedResult.zones
                    .sort((a, b) => b.estimated_time - a.estimated_time)
                    .map((zone, idx) => (
                      <ZoneAccordionItem
                        key={zone.zone_id}
                        zone={zone}
                        index={zone.zone_id}
                        colors={colors}
                        expanded={expandedZoneIds.has(zone.zone_id)}
                        onToggle={() => toggleZoneExpanded(zone.zone_id)}
                      />
                    ))}
                </>
              ) : (
                <View style={styles.emptySidebar}>
                  <Text style={[styles.emptySidebarText, { color: colors.muted }]}>
                    No saved zone results. Run partition from the Extract tab (Partition → send to Zones).
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  toolbarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toolbarTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  toolbarButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  toolbarButtonLabel: {
    fontSize: 14,
    ...Fonts?.medium,
  },
  toolbarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  body: {
    flex: 1,
    flexDirection: "row",
  },
  mapWrap: {
    alignSelf: "stretch",
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  mapPlaceholderText: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 12,
  },
  mapPlaceholderHint: {
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
  },
  sidebar: {
    borderLeftWidth: 1,
    flex: 0,
  },
  sidebarScroll: {
    flex: 1,
  },
  sidebarContent: {
    padding: 16,
    paddingBottom: 32,
  },
  sidebarSectionTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  statsCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  statsRow: {
    fontSize: 14,
    marginBottom: 4,
  },
  zoneItem: {
    borderLeftWidth: 4,
    borderBottomWidth: 1,
  },
  zoneItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  zoneSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  zoneItemTitle: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  zoneItemTime: {
    fontSize: 13,
  },
  zoneItemBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 0,
  },
  zoneItemMeta: {
    fontSize: 12,
    marginBottom: 4,
  },
  zoneItemNodes: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  emptySidebar: {
    paddingVertical: 24,
  },
  emptySidebarText: {
    fontSize: 14,
    textAlign: "center",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  resultRowName: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  resultRowMeta: {
    fontSize: 12,
  },
});
