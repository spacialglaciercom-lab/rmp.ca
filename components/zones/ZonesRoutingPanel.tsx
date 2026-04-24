/**
 * Right-side control panel for the Zones page (waste mode).
 * Zone picker, CSV/GeoJSON import, manual pin drop, points bucket with exclude,
 * TSP optimisation via /api/vrp/solve/sync, stats overlay, and polyline output.
 */
import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { parseWasteFile, type WasteImportRow } from "@/lib/waste-import";
import { readFileAsText } from "@/lib/readFileAsText";
import { getApiBaseUrl } from "@/shared/oauth";
import type { WastePoint } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

/** A pin in the bucket — either from the database or from a local import/drop. */
export interface BucketPin {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  /** Bin/container number — from import file, DB, or auto-generated. */
  binNumber: string;
  /** true when the pin was added via import/manual drop and hasn't been persisted */
  unsaved?: boolean;
}

export interface TspResult {
  orderedPoints: { lat: number; lon: number }[];
  /** Road-snapped geometry from OSRM (follows actual roads). Falls back to orderedPoints. */
  roadGeometry: { lat: number; lon: number }[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  sequenceCount: number;
}

interface ZonesRoutingPanelProps {
  /** Existing waste points from the local store (shown as map markers already) */
  localWastePoints: WastePoint[];
  /** Draft pins added via import or manual pin drop */
  draftPins: BucketPin[];
  /** Called when import adds new draft pins */
  onDraftPinsChange: (pins: BucketPin[]) => void;
  /** Whether manual pin-drop mode is active */
  pinDropMode: boolean;
  onPinDropModeChange: (active: boolean) => void;
  /** Called when TSP finishes — parent passes routePoints to RouteMap */
  onTspResult: (result: TspResult | null) => void;
  /** Called when the selected zone changes so parent can refit map bounds */
  onZonePinsLoaded: (pins: BucketPin[]) => void;
  /** Called when user clicks "Preview on Map" — parent should fit map to route bounds */
  onPreviewRoute?: (points: { lat: number; lon: number }[]) => void;
  /** Called to delete a local waste point by id */
  onDeleteLocalPoint?: (id: string) => void;
  /** Panel collapsed state controlled by parent */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACTION_ORANGE = "#f97316";
const LINK_BLUE = "#3b82f6";

// ── VRP client ───────────────────────────────────────────────────────────────

interface VrpSolveResponse {
  routes: {
    vehicle_id: number;
    steps: {
      type: string;
      id?: number;
      location: { lat: number; lon: number };
      arrival: number;
      duration: number;
      wait: number;
      distance: number;
    }[];
    total_distance: number;
    total_duration: number;
  }[];
  total_distance: number;
  total_duration: number;
  unassigned: number[];
}

/**
 * Fetch road-following geometry from OSRM for a sequence of waypoints.
 * Falls back to straight lines if OSRM is unavailable.
 */
async function fetchRoadGeometry(
  waypoints: { lat: number; lon: number }[],
): Promise<{ lat: number; lon: number }[]> {
  if (waypoints.length < 2) return waypoints;

  try {
    const { getRoutingConfig } = await import("@/lib/routing-config");
    const config = getRoutingConfig();
    const coords = waypoints.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `${config.baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    const res = await fetch(url);
    if (!res.ok) return waypoints;

    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates?.length) {
      return waypoints;
    }

    const coords2 = data.routes[0].geometry.coordinates as [number, number][];
    return coords2.map(([lon, lat]) => ({ lat, lon }));
  } catch (e) {
    console.warn("[TSP] Road geometry fetch failed, using straight lines:", e);
    return waypoints;
  }
}

async function solveTsp(
  pins: BucketPin[],
): Promise<TspResult> {
  if (pins.length < 2) {
    throw new Error("Need at least 2 points to optimise");
  }

  const depot = pins[0];
  const stops = pins.slice(1).map((p, i) => ({
    id: i + 1,
    location: { lat: p.lat, lon: p.lon },
    demand: [0],
    service_duration: 0,
  }));

  const vehicles = [
    {
      id: 0,
      start_location: { lat: depot.lat, lon: depot.lon },
      end_location: { lat: depot.lat, lon: depot.lon },
      capacity: [999999],
    },
  ];

  const base = getApiBaseUrl();
  const url = `${base.replace(/\/$/, "")}/api/vrp/solve`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      stops,
      vehicles,
      use_time_windows: false,
      objective: "min_distance",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`VRP solver returned ${res.status}: ${text}`);
  }

  const data: VrpSolveResponse = await res.json();

  const route = data.routes[0];
  if (!route) {
    throw new Error("Solver returned no routes");
  }

  const jobSteps = route.steps.filter((s) => s.type === "job");
  const orderedPoints = [
    { lat: depot.lat, lon: depot.lon },
    ...jobSteps.map((s) => ({ lat: s.location.lat, lon: s.location.lon })),
    { lat: depot.lat, lon: depot.lon },
  ];

  const roadGeometry = await fetchRoadGeometry(orderedPoints);

  return {
    orderedPoints,
    roadGeometry,
    totalDistanceMeters: data.total_distance,
    totalDurationSeconds: data.total_duration,
    sequenceCount: jobSteps.length + 1,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ZonesRoutingPanel({
  localWastePoints,
  draftPins,
  onDraftPinsChange,
  pinDropMode,
  onPinDropModeChange,
  onTspResult,
  onZonePinsLoaded,
  onPreviewRoute,
  onDeleteLocalPoint,
  collapsed,
  onCollapsedChange,
}: ZonesRoutingPanelProps) {
  const colors = useColors();

  // ── Zone selector ──────────────────────────────────────────────────────────
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [zoneSearch, setZoneSearch] = useState("");
  const [pointsFilter, setPointsFilter] = useState("");

  const zonesQuery = trpc.logisticsZones.listZones.useQuery(undefined, {
    staleTime: 60_000,
  });
  const filteredZones = useMemo(() => {
    const all = zonesQuery.data?.zones ?? [];
    const q = zoneSearch.trim().toLowerCase();
    return q ? all.filter((z) => z.name.toLowerCase().includes(q)) : all;
  }, [zonesQuery.data, zoneSearch]);

  const pinsQuery = trpc.logisticsZones.listWastePointsInZone.useQuery(
    { zoneId: selectedZoneId! },
    { enabled: !!selectedZoneId, staleTime: 30_000 },
  );

  // ── Merged bucket ──────────────────────────────────────────────────────────
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const dbPins: BucketPin[] = useMemo(() => {
    if (!pinsQuery.data?.points) return [];
    return pinsQuery.data.points.map((p, i) => ({
      id: p.id,
      lat: p.latitude,
      lon: p.longitude,
      label: p.locationName ?? p.address ?? undefined,
      binNumber: p.binNumber || `BIN-${String(i + 1).padStart(3, "0")}`,
    }));
  }, [pinsQuery.data]);

  const localPins: BucketPin[] = useMemo(() => {
    if (selectedZoneId) return [];
    return localWastePoints.map((p, i) => ({
      id: p.id,
      lat: p.lat,
      lon: p.lon,
      label: p.address ?? undefined,
      binNumber: `BIN-${String(i + 1).padStart(3, "0")}`,
    }));
  }, [localWastePoints, selectedZoneId]);

  const allPins = useMemo(
    () => [...dbPins, ...localPins, ...draftPins],
    [dbPins, localPins, draftPins],
  );

  const activePins = useMemo(
    () => allPins.filter((p) => !excludedIds.has(p.id)),
    [allPins, excludedIds],
  );

  // ── Draft pin helper (appends to parent-managed array) ──────────────────
  const draftIdCounter = useRef(0);

  const nextBinNumber = useCallback(
    (existing?: string): string => {
      if (existing) return existing;
      const allNums = allPins
        .map((p) => {
          const m = p.binNumber.match(/(\d+)$/);
          return m ? parseInt(m[1], 10) : 0;
        });
      const max = allNums.length > 0 ? Math.max(...allNums) : 0;
      return `BIN-${String(max + 1).padStart(3, "0")}`;
    },
    [allPins],
  );

  const addDraftPin = useCallback(
    (lat: number, lon: number, binNumber?: string) => {
      draftIdCounter.current += 1;
      const pin: BucketPin = {
        id: `draft_${Date.now()}_${draftIdCounter.current}`,
        lat,
        lon,
        binNumber: nextBinNumber(binNumber),
        unsaved: true,
      };
      onDraftPinsChange([...draftPins, pin]);
    },
    [draftPins, onDraftPinsChange, nextBinNumber],
  );

  // Notify parent when DB pins load
  React.useEffect(() => {
    if (dbPins.length > 0) onZonePinsLoaded(dbPins);
  }, [dbPins, onZonePinsLoaded]);

  const toggleExclude = useCallback((id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Undo stack ────────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<
    { pin: BucketPin; source: "draft" | "local" }[]
  >([]);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushUndo = useCallback(
    (pin: BucketPin, source: "draft" | "local") => {
      setUndoStack((prev) => [...prev.slice(-9), { pin, source }]);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoStack([]), 8000);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.source === "draft") {
        onDraftPinsChange([...draftPins, last.pin]);
      }
      return prev.slice(0, -1);
    });
  }, [draftPins, onDraftPinsChange]);

  // ── Delete handlers ───────────────────────────────────────────────────────
  const handleDeletePin = useCallback(
    (pin: BucketPin) => {
      if (pin.unsaved || pin.id.startsWith("draft_")) {
        pushUndo(pin, "draft");
        onDraftPinsChange(draftPins.filter((p) => p.id !== pin.id));
      } else {
        const isLocal = localPins.some((p) => p.id === pin.id);
        if (isLocal) {
          pushUndo(pin, "local");
          onDeleteLocalPoint?.(pin.id);
        }
      }
      setExcludedIds((prev) => {
        const next = new Set(prev);
        next.delete(pin.id);
        return next;
      });
    },
    [draftPins, localPins, onDraftPinsChange, onDeleteLocalPoint, pushUndo],
  );

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const handleClearAll = useCallback(() => {
    onDraftPinsChange([]);
    setExcludedIds(new Set());
    onTspResult(null);
  }, [onDraftPinsChange, onTspResult]);

  const handleHideAll = useCallback(() => {
    setExcludedIds(new Set(allPins.map((p) => p.id)));
  }, [allPins]);

  const handleShowAll = useCallback(() => {
    setExcludedIds(new Set());
  }, []);

  const allHidden = allPins.length > 0 && excludedIds.size === allPins.length;

  // ── Filtered pins for display ─────────────────────────────────────────────
  const displayPins = useMemo(() => {
    const q = pointsFilter.trim().toLowerCase();
    if (!q) return allPins;
    return allPins.filter(
      (p) =>
        p.binNumber.toLowerCase().includes(q) ||
        p.label?.toLowerCase().includes(q) ||
        `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`.includes(q),
    );
  }, [allPins, pointsFilter]);

  // ── Zone selection handler ─────────────────────────────────────────────────
  const handleSelectZone = useCallback(
    (id: string) => {
      setSelectedZoneId(id);
      setExcludedIds(new Set());
      onDraftPinsChange([]);
      onTspResult(null);
    },
    [onTspResult, onDraftPinsChange],
  );

  const handleClearZone = useCallback(() => {
    setSelectedZoneId(null);
    setExcludedIds(new Set());
    onDraftPinsChange([]);
    onTspResult(null);
  }, [onTspResult, onDraftPinsChange]);

  // ── CSV / GeoJSON import ───────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "application/csv",
          "application/geo+json",
          "application/json",
          "text/plain",
          "*/*",
        ],
        copyToCacheDirectory: Platform.OS !== "web",
      });
      if (result.canceled) {
        setImporting(false);
        return;
      }
      const file = result.assets[0];
      let text: string;
      if (Platform.OS === "web") {
        const webFile = (file as { file?: File }).file;
        if (webFile) {
          text = await readFileAsText(webFile);
        } else if (file.uri.startsWith("data:")) {
          const b64 = file.uri.split(",")[1];
          text = atob(b64);
        } else {
          const resp = await fetch(file.uri);
          const blob = await resp.blob();
          text = await readFileAsText(blob);
        }
      } else {
        text = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const rows: WasteImportRow[] = parseWasteFile(text, file.name || "file");
      let added = 0;
      for (const r of rows) {
        if (r.lat != null && r.lon != null) {
          addDraftPin(r.lat, r.lon, r.binNumber);
          added++;
        }
      }
      if (added === 0) {
        Alert.alert("Import", "No valid points found in file.");
      } else {
        Alert.alert("Import", `${added} unsaved point(s) added.`);
      }
    } catch (err) {
      Alert.alert("Import error", String(err));
    } finally {
      setImporting(false);
    }
  }, [addDraftPin]);

  // ── TSP ────────────────────────────────────────────────────────────────────
  const [tspLoading, setTspLoading] = useState(false);
  const [tspResult, setTspResult] = useState<TspResult | null>(null);
  const [tspError, setTspError] = useState<string | null>(null);

  const handleRunTsp = useCallback(async () => {
    if (activePins.length < 2) {
      Alert.alert(
        "Not enough points",
        "Include at least 2 active pins to run TSP.",
      );
      return;
    }
    setTspLoading(true);
    setTspError(null);
    setTspResult(null);
    onTspResult(null);
    try {
      const result = await solveTsp(activePins);
      setTspResult(result);
      onTspResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTspError(msg);
    } finally {
      setTspLoading(false);
    }
  }, [activePins, onTspResult]);

  // ── Auto-recalc TSP when active pins change after a solve ──────────────────
  const prevActivePinsRef = useRef<string | null>(null);
  React.useEffect(() => {
    if (!tspResult) return;
    const key = activePins.map((p) => p.id).sort().join(",");
    if (prevActivePinsRef.current === null) {
      prevActivePinsRef.current = key;
      return;
    }
    if (prevActivePinsRef.current !== key && activePins.length >= 2) {
      prevActivePinsRef.current = key;
      setTspResult(null);
      onTspResult(null);
    } else if (activePins.length < 2) {
      prevActivePinsRef.current = key;
      setTspResult(null);
      onTspResult(null);
    }
  }, [activePins, tspResult, onTspResult]);

  // ── Preview / Download handlers ────────────────────────────────────────────

  const handlePreviewOnMap = useCallback(() => {
    if (!tspResult?.orderedPoints?.length) return;
    onPreviewRoute?.(tspResult.orderedPoints);
  }, [tspResult, onPreviewRoute]);

  const handleDownloadGpx = useCallback(() => {
    if (!tspResult?.orderedPoints?.length) return;
    const roadPts = tspResult.roadGeometry ?? tspResult.orderedPoints;
    const ts = new Date().toISOString();
    const trkpts = roadPts
      .map(
        (p) =>
          `      <trkpt lat="${p.lat}" lon="${p.lon}"><time>${ts}</time></trkpt>`,
      )
      .join("\n");
    const wpts = activePins
      .map(
        (p, i) =>
          `  <wpt lat="${p.lat}" lon="${p.lon}"><name>${escapeXml(`#${i + 1} ${p.binNumber}`)}</name>${p.label ? `<desc>${escapeXml(p.label)}</desc>` : ""}</wpt>`,
      )
      .join("\n");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteMasterPro"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>TSP Optimized Route</name>
    <time>${ts}</time>
    <desc>${(tspResult.totalDistanceMeters / 1000).toFixed(2)} km – ${tspResult.sequenceCount} stops</desc>
  </metadata>
${wpts}
  <trk>
    <name>TSP Optimized Route</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;

    triggerBrowserDownload(gpx, `tsp_route_${Date.now()}.gpx`, "application/gpx+xml");
  }, [tspResult, activePins]);

  const handleDownloadCsv = useCallback(() => {
    if (!tspResult?.orderedPoints?.length) return;
    const ordered = tspResult.orderedPoints;
    const lines: string[] = [
      "sequence,latitude,longitude,bin_number,label",
    ];
    ordered.forEach((pt, idx) => {
      const match = activePins.find(
        (p) =>
          Math.abs(p.lat - pt.lat) < 0.00001 &&
          Math.abs(p.lon - pt.lon) < 0.00001,
      );
      lines.push(
        [
          idx + 1,
          pt.lat.toFixed(6),
          pt.lon.toFixed(6),
          csvEscape(match?.binNumber ?? ""),
          csvEscape(match?.label ?? ""),
        ].join(","),
      );
    });
    const csv = lines.join("\n");
    triggerBrowserDownload(csv, `tsp_route_${Date.now()}.csv`, "text/csv");
  }, [tspResult, activePins]);

  // ── Empty state ────────────────────────────────────────────────────────────
  const isEmpty = allPins.length === 0 && !selectedZoneId;

  // ── Collapse toggle (thin rail when collapsed) ─────────────────────────────
  if (collapsed) {
    return (
      <TouchableOpacity
        onPress={() => onCollapsedChange(false)}
        style={[
          styles.collapsedRail,
          { backgroundColor: colors.surface, borderLeftColor: colors.border },
        ]}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons
          name="chevron-left"
          size={20}
          color={colors.muted}
        />
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={[
        styles.panel,
        {
          borderLeftColor: colors.border,
          backgroundColor:
            Platform.OS === "web" ? "rgba(15,23,42,0.72)" : colors.surface,
        },
        Platform.OS === "web" && {
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        } as any,
      ]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons
            name="routes"
            size={18}
            color={ACTION_ORANGE}
          />
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            TSP Routing
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => onCollapsedChange(true)}
          hitSlop={8}
        >
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={colors.muted}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {/* ── Zone Selector ──────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>
          Zone
        </Text>
        <TextInput
          style={[
            styles.searchInput,
            {
              borderColor: colors.border,
              color: colors.text,
              backgroundColor: colors.background + "80",
            },
          ]}
          placeholder="Search zones..."
          placeholderTextColor={colors.muted}
          value={zoneSearch}
          onChangeText={setZoneSearch}
        />
        {filteredZones.length > 0 ? (
          <View style={styles.zoneList}>
            {filteredZones.slice(0, 20).map((z) => {
              const isActive = z.id === selectedZoneId;
              return (
                <TouchableOpacity
                  key={z.id}
                  onPress={() =>
                    isActive ? handleClearZone() : handleSelectZone(z.id)
                  }
                  style={[
                    styles.zoneRow,
                    {
                      backgroundColor: isActive
                        ? ACTION_ORANGE + "20"
                        : "transparent",
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.zoneSwatch,
                      { backgroundColor: z.color || colors.muted },
                    ]}
                  />
                  <Text
                    style={[
                      styles.zoneRowName,
                      { color: isActive ? ACTION_ORANGE : colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {z.name}
                  </Text>
                  {isActive && (
                    <MaterialCommunityIcons
                      name="check"
                      size={16}
                      color={ACTION_ORANGE}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : zonesQuery.isLoading ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : (
          <Text style={[styles.hint, { color: colors.muted }]}>
            {zonesQuery.isError
              ? "Could not load zones"
              : "No zones found"}
          </Text>
        )}

        {/* ── Import / Add ───────────────────────────────────────────────── */}
        <Text
          style={[styles.sectionTitle, { color: colors.muted, marginTop: 16 }]}
        >
          Import / Add
        </Text>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: LINK_BLUE }]}
          onPress={handleImport}
          disabled={importing}
          activeOpacity={0.7}
        >
          {importing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialCommunityIcons
              name="file-upload-outline"
              size={18}
              color="#fff"
            />
          )}
          <Text style={styles.actionBtnLabel}>Upload CSV / GeoJSON</Text>
        </TouchableOpacity>

        <View style={styles.pinDropRow}>
          <MaterialCommunityIcons
            name="map-marker-plus-outline"
            size={18}
            color={pinDropMode ? ACTION_ORANGE : colors.muted}
          />
          <Text style={[styles.pinDropLabel, { color: colors.text }]}>
            Manual Pin Drop
          </Text>
          <Switch
            value={pinDropMode}
            onValueChange={onPinDropModeChange}
            trackColor={{ false: colors.border, true: ACTION_ORANGE + "80" }}
            thumbColor={pinDropMode ? ACTION_ORANGE : colors.muted}
          />
        </View>

        {/* ── Points Bucket ──────────────────────────────────────────────── */}
        <View style={styles.pointsHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.muted, marginTop: 0, marginBottom: 0 }]}>
            Points ({activePins.length}/{allPins.length})
          </Text>
          {allPins.length > 0 && (
            <View style={styles.bulkActions}>
              <TouchableOpacity
                onPress={allHidden ? handleShowAll : handleHideAll}
                hitSlop={6}
                style={styles.bulkBtn}
              >
                <MaterialCommunityIcons
                  name={allHidden ? "eye-outline" : "eye-off-outline"}
                  size={15}
                  color={colors.muted}
                />
              </TouchableOpacity>
              {draftPins.length > 0 && (
                <TouchableOpacity
                  onPress={handleClearAll}
                  hitSlop={6}
                  style={styles.bulkBtn}
                >
                  <MaterialCommunityIcons
                    name="delete-sweep-outline"
                    size={15}
                    color="#ef4444"
                  />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {allPins.length > 5 && (
          <TextInput
            style={[
              styles.searchInput,
              {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.background + "80",
                marginTop: 6,
              },
            ]}
            placeholder="Filter points..."
            placeholderTextColor={colors.muted}
            value={pointsFilter}
            onChangeText={setPointsFilter}
          />
        )}

        {isEmpty ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="map-marker-question-outline"
              size={32}
              color={colors.muted}
            />
            <Text style={[styles.emptyStateText, { color: colors.muted }]}>
              Drop a file here or select a zone to start routing.
            </Text>
          </View>
        ) : (
          <View style={styles.bucketList}>
            {displayPins.map((pin) => {
              const excluded = excludedIds.has(pin.id);
              const isDeletable =
                pin.unsaved || pin.id.startsWith("draft_") ||
                localPins.some((p) => p.id === pin.id);
              return (
                <View
                  key={pin.id}
                  style={[
                    styles.bucketItem,
                    {
                      borderColor: colors.border,
                      opacity: excluded ? 0.45 : 1,
                    },
                  ]}
                >
                  <View style={styles.bucketItemInfo}>
                    <View style={styles.bucketItemHeader}>
                      <Text
                        style={[
                          styles.bucketItemBinNum,
                          { color: ACTION_ORANGE },
                        ]}
                        numberOfLines={1}
                      >
                        #{pin.binNumber}
                      </Text>
                      {pin.unsaved && (
                        <View style={styles.unsavedBadge}>
                          <Text style={styles.unsavedBadgeText}>NEW</Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[styles.bucketItemCoords, { color: colors.muted }]}
                      numberOfLines={1}
                    >
                      {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}
                    </Text>
                    {pin.label && (
                      <Text
                        style={[
                          styles.bucketItemLabel,
                          { color: colors.muted },
                        ]}
                        numberOfLines={1}
                      >
                        {pin.label}
                      </Text>
                    )}
                  </View>
                  <View style={styles.bucketItemActions}>
                    {isDeletable && (
                      <TouchableOpacity
                        onPress={() => handleDeletePin(pin)}
                        hitSlop={6}
                        style={styles.deleteBtn}
                      >
                        <MaterialCommunityIcons
                          name="trash-can-outline"
                          size={16}
                          color="#ef4444"
                        />
                      </TouchableOpacity>
                    )}
                    <Switch
                      value={!excluded}
                      onValueChange={() => toggleExclude(pin.id)}
                      trackColor={{
                        false: colors.border,
                        true: ACTION_ORANGE + "80",
                      }}
                      thumbColor={excluded ? colors.muted : ACTION_ORANGE}
                      style={styles.bucketSwitch}
                    />
                  </View>
                </View>
              );
            })}
            {pointsFilter && displayPins.length === 0 && (
              <Text style={[styles.hint, { color: colors.muted, marginTop: 8 }]}>
                No points match "{pointsFilter}"
              </Text>
            )}
          </View>
        )}

        {/* ── Undo snackbar ──────────────────────────────────────────────── */}
        {undoStack.length > 0 && (
          <TouchableOpacity
            onPress={handleUndo}
            style={styles.undoBar}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="undo" size={16} color="#fff" />
            <Text style={styles.undoBarText}>
              Point deleted — tap to undo
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Run TSP ────────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[
            styles.tspBtn,
            {
              backgroundColor: ACTION_ORANGE,
              opacity: activePins.length < 2 ? 0.5 : 1,
            },
          ]}
          onPress={handleRunTsp}
          disabled={tspLoading || activePins.length < 2}
          activeOpacity={0.8}
        >
          {tspLoading ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.tspBtnLabel}>
                Calculating Optimized Path...
              </Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons
                name="swap-horizontal-bold"
                size={18}
                color="#fff"
              />
              <Text style={styles.tspBtnLabel}>Run TSP Optimization</Text>
            </>
          )}
        </TouchableOpacity>

        {tspError && (
          <Text style={[styles.errorText, { color: "#ef4444" }]}>
            {tspError}
          </Text>
        )}

        {/* ── Stats Overlay ──────────────────────────────────────────────── */}
        {tspResult && (
          <View
            style={[
              styles.statsCard,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statsSectionTitle, { color: ACTION_ORANGE }]}>
              Optimized Route
            </Text>
            <View style={styles.statsRow}>
              <MaterialCommunityIcons
                name="map-marker-distance"
                size={16}
                color={colors.muted}
              />
              <Text style={[styles.statsLabel, { color: colors.muted }]}>
                Total Distance
              </Text>
              <Text style={[styles.statsValue, { color: colors.text }]}>
                {(tspResult.totalDistanceMeters / 1000).toFixed(2)} km
              </Text>
            </View>
            <View style={styles.statsRow}>
              <MaterialCommunityIcons
                name="clock-outline"
                size={16}
                color={colors.muted}
              />
              <Text style={[styles.statsLabel, { color: colors.muted }]}>
                Estimated Time
              </Text>
              <Text style={[styles.statsValue, { color: colors.text }]}>
                {Math.ceil(tspResult.totalDurationSeconds / 60)} min
              </Text>
            </View>
            <View style={styles.statsRow}>
              <MaterialCommunityIcons
                name="counter"
                size={16}
                color={colors.muted}
              />
              <Text style={[styles.statsLabel, { color: colors.muted }]}>
                Sequence Count
              </Text>
              <Text style={[styles.statsValue, { color: colors.text }]}>
                {tspResult.sequenceCount} stops
              </Text>
            </View>
            <Text style={[styles.statsHint, { color: colors.muted }]}>
              Route starts and ends at the first listed stop.
            </Text>

            {/* ── Action buttons ──────────────────────────────────────── */}
            <View style={styles.statsActions}>
              <TouchableOpacity
                style={[styles.statsActionBtn, { backgroundColor: LINK_BLUE }]}
                onPress={handlePreviewOnMap}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="map-search" size={16} color="#fff" />
                <Text style={styles.statsActionLabel}>Preview</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.statsActionBtn, { backgroundColor: "#22c55e" }]}
                onPress={handleDownloadGpx}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="download" size={16} color="#fff" />
                <Text style={styles.statsActionLabel}>GPX</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.statsActionBtn, { backgroundColor: "#8b5cf6" }]}
                onPress={handleDownloadCsv}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="file-delimited-outline" size={16} color="#fff" />
                <Text style={styles.statsActionLabel}>CSV</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function triggerBrowserDownload(content: string, filename: string, mimeType: string) {
  if (Platform.OS === "web") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } else {
    Alert.alert("Download", `${filename} download is available on web.`);
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const PANEL_WIDTH = 340;

const styles = StyleSheet.create({
  panel: {
    width: PANEL_WIDTH,
    borderLeftWidth: 1,
    flexDirection: "column",
    alignSelf: "stretch",
  },
  collapsedRail: {
    width: 28,
    borderLeftWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    padding: 14,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
    fontWeight: "600",
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    marginBottom: 8,
  },
  zoneList: {
    gap: 4,
    marginBottom: 4,
  },
  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    gap: 8,
  },
  zoneSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  zoneRowName: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  hint: {
    fontSize: 12,
    marginBottom: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 10,
  },
  actionBtnLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  pinDropRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  pinDropLabel: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  emptyStateText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 260,
  },
  pointsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 6,
  },
  bulkActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bulkBtn: {
    padding: 2,
  },
  bucketList: {
    gap: 4,
  },
  bucketItem: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  bucketItemInfo: {
    flex: 1,
    gap: 2,
  },
  bucketItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bucketItemBinNum: {
    fontSize: 13,
    fontWeight: "700",
  },
  unsavedBadge: {
    alignSelf: "flex-start",
    backgroundColor: ACTION_ORANGE + "30",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginBottom: 2,
  },
  unsavedBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: ACTION_ORANGE,
    letterSpacing: 0.5,
  },
  bucketItemCoords: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  bucketItemLabel: {
    fontSize: 11,
  },
  bucketItemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  deleteBtn: {
    padding: 4,
  },
  bucketSwitch: {
    marginLeft: 2,
    transform: [{ scale: 0.75 }],
  },
  undoBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#334155",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginTop: 8,
  },
  undoBarText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  tspBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 16,
  },
  tspBtnLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    fontSize: 12,
    marginTop: 6,
  },
  statsCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  statsSectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statsLabel: {
    fontSize: 12,
    flex: 1,
  },
  statsValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  statsHint: {
    fontSize: 10,
    marginTop: 4,
    fontStyle: "italic",
  },
  statsActions: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  statsActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 6,
  },
  statsActionLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
