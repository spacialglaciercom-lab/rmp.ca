/**
 * Dedicated Zones page — map-centric view of truck zone partitions.
 * Layout: top toolbar, main map (70–80%), sidebar with zone list accordion and global stats.
 * Waste mode: map bins/dumpsters, partition from points, view zones.
 */
import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { useZonesStore, type SavedZoneResult, type SourcePointSnapshot } from "@/stores/zonesStore";
import { useWastePointsStore } from "@/stores/wastePointsStore";
import { useDeviceType } from "@/hooks/useDeviceType";
import { RouteMap } from "@/components/route-map";
import type { ZoneOutput } from "@/services/overtureOptimizerService";
import { partitionZonesFromPoints } from "@/services/overtureOptimizerService";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Fonts } from "@/lib/_core/theme";
import { WastePointFormModal, type WastePointFormValues } from "@/components/zones/WastePointFormModal";
import { WasteImportModal } from "@/components/zones/WasteImportModal";

export type ZonesPageMode = "delivery" | "waste";

const ZONE_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#a855f7", "#eab308", "#ef4444"];
const SIDEBAR_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 280;

/** Build [lat, lon][] polygon (closed ring) from zone polygons (bbox of all points). */
function polygonFromZoneOutputs(zones: ZoneOutput[]): Array<[number, number]> {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const z of zones) {
    if (!z.zone_polygon?.length) continue;
    for (const [lon, lat] of z.zone_polygon) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }
  if (minLat === Infinity) return [];
  return [
    [minLat, minLon],
    [maxLat, minLon],
    [maxLat, maxLon],
    [minLat, maxLon],
    [minLat, minLon],
  ];
}

function computeBoundsFromZones(result: SavedZoneResult): { minLat: number; minLon: number; maxLat: number; maxLon: number } | null {
  const hasPolygons = result.zones?.some((z) => z.zone_polygon?.length >= 3);
  if (hasPolygons && result.zones) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const z of result.zones) {
      const poly = z.zone_polygon;
      if (!poly || poly.length < 3) continue;
      for (const [lon, lat] of poly) {
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

function escapeKml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zoneResultAndWasteToKML(
  item: SavedZoneResult | null,
  wastePoints: Array<{ lat: number; lon: number; type: string; capacityLiters?: number; condition?: string; address?: string }>
): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    "<name>Waste zones and points</name>",
  ];
  wastePoints.forEach((p, i) => {
    parts.push(
      "<Placemark>",
      `<name>${escapeKml(p.type)} ${i + 1}</name>`,
      "<description>",
      escapeKml([p.address, p.capacityLiters != null ? `${p.capacityLiters} L` : "", p.condition ?? ""].filter(Boolean).join(" · ") || ""),
      "</description>",
      "<Point><coordinates>",
      `${p.lon},${p.lat},0`,
      "</coordinates></Point>",
      "</Placemark>"
    );
  });
  if (item?.zones) {
    item.zones.forEach((z, idx) => {
      if (!z.zone_polygon || z.zone_polygon.length < 3) return;
      const ring = [...z.zone_polygon.map(([lon, lat]) => `${lon},${lat},0`), `${z.zone_polygon[0][0]},${z.zone_polygon[0][1]},0`];
      parts.push(
        "<Placemark>",
        `<name>Zone ${idx + 1}</name>`,
        "<Polygon><outerBoundaryIs><LinearRing><coordinates>",
        ring.join(" "),
        "</coordinates></LinearRing></outerBoundaryIs></Polygon>",
        "</Placemark>"
      );
    });
  }
  parts.push("</Document>", "</kml>");
  return parts.join("\n");
}

function ZoneAccordionItem({
  zone,
  index,
  colors,
  expanded,
  onToggle,
  sourcePoints,
}: {
  zone: ZoneOutput;
  index: number;
  colors: ReturnType<typeof useColors>;
  expanded: boolean;
  onToggle: () => void;
  sourcePoints?: SourcePointSnapshot[] | null;
}) {
  const color = ZONE_COLORS[index % ZONE_COLORS.length];
  const nodePreview = zone.node_ids.length <= 8
    ? zone.node_ids.join(", ")
    : `${zone.node_ids.slice(0, 5).join(", ")} … +${zone.node_ids.length - 5} more`;
  const totalCapacity = sourcePoints && sourcePoints.length > 0
    ? zone.node_ids.reduce((sum, i) => sum + (sourcePoints[i]?.weight ?? 0), 0)
    : null;

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
          {totalCapacity != null && totalCapacity > 0 ? ` · ${Math.round(totalCapacity)}L` : ""}
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
            {totalCapacity != null && totalCapacity > 0 ? ` · Total capacity: ${Math.round(totalCapacity)}L` : ""}
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
  const addSavedZone = useZonesStore((s) => s.addSavedZone);

  const wastePoints = useWastePointsStore((s) => s.points);
  const addWastePoint = useWastePointsStore((s) => s.add);
  const updateWastePoint = useWastePointsStore((s) => s.update);
  const removeWastePoint = useWastePointsStore((s) => s.remove);

  const [pageMode, setPageMode] = useState<ZonesPageMode>("delivery");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedZoneIds, setExpandedZoneIds] = useState<Set<number>>(new Set([0]));
  const [wasteTruckCount, setWasteTruckCount] = useState("2");
  const [wasteBalanceMetric, setWasteBalanceMetric] = useState<"count" | "weight" | "distance">("weight");
  const [wasteKnnNeighbors, setWasteKnnNeighbors] = useState(5);
  const [wastePartitionLoading, setWastePartitionLoading] = useState(false);
  const [wasteZoneName, setWasteZoneName] = useState("");
  const [addWasteModalVisible, setAddWasteModalVisible] = useState(false);
  const [importWasteModalVisible, setImportWasteModalVisible] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"mapping" | "zones">("mapping");
  const [editingWastePoint, setEditingWastePoint] = useState<import("@/types").WastePoint | null>(null);
  const [pickWasteLocationMode, setPickWasteLocationMode] = useState(false);
  const [pendingWasteCoords, setPendingWasteCoords] = useState<{ lat: number; lon: number } | null>(null);

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

  const wasteBounds = useMemo(() => {
    if (wastePoints.length === 0) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of wastePoints) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    return minLat !== Infinity ? { minLat, maxLat, minLon, maxLon } : null;
  }, [wastePoints]);

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

  const handleWastePartition = useCallback(async () => {
    const truckCount = Math.max(1, parseInt(wasteTruckCount, 10) || 2);
    if (wastePoints.length < truckCount) {
      Alert.alert(
        "Not enough points",
        `Map at least ${truckCount} bin(s) or dumpster(s), then run Partition.`
      );
      return;
    }
    hapticImpact();
    setWastePartitionLoading(true);
    try {
      const points = wastePoints.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        weight: p.capacityLiters ?? 1,
      }));
      const { zones } = await partitionZonesFromPoints({
        points,
        truck_count: truckCount,
        balance_metric: wasteBalanceMetric,
        knn_neighbors: wasteKnnNeighbors,
        include_polygons: true,
      });
      const polygon = polygonFromZoneOutputs(zones);
      if (polygon.length < 3) {
        Alert.alert("Partition failed", "Could not build zone boundary.");
        return;
      }
      const sourcePoints: SourcePointSnapshot[] = wastePoints.map((p) => ({
        id: p.id,
        lat: p.lat,
        lon: p.lon,
        weight: p.capacityLiters ?? 1,
      }));
      const name = wasteZoneName.trim() || `Waste zones (${wastePoints.length} points)`;
      addSavedZone({
        name,
        polygon,
        zones,
        truck_count: truckCount,
        balance_metric: wasteBalanceMetric,
        sourcePoints,
      });
      setDisplayedZoneId(null);
      setSidebarTab("zones");
      Alert.alert("Zones created", `${zones.length} zones saved. Open the Zones List tab to view.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Partition failed", msg);
    } finally {
      setWastePartitionLoading(false);
    }
  }, [
    wastePoints,
    wasteTruckCount,
    wasteBalanceMetric,
    wasteKnnNeighbors,
    wasteZoneName,
    addSavedZone,
  ]);

  const handleMapPressForWastePick = useCallback((lat: number, lon: number) => {
    if (!pickWasteLocationMode) return;
    hapticImpact();
    setPendingWasteCoords({ lat, lon });
    setPickWasteLocationMode(false);
    setAddWasteModalVisible(true);
  }, [pickWasteLocationMode]);

  const handleWastePointSave = useCallback(
    (values: WastePointFormValues) => {
      if (editingWastePoint) {
        updateWastePoint(editingWastePoint.id, {
          lat: values.lat,
          lon: values.lon,
          type: values.type,
          capacityLiters: values.capacityLiters,
          condition: values.condition,
          address: values.address,
        });
        setEditingWastePoint(null);
        setPendingWasteCoords(null);
        return;
      }
      const thresholdDeg = 0.00015;
      const hasNearby = wastePoints.some(
        (p) =>
          Math.abs(p.lat - values.lat) < thresholdDeg &&
          Math.abs(p.lon - values.lon) < thresholdDeg
      );
      if (hasNearby) {
        Alert.alert(
          "Possible duplicate",
          "A bin or dumpster is already mapped very close to this location. Add anyway?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Add anyway",
              onPress: () => {
                addWastePoint({
                  lat: values.lat,
                  lon: values.lon,
                  type: values.type,
                  capacityLiters: values.capacityLiters,
                  condition: values.condition,
                  address: values.address,
                });
                setPendingWasteCoords(null);
              },
            },
          ]
        );
        return;
      }
      addWastePoint({
        lat: values.lat,
        lon: values.lon,
        type: values.type,
        capacityLiters: values.capacityLiters,
        condition: values.condition,
        address: values.address,
      });
      setPendingWasteCoords(null);
    },
    [editingWastePoint, wastePoints, addWastePoint, updateWastePoint]
  );

  const handleAddWasteModalClose = useCallback(() => {
    setAddWasteModalVisible(false);
    setEditingWastePoint(null);
    setPendingWasteCoords(null);
    setPickWasteLocationMode(false);
  }, []);

  const handleExport = useCallback(() => {
    const baseName = (selectedResult?.name || "zones").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
    const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
      { text: "Cancel", style: "cancel" },
    ];
    if (selectedResult) {
      buttons.push(
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
        }
      );
    }
    if (pageMode === "waste" && (wastePoints.length > 0 || selectedResult)) {
      buttons.push({
        text: "KML",
        onPress: async () => {
          try {
            const content = zoneResultAndWasteToKML(selectedResult ?? null, wastePoints);
            const path = `${FileSystem.cacheDirectory}${baseName}_waste.kml`;
            await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 });
            const Sharing = await import("expo-sharing");
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(path, { mimeType: "application/vnd.google-earth.kml+xml", dialogTitle: "Share (KML)" });
            } else if (Platform.OS === "web") {
              const blob = new Blob([content], { type: "application/vnd.google-earth.kml+xml" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${baseName}_waste.kml`;
              a.click();
              URL.revokeObjectURL(url);
            }
          } catch (e) {
            Alert.alert("Export failed", (e as Error).message);
          }
        },
      });
    }
    hapticImpact();
    Alert.alert("Export zone", "Choose format", buttons);
  }, [selectedResult, pageMode, wastePoints]);

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
          <View style={[styles.modeToggle, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <TouchableOpacity
              onPress={() => { hapticImpact(); setPageMode("delivery"); }}
              style={[
                styles.modeToggleBtn,
                pageMode === "delivery" && { backgroundColor: colors.primary },
              ]}
            >
              <Text style={[styles.modeToggleLabel, { color: pageMode === "delivery" ? "#fff" : colors.muted }]}>
                Delivery
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { hapticImpact(); setPageMode("waste"); }}
              style={[
                styles.modeToggleBtn,
                pageMode === "waste" && { backgroundColor: colors.primary },
              ]}
            >
              <Text style={[styles.modeToggleLabel, { color: pageMode === "waste" ? "#fff" : colors.muted }]}>
                Waste
              </Text>
            </TouchableOpacity>
          </View>
          {(savedZones.length > 0 || pageMode === "waste") && (
            <TouchableOpacity
              onPress={() => setSidebarCollapsed((c) => !c)}
              style={[styles.toolbarButton, { borderColor: colors.border }]}
            >
              <MaterialCommunityIcons
                name={sidebarCollapsed ? "chevron-double-right" : "chevron-double-left"}
                size={20}
                color={colors.muted}
              />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.toolbarRight}>
          {pageMode === "waste" ? (
            <>
              <TouchableOpacity
                onPress={() => { hapticImpact(); setAddWasteModalVisible(true); }}
                style={[styles.toolbarButton, { borderColor: colors.border }]}
              >
                <MaterialCommunityIcons name="plus" size={18} color={colors.primary} />
                <Text style={[styles.toolbarButtonLabel, { color: colors.primary }]}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { hapticImpact(); setImportWasteModalVisible(true); }}
                style={[styles.toolbarButton, { borderColor: colors.border }]}
              >
                <MaterialCommunityIcons name="upload" size={18} color={colors.muted} />
                <Text style={[styles.toolbarButtonLabel, { color: colors.muted }]}>Import</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleWastePartition}
                disabled={wastePartitionLoading || wastePoints.length < 2}
                style={[styles.toolbarButton, { borderColor: colors.border, opacity: wastePoints.length < 2 ? 0.5 : 1 }]}
              >
                {wastePartitionLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <MaterialCommunityIcons name="vector-polygon" size={18} color={colors.primary} />
                )}
                <Text style={[styles.toolbarButtonLabel, { color: colors.primary }]}>
                  {wastePartitionLoading ? "Partitioning…" : "Partition"}
                </Text>
              </TouchableOpacity>
              {(selectedResult || wastePoints.length > 0) && (
                <TouchableOpacity
                  onPress={handleExport}
                  style={[styles.toolbarButton, { borderColor: colors.border }]}
                >
                  <MaterialCommunityIcons name="export" size={18} color={colors.muted} />
                  <Text style={[styles.toolbarButtonLabel, { color: colors.muted }]}>Export</Text>
                </TouchableOpacity>
              )}
            </>
          ) : selectedResult ? (
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
          ) : null}
        </View>
      </View>

      {/* Body: map + sidebar */}
      <View style={styles.body}>
        <View style={[styles.mapWrap, { width: mapWidth, height: mapHeight }]}>
          {pageMode === "waste" ? (
            (selectedResult && zonesPreviewPolygons && zonesPreviewPolygons.length > 0) || wastePoints.length > 0 ? (
              <RouteMap
                collectionPoints={[]}
                height={mapHeight}
                width={mapWidth}
                zonesPreviewPolygons={zonesPreviewPolygons ?? undefined}
                initialBounds={
                  selectedResult && initialBounds
                    ? initialBounds
                    : wasteBounds
                      ? { minLat: wasteBounds.minLat, maxLat: wasteBounds.maxLat, minLon: wasteBounds.minLon, maxLon: wasteBounds.maxLon }
                      : undefined
                }
                wastePoints={wastePoints}
                onMapPress={pickWasteLocationMode ? handleMapPressForWastePick : undefined}
                onLoad={() => {}}
              />
            ) : (
              <View style={[styles.mapPlaceholder, { backgroundColor: colors.surface }]}>
                <MaterialCommunityIcons name="delete-outline" size={48} color={colors.muted} />
                <Text style={[styles.mapPlaceholderText, { color: colors.text }]}>
                  No bins or dumpsters mapped
                </Text>
                <Text style={[styles.mapPlaceholderHint, { color: colors.muted }]}>
                  Tap Add to place a bin or dumpster, or Import CSV/GeoJSON.
                </Text>
              </View>
            )
          ) : selectedResult && zonesPreviewPolygons && zonesPreviewPolygons.length > 0 ? (
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
            {pageMode === "waste" && (
              <View style={[styles.sidebarTabs, { borderBottomColor: colors.border }]}>
                <Pressable
                  onPress={() => { hapticImpact(); setSidebarTab("mapping"); }}
                  style={[styles.sidebarTab, sidebarTab === "mapping" && { borderBottomColor: colors.primary }]}
                >
                  <Text style={[styles.sidebarTabLabel, { color: sidebarTab === "mapping" ? colors.primary : colors.muted }]}>
                    Waste Mapping
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => { hapticImpact(); setSidebarTab("zones"); }}
                  style={[styles.sidebarTab, sidebarTab === "zones" && { borderBottomColor: colors.primary }]}
                >
                  <Text style={[styles.sidebarTabLabel, { color: sidebarTab === "zones" ? colors.primary : colors.muted }]}>
                    Zones List
                  </Text>
                </Pressable>
              </View>
            )}
            <ScrollView
              style={styles.sidebarScroll}
              contentContainerStyle={styles.sidebarContent}
              showsVerticalScrollIndicator
            >
              {pageMode === "waste" && sidebarTab === "mapping" ? (
                <>
                  <Text style={[styles.sidebarSectionTitle, { color: colors.muted }]}>
                    {wastePoints.filter((p) => p.type === "bin").length} bins, {wastePoints.filter((p) => p.type === "dumpster").length} dumpsters mapped
                  </Text>
                  <Text style={[styles.sidebarSectionTitle, { color: colors.muted, marginTop: 8 }]}>
                    Partition settings
                  </Text>
                  <View style={[styles.statsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.statsRow, { color: colors.text }]}>Trucks (zones)</Text>
                    <TextInput
                      value={wasteTruckCount}
                      onChangeText={setWasteTruckCount}
                      keyboardType="number-pad"
                      style={[styles.wasteInput, { borderColor: colors.border, color: colors.text }]}
                      placeholder="2"
                      placeholderTextColor={colors.muted}
                    />
                    <Text style={[styles.statsRow, { color: colors.text, marginTop: 8 }]}>Balance by</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {(["count", "weight", "distance"] as const).map((m) => (
                        <TouchableOpacity
                          key={m}
                          onPress={() => setWasteBalanceMetric(m)}
                          style={[styles.presetChip, { backgroundColor: wasteBalanceMetric === m ? colors.primary : colors.background, borderColor: colors.border }]}
                        >
                          <Text style={{ color: wasteBalanceMetric === m ? "#fff" : colors.text, fontSize: 12 }}>
                            {m === "count" ? "Count" : m === "weight" ? "Volume" : "Distance"}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={[styles.statsRow, { color: colors.muted, marginTop: 8 }]}>KNN neighbors: {wasteKnnNeighbors}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>1</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", gap: 4 }}>
                          {[1, 3, 5, 8, 10, 15, 20].map((k) => (
                            <TouchableOpacity
                              key={k}
                              onPress={() => setWasteKnnNeighbors(k)}
                              style={[styles.presetChip, { backgroundColor: wasteKnnNeighbors === k ? colors.primary : colors.background, borderColor: colors.border }]}
                            >
                              <Text style={{ color: wasteKnnNeighbors === k ? "#fff" : colors.text, fontSize: 12 }}>{k}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>20</Text>
                    </View>
                    <TextInput
                      value={wasteZoneName}
                      onChangeText={setWasteZoneName}
                      style={[styles.wasteInput, { borderColor: colors.border, color: colors.text, marginTop: 8 }]}
                      placeholder="Zone name (optional)"
                      placeholderTextColor={colors.muted}
                    />
                  </View>
                  <Text style={[styles.sidebarSectionTitle, { color: colors.muted, marginTop: 16 }]}>
                    Mapped points
                  </Text>
                  {wastePoints.length === 0 ? (
                    <Text style={[styles.emptySidebarText, { color: colors.muted }]}>
                      No bins or dumpsters yet. Tap Add in the toolbar or Import CSV/GeoJSON.
                    </Text>
                  ) : (
                    wastePoints.slice(0, 50).map((p) => (
                      <View key={p.id} style={[styles.resultRow, { borderColor: colors.border, marginBottom: 6 }]}>
                        <MaterialCommunityIcons
                          name={p.type === "bin" ? "delete-outline" : "dump-truck"}
                          size={18}
                          color={p.type === "bin" ? "#22c55e" : "#3b82f6"}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.resultRowName, { color: colors.text }]} numberOfLines={1}>
                            {p.address || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`}
                          </Text>
                          <Text style={[styles.resultRowMeta, { color: colors.muted }]}>
                            {p.capacityLiters != null ? `${p.capacityLiters}L` : ""} {p.condition ?? ""}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => { hapticImpact(); setEditingWastePoint(p); setAddWasteModalVisible(true); }}
                          style={{ padding: 6 }}
                        >
                          <MaterialCommunityIcons name="pencil" size={18} color={colors.muted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            hapticImpact();
                            Alert.alert("Remove point", "Remove this bin/dumpster from the map?", [
                              { text: "Cancel", style: "cancel" },
                              { text: "Remove", style: "destructive", onPress: () => removeWastePoint(p.id) },
                            ]);
                          }}
                          style={{ padding: 6 }}
                        >
                          <MaterialCommunityIcons name="delete-outline" size={18} color={colors.muted} />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                  {wastePoints.length > 50 && (
                    <Text style={[styles.emptySidebarText, { color: colors.muted, marginTop: 8 }]}>
                      … and {wastePoints.length - 50} more
                    </Text>
                  )}
                </>
              ) : pageMode === "waste" && sidebarTab === "zones" ? (
                <>
                  {savedZones.length > 0 ? (
                    <>
                      <Text style={[styles.sidebarSectionTitle, { color: colors.muted }]}>Saved results</Text>
                      {savedZones.map((item) => {
                        const isSelected = item.id === selectedId;
                        return (
                          <Pressable
                            key={item.id}
                            onPress={() => selectResult(item.id)}
                            style={[styles.resultRow, { backgroundColor: isSelected ? colors.primary + "20" : "transparent", borderColor: colors.border }]}
                          >
                            <Text style={[styles.resultRowName, { color: isSelected ? colors.primary : colors.text }]} numberOfLines={1}>
                              {item.name || "Unnamed"}
                            </Text>
                            <Text style={[styles.resultRowMeta, { color: colors.muted }]}>{item.zones.length} zones</Text>
                          </Pressable>
                        );
                      })}
                      {selectedResult && (
                        <>
                          <Text style={[styles.sidebarSectionTitle, { color: colors.muted, marginTop: 16 }]}>{selectedResult.name || "Unnamed zones"}</Text>
                          <View style={[styles.statsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                            <Text style={[styles.statsRow, { color: colors.text }]}>Zones: <Text style={{ fontWeight: "600" }}>{selectedResult.zones.length}</Text></Text>
                            <Text style={[styles.statsRow, { color: colors.text }]}>Total time: <Text style={{ fontWeight: "600" }}>{totalTime.toFixed(1)} min</Text></Text>
                            {selectedResult.sourcePoints && selectedResult.sourcePoints.length > 0 && (
                              <Text style={[styles.statsRow, { color: colors.muted }]}>
                                Points: {selectedResult.sourcePoints.length} (capacity per zone in list)
                              </Text>
                            )}
                          </View>
                          <Text style={[styles.sidebarSectionTitle, { color: colors.muted, marginTop: 16 }]}>Zone list</Text>
                          {selectedResult.zones.sort((a, b) => b.estimated_time - a.estimated_time).map((zone, idx) => (
                            <ZoneAccordionItem
                              key={zone.zone_id}
                              zone={zone}
                              index={zone.zone_id}
                              colors={colors}
                              expanded={expandedZoneIds.has(zone.zone_id)}
                              onToggle={() => toggleZoneExpanded(zone.zone_id)}
                              sourcePoints={selectedResult.sourcePoints}
                            />
                          ))}
                        </>
                      )}
                    </>
                  ) : (
                    <Text style={[styles.emptySidebarText, { color: colors.muted }]}>
                      No zone results yet. Map bins/dumpsters, then tap Partition.
                    </Text>
                  )}
                </>
              ) : null}
              {pageMode === "delivery" && (
                <>
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
                          Zones: <Text style={{ fontWeight: "600" }}>{selectedResult.zones.length}</Text>
                        </Text>
                        <Text style={[styles.statsRow, { color: colors.text }]}>
                          Total time: <Text style={{ fontWeight: "600" }}>{totalTime.toFixed(1)} min</Text>
                        </Text>
                        <Text style={[styles.statsRow, { color: colors.text }]}>
                          Avg per zone: <Text style={{ fontWeight: "600" }}>{avgTime.toFixed(1)} min</Text>
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
                            sourcePoints={selectedResult?.sourcePoints}
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
                </>
              )}
            </ScrollView>
          </View>
        )}
      </View>

      <WastePointFormModal
        visible={addWasteModalVisible}
        onClose={handleAddWasteModalClose}
        onSave={handleWastePointSave}
        editingPoint={editingWastePoint}
        initialCoords={pendingWasteCoords}
        onRequestPickOnMap={() => {
          setAddWasteModalVisible(false);
          setPickWasteLocationMode(true);
        }}
      />
      {pickWasteLocationMode && pageMode === "waste" && (
        <View style={[styles.pickHint, { backgroundColor: colors.primary }]} pointerEvents="none">
          <Text style={styles.pickHintText}>Tap on the map to place the bin or dumpster</Text>
        </View>
      )}
      <WasteImportModal
        visible={importWasteModalVisible}
        onClose={() => setImportWasteModalVisible(false)}
        onImport={(rows) => {
          let n = 0;
          rows.forEach((r) => {
            if (r.lat != null && r.lon != null) {
              addWastePoint({
                lat: r.lat,
                lon: r.lon,
                type: r.type,
                capacityLiters: r.capacityLiters,
                condition: r.condition,
                address: r.address,
              });
              n++;
            }
          });
          if (n > 0) Alert.alert("Import complete", `${n} point(s) added to the map.`);
        }}
      />
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
  modeToggle: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  modeToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  modeToggleLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  sidebarTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  sidebarTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  sidebarTabLabel: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  wasteInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  presetChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalBox: {
    minWidth: 280,
    maxWidth: 400,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  pickHint: {
    position: "absolute",
    bottom: 24,
    left: 24,
    right: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: "center",
  },
  pickHintText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
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
    fontWeight: "600",
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
