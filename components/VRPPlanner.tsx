import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  ScrollView,
  Platform,
  Keyboard,
  Modal,
  Pressable,
  InteractionManager,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import {
  impactAsync as hapticImpact,
  ImpactFeedbackStyle,
} from "@/lib/safe-haptics";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import {
  routeThroughWaypoints,
  buildOfflineMatchedRoute,
} from "@/lib/mapMatching";
import { getRoutingConfigAsync } from "@/lib/routing-config";
import { getRouteOptionsForRouting } from "@/stores/routeParametersStore";
import { storage } from "@/lib/storage";
import { generateRouteId } from "@/lib/utils";
import type { Route, CollectionPoint } from "@/types";
import instructionManager from "@/services/InstructionManager";
import { useDeliveryInstructions } from "@/context/DeliveryInstructionsContext";
import {
  getSolver,
  ALGORITHM_OPTIONS as VRP_ALGORITHM_OPTIONS,
  buildHaversineMatrix,
  getValhallaMatrix,
} from "@/lib/vrp-solvers";

type InputMode = "coordinates" | "address";

const OBJECTIVE_OPTIONS = [
  { value: "min_time", label: "Minimize total time" },
  { value: "min_distance", label: "Minimize total distance" },
  { value: "balance_load", label: "Balance load evenly" },
  { value: "min_vehicles", label: "Minimize vehicles used" },
] as const;

const ALGORITHM_OPTIONS = VRP_ALGORITHM_OPTIONS;

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const nl = "\n";

interface VRPStop {
  lat: number;
  lon: number;
  label: string;
  /** Per-stop demand (units/kg). Parsed from 4th column of coordinates input. */
  demand?: number;
  /** Estimated arrival time at this stop (Unix epoch seconds). VROOM only. */
  arrivalTime?: number;
}

interface VRPRouteStats {
  /** Total distance for this route in metres. */
  distance: number;
  /** Total driving + service duration for this route in seconds. */
  duration: number;
}

interface VRPResult {
  /** Flattened list of all stops in order (for preview/export). */
  stops: VRPStop[];
  /** When present, one route per vehicle (separate lists for UI). */
  routes?: VRPStop[][];
  totalDistance: string;
  totalTime: number;
  /** Per-route stats (distance m, duration s). VROOM only. */
  routeStats?: VRPRouteStats[];
  /** Stops that could not be assigned (capacity / time-window infeasible). VROOM only. */
  unassigned?: string[];
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
}

function parseCoordinates(text: string): VRPStop[] {
  const lines = text.trim().split("\n");
  const locations: VRPStop[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      const label = parts[2] ?? `Stop ${locations.length + 1}`;
      const demandRaw = parts[3] !== undefined ? parseFloat(parts[3]) : NaN;
      const demand = Number.isFinite(demandRaw) ? demandRaw : undefined;
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        locations.push({ lat, lon, label, demand });
      }
    }
  }
  return locations;
}

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query.trim(),
    format: "json",
    limit: "10",
  });
  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RouteMasterPro/1.0 (route planning app)",
    },
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = (await response.json()) as NominatimResult[];
  return Array.isArray(data) ? data : [];
}

/** Nominatim allows 1 request per second. Delay between batch geocode calls. */
const NOMINATIM_DELAY_MS = 1100;

/**
 * Geocode a list of addresses (one per line) via Nominatim.
 * Respects 1 req/s; returns VRPStop[] for each address that resolved (skips failures).
 */
async function geocodeAddressesBatch(
  addressLines: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<VRPStop[]> {
  const trimmed = addressLines.map((l) => l.trim()).filter(Boolean);
  const stops: VRPStop[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    onProgress?.(i + 1, trimmed.length);
    try {
      const results = await searchNominatim(trimmed[i]);
      const first = results[0];
      if (first) {
        const lat = parseFloat(first.lat);
        const lon = parseFloat(first.lon);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          const label =
            first.display_name.split(",").slice(0, 2).join(",").trim() ||
            `Stop ${stops.length + 1}`;
          stops.push({ lat, lon, label });
        }
      }
    } catch {
      // Skip failed; caller can see count vs input length
    }
    if (i < trimmed.length - 1) {
      await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS));
    }
  }
  return stops;
}


export interface VRPConfig {
  vehicles: number;
  capacity: number;
  maxRouteTimeHours: number;
  depotAddress: string;
  travelSpeedFactor: number;
  objective: (typeof OBJECTIVE_OPTIONS)[number]["value"];
  algorithm: string;
}


export interface VRPPlannerProps {
  /** When true, render content in a View instead of ScrollView. Use on native when VRPPlanner is inside another ScrollView/FlatList to avoid nested scroll issues. */
  nestedInScrollView?: boolean;
}

const DEFAULT_VRP_CONFIG: VRPConfig = {
  vehicles: 2,
  capacity: 1000,
  maxRouteTimeHours: 8,
  depotAddress: "",
  travelSpeedFactor: 1,
  objective: "min_time",
  algorithm: "clarke_wright",
};

/** Delivery instructions card: load from one JSON file; list is auto-matched to route stops by address. */
function DeliveryInstructionsCard({
  fillScreen = false,
}: {
  fillScreen?: boolean;
}) {
  const colors = useColors();
  const { instructions, loadFromFile, loadError, clearLoadError } =
    useDeliveryInstructions();
  return (
    <View
      style={[
        styles.card,
        fillScreen && styles.cardFill,
        { backgroundColor: colors.surface },
      ]}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>
        Delivery Instructions
      </Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>
        {instructions.length} instruction{instructions.length !== 1 ? "s" : ""}{" "}
        loaded. Auto-matched to route stops by address during export.
      </Text>
      <TouchableOpacity
        style={[
          styles.runButton,
          {
            backgroundColor: colors.primary,
            marginTop: 8,
            alignSelf: "flex-start",
          },
        ]}
        onPress={loadFromFile}
        activeOpacity={0.8}
      >
        <Text style={styles.runButtonText}>Load from JSON file</Text>
      </TouchableOpacity>
      {loadError ? (
        <TouchableOpacity
          onPress={clearLoadError}
          style={{
            marginTop: 8,
            paddingVertical: 6,
            paddingHorizontal: 8,
            backgroundColor: colors.error + "30",
            borderRadius: 8,
          }}
        >
          <Text style={[styles.helperText, { color: colors.error }]}>
            {loadError}
          </Text>
          <Text
            style={[styles.helperText, { color: colors.muted, marginTop: 2 }]}
          >
            Tap to dismiss
          </Text>
        </TouchableOpacity>
      ) : null}
      {instructions.length > 0 ? (
        <View style={{ marginTop: 8, gap: 6 }}>
          {instructions.slice(0, 5).map((inst, idx) => (
            <View
              key={inst.id ?? idx}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 8,
                backgroundColor: colors.background + "80",
                borderRadius: 8,
                marginBottom: 4,
              }}
            >
              <Text
                style={[
                  styles.sectionHeaderSmall,
                  { color: colors.foreground, marginBottom: 2 },
                ]}
                numberOfLines={1}
              >
                {inst.address} · {inst.title}
              </Text>
              <Text
                style={[styles.helperText, { color: colors.muted }]}
                numberOfLines={2}
              >
                {inst.details}
              </Text>
            </View>
          ))}
          {instructions.length > 5 && (
            <Text style={[styles.helperText, { color: colors.muted }]}>
              +{instructions.length - 5} more
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function VRPPlanner({
  nestedInScrollView = false,
}: VRPPlannerProps = {}) {
  const colors = useColors();
  const cyan = colors.accentCyan ?? colors.primary;
  const magenta = colors.accentMagenta ?? "#d946ef";

  const [inputMode, setInputMode] = useState<InputMode>("coordinates");
  const [coordinates, setCoordinates] = useState("");
  const [addressesText, setAddressesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VRPResult | null>(null);
  const [useValhallaApi, setUseValhallaApi] = useState(true);
  const scrollViewRef = useRef<ScrollView | null>(null);

  /** Refs for iOS: avoid full re-render on every keystroke (reduces freeze when keyboard opens). */
  const coordinatesRef = useRef("");
  const addressesTextRef = useRef("");
  const nominatimValueRef = useRef("");
  const coordinatesInputRef = useRef<TextInput | null>(null);
  const addressesInputRef = useRef<TextInput | null>(null);
  const nominatimInputRef = useRef<TextInput | null>(null);
  const vehiclesRef = useRef(String(DEFAULT_VRP_CONFIG.vehicles));
  const capacityRef = useRef(String(DEFAULT_VRP_CONFIG.capacity));
  const maxRouteTimeHoursRef = useRef(
    String(DEFAULT_VRP_CONFIG.maxRouteTimeHours),
  );
  const depotAddressRef = useRef("");
  const travelSpeedFactorRef = useRef(
    String(DEFAULT_VRP_CONFIG.travelSpeedFactor),
  );
  const vroomServiceTimeMinsRef = useRef("0");
  const vroomShiftStartHourRef = useRef("8");
  const vroomShiftEndHourRef = useRef("18");
  const [coordinatesKey, setCoordinatesKey] = useState(0);
  const [addressesKey, setAddressesKey] = useState(0);
  const [nominatimKey, setNominatimKey] = useState(0);
  /** Bump to remount numeric/advanced inputs with fresh defaultValue (e.g. after Clear). */
  const [numericInputsKey, setNumericInputsKey] = useState(0);
  /** On iOS, use uncontrolled inputs everywhere to prevent keyboard-open freeze from re-renders. */
  const useUncontrolledInputs = Platform.OS === "ios";

  const [geocodeProgress, setGeocodeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const [vehicles, setVehicles] = useState(String(DEFAULT_VRP_CONFIG.vehicles));
  const [capacity, setCapacity] = useState(String(DEFAULT_VRP_CONFIG.capacity));
  const [maxRouteTimeHours, setMaxRouteTimeHours] = useState(
    String(DEFAULT_VRP_CONFIG.maxRouteTimeHours),
  );
  const [advancedOpen, setAdvancedOpen] = useState(Platform.OS === "web");
  const [depotAddress, setDepotAddress] = useState("");
  const [startFromCurrentPosition, setStartFromCurrentPosition] =
    useState(false);
  const [travelSpeedFactor, setTravelSpeedFactor] = useState(
    String(DEFAULT_VRP_CONFIG.travelSpeedFactor),
  );
  const [objective, setObjective] = useState<
    (typeof OBJECTIVE_OPTIONS)[number]["value"]
  >(DEFAULT_VRP_CONFIG.objective);
  const [algorithm, setAlgorithm] = useState<
    (typeof ALGORITHM_OPTIONS)[number]["value"]
  >(DEFAULT_VRP_CONFIG.algorithm);
  const [pickerOpen, setPickerOpen] = useState<
    "objective" | "algorithm" | null
  >(null);

  // VROOM-specific settings (only active when algorithm === "vroom")
  const [vroomServiceTimeMins, setVroomServiceTimeMins] = useState("0");
  const [vroomTimeWindowEnabled, setVroomTimeWindowEnabled] = useState(false);
  const [vroomShiftStartHour, setVroomShiftStartHour] = useState("8");
  const [vroomShiftEndHour, setVroomShiftEndHour] = useState("18");

  const [nominatimQuery, setNominatimQuery] = useState("");
  const [nominatimResults, setNominatimResults] = useState<NominatimResult[]>(
    [],
  );
  const [nominatimLoading, setNominatimLoading] = useState(false);

  const router = useRouter();
  const { dispatch } = useRouting();

  const [previewLoading, setPreviewLoading] = useState(false);
  const [exportGpxLoading, setExportGpxLoading] = useState(false);

  /** Get road-matched geometry for each route (for GPX export). Falls back to stop-only if routing unavailable. */
  const getRoadMatchedGeometries = useCallback(
    async (routes: VRPStop[][]): Promise<{ lat: number; lon: number }[][]> => {
      const routingConfig = await getRoutingConfigAsync();
      const canRoute = !!(
        routingConfig.baseUrl ||
        (routingConfig.provider === "google" && routingConfig.googleApiKey)
      );
      const geometries: { lat: number; lon: number }[][] = [];
      for (const stopList of routes) {
        const pts = stopList.map((s) => ({ lat: s.lat, lon: s.lon }));
        if (pts.length < 2) {
          geometries.push(pts);
          continue;
        }
        let matched: {
          matchedGeometry: { lat: number; lon: number }[];
        } | null = null;
        if (canRoute) {
          try {
            matched = await routeThroughWaypoints(
              pts,
              routingConfig,
              getRouteOptionsForRouting(),
            );
          } catch {
            // fall through to offline
          }
        }
        if (matched && matched.matchedGeometry.length >= 2) {
          geometries.push(
            matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })),
          );
        } else {
          const offline = buildOfflineMatchedRoute(pts);
          if (offline.matchedGeometry.length >= 2) {
            geometries.push(
              offline.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })),
            );
          } else {
            geometries.push(pts);
          }
        }
      }
      return geometries;
    },
    [],
  );

  const handlePreviewRoute = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const routes =
      result.routes && result.routes.length > 1 ? result.routes : null;
    setPreviewLoading(true);
    try {
      const routingConfig = await getRoutingConfigAsync();
      const canRoute =
        routingConfig.baseUrl ||
        (routingConfig.provider === "google" && routingConfig.googleApiKey);

      if (routes && routes.length > 1) {
        // Multi-vehicle: compute one road-matched route per vehicle and dispatch separate tracks
        const routeGeometries: { lat: number; lon: number }[][] = [];
        for (let v = 0; v < routes.length; v++) {
          const stopList = routes[v];
          const pts = stopList.map((s) => ({ lat: s.lat, lon: s.lon }));
          if (pts.length < 2) {
            routeGeometries.push(pts);
            continue;
          }
          let matched: {
            matchedGeometry: { lat: number; lon: number }[];
          } | null = null;
          if (canRoute) {
            matched = await routeThroughWaypoints(
              pts,
              routingConfig,
              getRouteOptionsForRouting(),
            );
          }
          if (matched && matched.matchedGeometry.length >= 2) {
            routeGeometries.push(
              matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon })),
            );
          } else {
            const offline = buildOfflineMatchedRoute(pts);
            if (offline.matchedGeometry.length >= 2) {
              routeGeometries.push(
                offline.matchedGeometry.map((p) => ({
                  lat: p.lat,
                  lon: p.lon,
                })),
              );
            } else {
              routeGeometries.push(pts);
            }
          }
        }
        dispatch({
          type: "SET_PREVIEW_ROUTES",
          payload: routeGeometries,
        });
      } else {
        // Single route: keep existing behavior (result.stops or first route)
        const points = result.stops.map((s, i) => ({
          lat: s.lat,
          lon: s.lon,
          label: `#${i + 1}`,
        }));
        if (points.length >= 2 && canRoute) {
          const matched = await routeThroughWaypoints(
            points.map((p) => ({ lat: p.lat, lon: p.lon })),
            routingConfig,
            getRouteOptionsForRouting(),
          );
          if (matched && matched.matchedGeometry.length >= 2) {
            dispatch({
              type: "SET_PREVIEW_ROUTE",
              payload: matched.matchedGeometry.map((p) => ({
                lat: p.lat,
                lon: p.lon,
              })),
            });
            router.push("/(tabs)/map");
            return;
          }
        }
        const pts = result.stops.map((s) => ({ lat: s.lat, lon: s.lon }));
        const offline = buildOfflineMatchedRoute(pts);
        if (offline.matchedGeometry.length >= 2) {
          dispatch({
            type: "SET_PREVIEW_ROUTE",
            payload: offline.matchedGeometry.map((p) => ({
              lat: p.lat,
              lon: p.lon,
            })),
          });
        } else {
          dispatch({ type: "SET_PREVIEW_ROUTE", payload: points });
        }
      }
    } catch (e) {
      const points = result.stops.map((s, i) => ({
        lat: s.lat,
        lon: s.lon,
        label: `#${i + 1}`,
      }));
      if (routes && routes.length > 1) {
        const fallback = routes.map((r) =>
          r.map((s) => ({ lat: s.lat, lon: s.lon })),
        );
        dispatch({ type: "SET_PREVIEW_ROUTES", payload: fallback });
      } else {
        dispatch({ type: "SET_PREVIEW_ROUTE", payload: points });
      }
    } finally {
      setPreviewLoading(false);
    }
    router.push("/(tabs)/map");
  };

  const handleSaveAsCurrentRoute = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const points: CollectionPoint[] = result.stops.map((s, i) => ({
      id: `vrp-${i}-${s.lat}-${s.lon}`,
      address: s.label ?? `Stop ${i + 1}`,
      latitude: s.lat,
      longitude: s.lon,
      collectionType: "residential",
      status: "pending",
    }));
    const routeToSave: Route = {
      id: generateRouteId(),
      date: new Date().toISOString().slice(0, 10),
      points,
      totalPoints: points.length,
      completedPoints: 0,
      estimatedDuration: Math.max(1, Math.round(points.length * 0.5)),
      status: "not_started",
      routeSource: "vrp",
    };
    await storage.saveRoute(routeToSave);
    Alert.alert(
      "Saved",
      `${points.length} stops saved as current route. Open Home to see the Processing Queue.`,
    );
    router.push("/(tabs)/");
  };

  const escapeCsvCell = (value: string): string => {
    if (value.includes('"') || value.includes(",") || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const buildGpxForRoute = (
    routeStops: VRPStop[],
    routeNum: number,
    date: string,
    trackPoints?: { lat: number; lon: number }[],
  ): string => {
    const wpts = routeStops
      .map((s, i) => {
        const name = s.label
          ? s.label
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
          : `Stop ${i + 1}`;
        return `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><name>${name}</name></wpt>`;
      })
      .join(nl);
    const track =
      trackPoints && trackPoints.length >= 2 ? trackPoints : routeStops;
    const trkpts = track
      .map(
        (p) =>
          `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`,
      )
      .join(nl);
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="RMP VRP Planner" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <metadata><name>Vehicle ${routeNum} – ${date}</name></metadata>`,
      wpts,
      `  <trk><name>Vehicle ${routeNum}</name><trkseg>`,
      trkpts,
      "  </trkseg></trk>",
      "</gpx>",
    ].join(nl);
  };

  const handleExportGpx = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const date = new Date().toISOString().slice(0, 10);
    const routes: VRPStop[][] =
      result.routes && result.routes.length > 1
        ? result.routes
        : [result.stops];

    setExportGpxLoading(true);
    try {
      const roadGeometries = await getRoadMatchedGeometries(routes);

      const allWpts = result.stops
        .map((s, i) => {
          const name = (s.label ?? `Stop ${i + 1}`)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `  <wpt lat="${s.lat.toFixed(6)}" lon="${s.lon.toFixed(6)}"><name>${name}</name></wpt>`;
        })
        .join(nl);

      const tracks = routes
        .map((routeStops, ri) => {
          const trackPoints = roadGeometries[ri];
          const pts =
            trackPoints && trackPoints.length >= 2 ? trackPoints : routeStops;
          const trkpts = pts
            .map(
              (p) =>
                `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`,
            )
            .join(nl);
          return [
            `  <trk><name>Vehicle ${ri + 1}</name><trkseg>`,
            trkpts,
            "  </trkseg></trk>",
          ].join(nl);
        })
        .join(nl);

      const gpx = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="RMP VRP Planner" xmlns="http://www.topografix.com/GPX/1/1">',
        `  <metadata><name>VRP Routes – ${date}</name></metadata>`,
        allWpts,
        tracks,
        "</gpx>",
      ].join(nl);

      const fileName = `vrp_routes_${date}.gpx`;
      if (Platform.OS === "web") {
        const blob = new Blob([gpx], { type: "application/gpx+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert("Exported", `GPX saved as ${fileName} (snapped to roads)`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as {
          isAvailableAsync: () => Promise<boolean>;
          shareAsync: (
            uri: string,
            opts?: { mimeType?: string; dialogTitle?: string },
          ) => Promise<void>;
        };
        const fileUri = `${FileSystem.cacheDirectory ?? ""}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, gpx, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/gpx+xml",
            dialogTitle: "Export VRP routes (GPX)",
          });
        } else {
          Alert.alert("Saved", `GPX saved to ${fileUri}`);
        }
        Alert.alert("Exported", `GPX saved as ${fileName} (snapped to roads)`);
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Export failed", "Could not export GPX. Please try again.");
    } finally {
      setExportGpxLoading(false);
    }
  };

  const handleExportGpxPerVehicle = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const date = new Date().toISOString().slice(0, 10);
    const routes: VRPStop[][] =
      result.routes && result.routes.length > 1
        ? result.routes
        : [result.stops];

    if (routes.length === 1) {
      Alert.alert(
        "Single route",
        "Only one vehicle – exporting as single GPX file.",
      );
      try {
        await handleExportGpx();
      } catch (e) {
        console.error(e);
        Alert.alert("Export failed", "Could not export GPX. Please try again.");
      }
      return;
    }

    setExportGpxLoading(true);
    try {
      const roadGeometries = await getRoadMatchedGeometries(routes);

      const jszipMod = await import("jszip");
      const JSZip =
        (jszipMod as { default?: typeof jszipMod }).default ?? jszipMod;
      if (typeof JSZip !== "function") {
        throw new Error("JSZip not available");
      }
      const zip = new JSZip();
      const validRoutes = routes.filter((r) => r?.length > 0);
      if (validRoutes.length === 0) throw new Error("No routes to export");
      validRoutes.forEach((routeStops, ri) => {
        const trackPoints = roadGeometries[ri];
        const gpx = buildGpxForRoute(routeStops, ri + 1, date, trackPoints);
        zip.file(`vehicle_${ri + 1}.gpx`, gpx);
      });
      const isWeb = Platform.OS === "web";
      const zipOutput = await zip.generateAsync({
        type: isWeb ? "uint8array" : "base64",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const fileName = `vrp_routes_per_vehicle_${date}.zip`;

      if (isWeb) {
        const blob = new Blob([zipOutput as Uint8Array], {
          type: "application/zip",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert(
          "Exported",
          `${validRoutes.length} GPX files (snapped to roads) saved in ${fileName}`,
        );
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as {
          isAvailableAsync: () => Promise<boolean>;
          shareAsync: (
            uri: string,
            opts?: { mimeType?: string; dialogTitle?: string },
          ) => Promise<void>;
        };
        const cacheDir =
          FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
        if (!cacheDir) {
          throw new Error("No cache directory available");
        }
        const fileUri = `${cacheDir}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, zipOutput as string, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/zip",
            dialogTitle: "Export GPX per vehicle (ZIP)",
          });
        } else {
          Alert.alert("Saved", `ZIP saved to ${fileUri}`);
        }
        Alert.alert(
          "Exported",
          `${validRoutes.length} GPX files (snapped to roads) saved in ${fileName}`,
        );
      }
    } catch (e) {
      console.error(e);
      Alert.alert(
        "Export failed",
        "Could not export GPX files. Please try again.",
      );
    } finally {
      setExportGpxLoading(false);
    }
  };

  const handleExportCsv = async () => {
    if (!result?.stops?.length) return;
    hapticImpact();
    const comment =
      "# Rows are in drive order per route. Route = vehicle/route number (1, 2, 3...).";
    const header = "Route,VisitOrder,StopLabel,Latitude,Longitude";
    const rows: string[] = [];

    const headerWithInstructions = `${header},Instructions`;
    const rowForStop = (s: VRPStop, routeNum: number, visitOrder: number) => {
      const label = escapeCsvCell(s.label ?? `Stop ${visitOrder}`);
      const matched = instructionManager.matchForRouteStop(s.label ?? "");
      const instr = matched
        ? escapeCsvCell(`${matched.title}: ${matched.details}`)
        : "";
      return `${routeNum},${visitOrder},${label},${s.lat},${s.lon},${instr}`;
    };

    if (result.routes && result.routes.length > 1) {
      result.routes.forEach((routeStops, routeIdx) => {
        const routeNum = routeIdx + 1;
        routeStops.forEach((s, i) => {
          rows.push(rowForStop(s, routeNum, i + 1));
        });
      });
    } else {
      result.stops.forEach((s, i) => {
        rows.push(rowForStop(s, 1, i + 1));
      });
    }

    const csv = [comment, headerWithInstructions, ...rows].join("\n");
    const fileName = `vrp_route_${new Date().toISOString().slice(0, 10)}.csv`;

    try {
      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert("Exported", `CSV saved as ${fileName}`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = (await import("expo-sharing")) as {
          isAvailableAsync: () => Promise<boolean>;
          shareAsync: (
            uri: string,
            opts?: { mimeType?: string; dialogTitle?: string },
          ) => Promise<void>;
        };
        const fileUri = `${FileSystem.cacheDirectory ?? ""}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "text/csv",
            dialogTitle: "Export VRP route (CSV)",
          });
        } else {
          Alert.alert("Saved", `CSV saved to ${fileUri}`);
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Export failed", "Could not export CSV. Please try again.");
    }
  };

  const runVRP = async () => {
    Keyboard.dismiss();
    const coordsValue = useUncontrolledInputs
      ? coordinatesRef.current
      : coordinates;
    const addressesValue = useUncontrolledInputs
      ? addressesTextRef.current
      : addressesText;
    const useCurrentAsDepot = startFromCurrentPosition;
    const minStops = useCurrentAsDepot ? 1 : 2;
    const locations =
      inputMode === "coordinates"
        ? parseCoordinates(coordsValue)
        : await (async () => {
            const lines = addressesValue
              .trim()
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);
            if (lines.length < minStops) return [];
            setGeocodeProgress({ done: 0, total: lines.length });
            const stops = await geocodeAddressesBatch(lines, (d, t) =>
              setGeocodeProgress({ done: d, total: t }),
            );
            setGeocodeProgress(null);
            return stops;
          })();
    if (useCurrentAsDepot) {
      if (!locations || locations.length < 1) {
        Alert.alert(
          "Error",
          inputMode === "coordinates"
            ? "Enter at least 1 coordinate when using Start from current position."
            : "Enter at least 1 address when using Start from current position.",
        );
        return;
      }
    } else if (!locations || locations.length < 2) {
      Alert.alert(
        "Error",
        inputMode === "coordinates"
          ? "Enter at least 2 coordinates (lat,lon or lat,lon,label or lat,lon,label,demand per line)."
          : "Enter at least 2 addresses (one per line) and ensure geocoding succeeds.",
      );
      return;
    }

    hapticImpact(ImpactFeedbackStyle.Medium);
    setLoading(true);
    setResult(null);
    try {
      let locationsForMatrix = locations;
      if (useCurrentAsDepot) {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Location",
            "Location permission is required to start from current position.",
          );
          setLoading(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const current: VRPStop = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "Current position",
        };
        locationsForMatrix = [current, ...locations];
      }

      const vehiclesStr = useUncontrolledInputs
        ? vehiclesRef.current
        : vehicles;
      const capacityStr = useUncontrolledInputs
        ? capacityRef.current
        : capacity;
      const maxRouteTimeHoursStr = useUncontrolledInputs
        ? maxRouteTimeHoursRef.current
        : maxRouteTimeHours;
      const depotStr = useUncontrolledInputs
        ? depotAddressRef.current
        : depotAddress;
      const speedStr = useUncontrolledInputs
        ? travelSpeedFactorRef.current
        : travelSpeedFactor;
      const numVehicles = Math.max(
        1,
        parseInt(vehiclesStr, 10) || DEFAULT_VRP_CONFIG.vehicles,
      );
      const vehicleCap = Math.max(
        1,
        parseInt(capacityStr, 10) || DEFAULT_VRP_CONFIG.capacity,
      );

      // ── Unified solver dispatch via plugin registry ───────────────────────
      const solver = getSolver(algorithm);

      // Build time window params for VROOM
      let windowOpen: number | undefined;
      let windowClose: number | undefined;
      if (algorithm === "vroom" && vroomTimeWindowEnabled) {
        const shiftStart =
          parseInt(
            useUncontrolledInputs
              ? vroomShiftStartHourRef.current
              : vroomShiftStartHour,
            10,
          ) || 8;
        const shiftEnd =
          parseInt(
            useUncontrolledInputs
              ? vroomShiftEndHourRef.current
              : vroomShiftEndHour,
            10,
          ) || 18;
        const todayMidnight = new Date();
        todayMidnight.setHours(0, 0, 0, 0);
        const epochBase = Math.floor(todayMidnight.getTime() / 1000);
        windowOpen = epochBase + shiftStart * 3600;
        windowClose = epochBase + shiftEnd * 3600;
      }

      const serviceTimeSecs =
        algorithm === "vroom"
          ? (parseInt(
              useUncontrolledInputs
                ? vroomServiceTimeMinsRef.current
                : vroomServiceTimeMins,
              10,
            ) || 0) * 60
          : 0;

      const matrix = solver.requiresMatrix
        ? useValhallaApi
          ? await getValhallaMatrix(locationsForMatrix)
          : buildHaversineMatrix(locationsForMatrix)
        : undefined;

      const output = await solver.solve({
        locations: locationsForMatrix,
        numVehicles,
        vehicleCapacity: vehicleCap,
        objective,
        matrix,
        serviceTimeSecs,
        useTimeWindows: vroomTimeWindowEnabled,
        windowOpen,
        windowClose,
      });

      setResult({
        stops: output.stops,
        routes: output.routes,
        totalDistance: output.totalDistanceKm,
        totalTime: output.totalTimeMin,
        routeStats: output.routeStats,
        unassigned: output.unassigned,
      });
      // ─────────────────────────────────────────────────────────────────────
    } catch (error) {
      Alert.alert(
        "Error",
        useValhallaApi
          ? "Failed to calculate route. Check your internet connection."
          : "Failed to calculate route.",
      );
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    hapticImpact();
    if (useUncontrolledInputs) {
      coordinatesRef.current = "";
      addressesTextRef.current = "";
      vehiclesRef.current = String(DEFAULT_VRP_CONFIG.vehicles);
      capacityRef.current = String(DEFAULT_VRP_CONFIG.capacity);
      maxRouteTimeHoursRef.current = String(
        DEFAULT_VRP_CONFIG.maxRouteTimeHours,
      );
      depotAddressRef.current = "";
      travelSpeedFactorRef.current = String(
        DEFAULT_VRP_CONFIG.travelSpeedFactor,
      );
      vroomServiceTimeMinsRef.current = "0";
      vroomShiftStartHourRef.current = "8";
      vroomShiftEndHourRef.current = "18";
      setCoordinatesKey((k) => k + 1);
      setAddressesKey((k) => k + 1);
      setNumericInputsKey((k) => k + 1);
    }
    setCoordinates("");
    setAddressesText("");
    setVehicles(String(DEFAULT_VRP_CONFIG.vehicles));
    setCapacity(String(DEFAULT_VRP_CONFIG.capacity));
    setMaxRouteTimeHours(String(DEFAULT_VRP_CONFIG.maxRouteTimeHours));
    setDepotAddress("");
    setStartFromCurrentPosition(false);
    setTravelSpeedFactor(String(DEFAULT_VRP_CONFIG.travelSpeedFactor));
    setVroomServiceTimeMins("0");
    setVroomTimeWindowEnabled(false);
    setVroomShiftStartHour("8");
    setVroomShiftEndHour("18");
    setResult(null);
  };

  const runNominatimSearch = async () => {
    Keyboard.dismiss();
    const query = useUncontrolledInputs
      ? nominatimValueRef.current
      : nominatimQuery;
    if (!query.trim()) {
      Alert.alert("Search", "Enter a place name or address.");
      return;
    }
    hapticImpact();
    setNominatimLoading(true);
    setNominatimResults([]);
    try {
      const results = await searchNominatim(query);
      setNominatimResults(results);
      if (results.length === 0) {
        Alert.alert("No results", `No places found for "${query.trim()}"`);
      }
    } catch (error) {
      Alert.alert("Error", "Search failed. Check your internet connection.");
      console.error(error);
    } finally {
      setNominatimLoading(false);
    }
  };

  const addNominatimToVRP = (place: NominatimResult, label?: string) => {
    hapticImpact();
    const name =
      label ??
      (place.display_name.split(",").slice(0, 2).join(",").trim() || "Stop");
    const line = `${place.lat},${place.lon}, ${name}\n`;
    if (useUncontrolledInputs) {
      const next =
        (coordinatesRef.current.trim()
          ? coordinatesRef.current.trim() + "\n"
          : "") + line;
      coordinatesRef.current = next;
      coordinatesInputRef.current?.setNativeProps?.({ text: next });
      nominatimValueRef.current = "";
      setNominatimKey((k) => k + 1);
      nominatimInputRef.current?.setNativeProps?.({ text: "" });
    } else {
      setCoordinates((prev) =>
        prev.trim() ? prev.trim() + "\n" + line : line,
      );
      setNominatimQuery("");
    }
    setNominatimResults([]);
  };

  const runGeocodeAddresses = async () => {
    Keyboard.dismiss();
    const addressesValue = useUncontrolledInputs
      ? addressesTextRef.current
      : addressesText;
    const lines = addressesValue
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      Alert.alert(
        "No addresses",
        "Enter one address per line, then tap Geocode and add to VRP.",
      );
      return;
    }
    hapticImpact();
    setGeocodeProgress({ done: 0, total: lines.length });
    try {
      const stops = await geocodeAddressesBatch(lines, (done, total) => {
        setGeocodeProgress({ done, total });
      });
      setGeocodeProgress(null);
      if (stops.length === 0) {
        Alert.alert(
          "No results",
          "No addresses could be geocoded. Check the text and try again.",
        );
        return;
      }
      const newLines = stops
        .map((s) => `${s.lat},${s.lon},${s.label}`)
        .join("\n");
      setCoordinates((prev) =>
        prev.trim() ? prev.trim() + "\n" + newLines : newLines,
      );
      setAddressesText("");
      if (stops.length < lines.length) {
        Alert.alert(
          "Partially done",
          `Geocoded ${stops.length} of ${lines.length} addresses. Failed rows were skipped.`,
        );
      }
    } catch (e) {
      setGeocodeProgress(null);
      Alert.alert("Error", "Geocoding failed. Check your internet connection.");
      console.error(e);
    }
  };

  const handleInputFocus = useCallback(() => {
    if (nestedInScrollView) return;
    // Defer scroll so it doesn't run during the keyboard-open animation on iOS.
    // Running scrollTo during keyboard transition can worsen main-thread hang (UIKit run loop timeout).
    if (Platform.OS === "ios") {
      const delayMs = 500;
      setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          scrollViewRef.current?.scrollTo({ y: 50, animated: true });
        });
      }, delayMs);
    } else {
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: 50, animated: true });
      }, 300);
    }
  }, [nestedInScrollView]);

  const inputBorder = {
    borderColor: cyan + "66",
    backgroundColor: colors.background + "F5",
  };

  /** On web home screen: Plan deliveries + Search place fill the viewport. */
  const fillScreen = nestedInScrollView && Platform.OS === "web";
  /** On web when nested, don't flex the plan card so the full form (including Advanced options) is in the outer scroll and reachable. */
  const planCardFills =
    fillScreen && !(Platform.OS === "web" && nestedInScrollView);
  const planCardStyle = [
    styles.card,
    {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: magenta + "44",
    },
    planCardFills && styles.cardFill,
  ];

  const content = (
    <>
      <View style={planCardStyle}>
        <Text style={[styles.sectionHeader, { color: colors.foreground }]}>
          Plan deliveries (VRP)
        </Text>

        {/* Input mode: Coordinates | Address */}
        <View style={[styles.segmentedRow, { marginBottom: 12 }]}>
          <TouchableOpacity
            style={[
              styles.segmentedOption,
              inputMode === "coordinates" && {
                backgroundColor: cyan + "33",
                borderColor: cyan,
              },
              { borderColor: colors.border },
            ]}
            onPress={() => {
              hapticImpact();
              setInputMode("coordinates");
            }}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentedLabel,
                { color: inputMode === "coordinates" ? cyan : colors.muted },
              ]}
            >
              Coordinates
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentedOption,
              inputMode === "address" && {
                backgroundColor: cyan + "33",
                borderColor: cyan,
              },
              { borderColor: colors.border },
            ]}
            onPress={() => {
              hapticImpact();
              setInputMode("address");
            }}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentedLabel,
                { color: inputMode === "address" ? cyan : colors.muted },
              ]}
            >
              Address
            </Text>
          </TouchableOpacity>
        </View>

        {inputMode === "coordinates" ? (
          <TextInput
            key={useUncontrolledInputs ? `coords-${coordinatesKey}` : undefined}
            ref={coordinatesInputRef}
            style={[
              styles.input,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
                color: colors.foreground,
              },
              fillScreen && { flex: 1, minHeight: 120 },
            ]}
            multiline
            numberOfLines={5}
            placeholder="45.5017,-73.5673, Downtown\n45.5234,-73.5834, West End\n45.5100,-73.6000, Depot, 12"
            placeholderTextColor={colors.muted}
            {...(useUncontrolledInputs
              ? {
                  defaultValue: "",
                  onChangeText: (t) => {
                    coordinatesRef.current = t;
                  },
                }
              : { value: coordinates, onChangeText: setCoordinates })}
            onFocus={handleInputFocus}
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
          />
        ) : (
          <>
            <TextInput
              key={useUncontrolledInputs ? `addr-${addressesKey}` : undefined}
              ref={addressesInputRef}
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  minHeight: 80,
                },
                fillScreen && { flex: 1, minHeight: 120 },
              ]}
              multiline
              numberOfLines={4}
              placeholder="123 Main St, Montreal\n456 Oak Ave, Toronto\n..."
              placeholderTextColor={colors.muted}
              {...(useUncontrolledInputs
                ? {
                    defaultValue: "",
                    onChangeText: (t) => {
                      addressesTextRef.current = t;
                    },
                  }
                : { value: addressesText, onChangeText: setAddressesText })}
              onFocus={handleInputFocus}
              autoCapitalize="none"
              textAlignVertical="top"
              editable={!geocodeProgress}
            />
            <Text
              style={[styles.helperText, { color: colors.muted, marginTop: 6 }]}
            >
              Geocode confidence ≥ 90%; automatically clusters if &gt;1 depot
              detected.
            </Text>
            {geocodeProgress ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <ActivityIndicator size="small" color={cyan} />
                <Text
                  style={[
                    styles.helperText,
                    { color: colors.muted, marginLeft: 8 },
                  ]}
                >
                  Geocoding {geocodeProgress.done}/{geocodeProgress.total}…
                </Text>
              </View>
            ) : null}
          </>
        )}

        {/* Vehicle Configuration */}
        <Text
          style={[
            styles.sectionHeaderSmall,
            { color: colors.foreground, marginTop: 16, marginBottom: 8 },
          ]}
        >
          Vehicle configuration
        </Text>
        <View style={styles.vehicleRow}>
          <View style={[styles.vehicleInputWrap, inputBorder]}>
            <Text style={[styles.vehicleLabel, { color: colors.muted }]}>
              Vehicles
            </Text>
            <TextInput
              key={
                useUncontrolledInputs
                  ? `vehicles-${numericInputsKey}`
                  : undefined
              }
              style={[styles.vehicleInput, { color: colors.foreground }]}
              {...(useUncontrolledInputs
                ? {
                    defaultValue: vehicles,
                    onChangeText: (t) => {
                      vehiclesRef.current = t;
                    },
                  }
                : { value: vehicles, onChangeText: setVehicles })}
              keyboardType="number-pad"
              placeholder="2"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={[styles.vehicleInputWrap, inputBorder]}>
            <Text style={[styles.vehicleLabel, { color: colors.muted }]}>
              Capacity (kg/pcs)
            </Text>
            <TextInput
              key={
                useUncontrolledInputs
                  ? `capacity-${numericInputsKey}`
                  : undefined
              }
              style={[styles.vehicleInput, { color: colors.foreground }]}
              {...(useUncontrolledInputs
                ? {
                    defaultValue: capacity,
                    onChangeText: (t) => {
                      capacityRef.current = t;
                    },
                  }
                : { value: capacity, onChangeText: setCapacity })}
              keyboardType="number-pad"
              placeholder="1000"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={[styles.vehicleInputWrap, inputBorder]}>
            <Text style={[styles.vehicleLabel, { color: colors.muted }]}>
              Max Route Time (h)
            </Text>
            <TextInput
              key={
                useUncontrolledInputs
                  ? `maxRoute-${numericInputsKey}`
                  : undefined
              }
              style={[styles.vehicleInput, { color: colors.foreground }]}
              {...(useUncontrolledInputs
                ? {
                    defaultValue: maxRouteTimeHours,
                    onChangeText: (t) => {
                      maxRouteTimeHoursRef.current = t;
                    },
                  }
                : {
                    value: maxRouteTimeHours,
                    onChangeText: setMaxRouteTimeHours,
                  })}
              keyboardType="number-pad"
              placeholder="8"
              placeholderTextColor={colors.muted}
            />
          </View>
        </View>

        {/* Advanced options (collapsible) */}
        <TouchableOpacity
          style={[styles.advancedHeader, { borderBottomColor: colors.border }]}
          onPress={() => {
            hapticImpact();
            setAdvancedOpen((o) => !o);
          }}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.sectionHeaderSmall, { color: colors.foreground }]}
          >
            Advanced options
          </Text>
          <Ionicons
            name={advancedOpen ? "chevron-up" : "chevron-down"}
            size={20}
            color={colors.muted}
          />
        </TouchableOpacity>
        {advancedOpen && (
          <View
            style={[styles.advancedBody, { borderBottomColor: colors.border }]}
          >
            <Text
              style={[
                styles.helperText,
                { color: colors.muted, marginBottom: 6 },
              ]}
            >
              Depot address
            </Text>
            <TextInput
              key={
                useUncontrolledInputs ? `depot-${numericInputsKey}` : undefined
              }
              style={[
                styles.input,
                styles.depotInput,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  color: colors.foreground,
                },
              ]}
              placeholder="Defaults to 1st address"
              placeholderTextColor={colors.muted}
              {...(useUncontrolledInputs
                ? {
                    defaultValue: depotAddress,
                    onChangeText: (t) => {
                      depotAddressRef.current = t;
                    },
                  }
                : { value: depotAddress, onChangeText: setDepotAddress })}
            />
            <Text
              style={[
                styles.helperText,
                { color: colors.muted, marginTop: 10, marginBottom: 6 },
              ]}
            >
              Travel speed factor
            </Text>
            <TextInput
              key={
                useUncontrolledInputs ? `speed-${numericInputsKey}` : undefined
              }
              style={[
                styles.vehicleInput,
                styles.travelSpeedInput,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  color: colors.foreground,
                },
              ]}
              {...(useUncontrolledInputs
                ? {
                    defaultValue: travelSpeedFactor,
                    onChangeText: (t) => {
                      travelSpeedFactorRef.current = t;
                    },
                  }
                : {
                    value: travelSpeedFactor,
                    onChangeText: setTravelSpeedFactor,
                  })}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.muted}
            />
            <TouchableOpacity
              style={[styles.valhallaRow, { marginTop: 12, marginBottom: 4 }]}
              onPress={() => {
                hapticImpact();
                setStartFromCurrentPosition((prev) => !prev);
              }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.checkmark,
                  {
                    backgroundColor: startFromCurrentPosition
                      ? colors.success
                      : "transparent",
                    borderWidth: 1,
                    borderColor: startFromCurrentPosition
                      ? colors.success
                      : colors.border,
                  },
                ]}
              >
                {startFromCurrentPosition && (
                  <Text style={styles.checkmarkText}>✓</Text>
                )}
              </View>
              <Text style={[styles.valhallaText, { color: colors.foreground }]}>
                Start from current position
              </Text>
            </TouchableOpacity>
            <Text
              style={[
                styles.helperText,
                { color: colors.muted, marginTop: 10, marginBottom: 6 },
              ]}
            >
              Objective
            </Text>
            <TouchableOpacity
              style={[
                styles.pickerTrigger,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              onPress={() => setPickerOpen("objective")}
            >
              <Text style={{ color: colors.foreground }}>
                {OBJECTIVE_OPTIONS.find((o) => o.value === objective)?.label ??
                  objective}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.muted} />
            </TouchableOpacity>
            <Text
              style={[
                styles.helperText,
                { color: colors.muted, marginTop: 10, marginBottom: 6 },
              ]}
            >
              Algorithm
            </Text>
            <TouchableOpacity
              style={[
                styles.pickerTrigger,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              onPress={() => setPickerOpen("algorithm")}
            >
              <Text style={{ color: colors.foreground }} numberOfLines={1}>
                {ALGORITHM_OPTIONS.find((o) => o.value === algorithm)?.label ??
                  algorithm}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.muted} />
            </TouchableOpacity>
            <Text
              style={[styles.helperText, { color: colors.muted, marginTop: 6 }]}
            >
              {algorithm === "vroom"
                ? "VROOM: server-side CVRP/VRPTW solver. Requires VROOM_BACKEND_URL."
                : "Local heuristic solver (no server required)."}
            </Text>

            {/* VROOM-specific options */}
            {algorithm === "vroom" && (
              <View style={{ marginTop: 12 }}>
                <Text
                  style={[
                    styles.helperText,
                    { color: colors.muted, marginBottom: 6 },
                  ]}
                >
                  Service time per stop (min)
                </Text>
                <TextInput
                  key={
                    useUncontrolledInputs
                      ? `vroomSvc-${numericInputsKey}`
                      : undefined
                  }
                  style={[
                    styles.vehicleInput,
                    styles.travelSpeedInput,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                      color: colors.foreground,
                    },
                  ]}
                  {...(useUncontrolledInputs
                    ? {
                        defaultValue: vroomServiceTimeMins,
                        onChangeText: (t) => {
                          vroomServiceTimeMinsRef.current = t;
                        },
                      }
                    : {
                        value: vroomServiceTimeMins,
                        onChangeText: setVroomServiceTimeMins,
                      })}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                />
                <TouchableOpacity
                  style={[
                    styles.valhallaRow,
                    { marginTop: 12, marginBottom: 4 },
                  ]}
                  onPress={() => {
                    hapticImpact();
                    setVroomTimeWindowEnabled((v) => !v);
                  }}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.checkmark,
                      {
                        backgroundColor: vroomTimeWindowEnabled
                          ? colors.success
                          : "transparent",
                        borderWidth: 1,
                        borderColor: vroomTimeWindowEnabled
                          ? colors.success
                          : colors.border,
                      },
                    ]}
                  >
                    {vroomTimeWindowEnabled && (
                      <Text style={styles.checkmarkText}>✓</Text>
                    )}
                  </View>
                  <Text
                    style={[styles.valhallaText, { color: colors.foreground }]}
                  >
                    Enable shift time windows
                  </Text>
                </TouchableOpacity>
                {vroomTimeWindowEnabled && (
                  <View
                    style={[
                      styles.vehicleRow,
                      { marginTop: 8, flexWrap: "wrap" },
                    ]}
                  >
                    <View style={[styles.vehicleInputWrap, inputBorder]}>
                      <Text
                        style={[styles.vehicleLabel, { color: colors.muted }]}
                      >
                        Shift start (h)
                      </Text>
                      <TextInput
                        key={
                          useUncontrolledInputs
                            ? `vroomStart-${numericInputsKey}`
                            : undefined
                        }
                        style={[
                          styles.vehicleInput,
                          { color: colors.foreground },
                        ]}
                        {...(useUncontrolledInputs
                          ? {
                              defaultValue: vroomShiftStartHour,
                              onChangeText: (t) => {
                                vroomShiftStartHourRef.current = t;
                              },
                            }
                          : {
                              value: vroomShiftStartHour,
                              onChangeText: setVroomShiftStartHour,
                            })}
                        keyboardType="number-pad"
                        placeholder="8"
                        placeholderTextColor={colors.muted}
                      />
                    </View>
                    <View style={[styles.vehicleInputWrap, inputBorder]}>
                      <Text
                        style={[styles.vehicleLabel, { color: colors.muted }]}
                      >
                        Shift end (h)
                      </Text>
                      <TextInput
                        key={
                          useUncontrolledInputs
                            ? `vroomEnd-${numericInputsKey}`
                            : undefined
                        }
                        style={[
                          styles.vehicleInput,
                          { color: colors.foreground },
                        ]}
                        {...(useUncontrolledInputs
                          ? {
                              defaultValue: vroomShiftEndHour,
                              onChangeText: (t) => {
                                vroomShiftEndHourRef.current = t;
                              },
                            }
                          : {
                              value: vroomShiftEndHour,
                              onChangeText: setVroomShiftEndHour,
                            })}
                        keyboardType="number-pad"
                        placeholder="18"
                        placeholderTextColor={colors.muted}
                      />
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        <TouchableOpacity
          style={styles.valhallaRow}
          onPress={() => {
            hapticImpact();
            setUseValhallaApi((prev) => !prev);
          }}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.checkmark,
              {
                backgroundColor: useValhallaApi
                  ? colors.success
                  : "transparent",
                borderWidth: 1,
                borderColor: useValhallaApi ? colors.success : colors.border,
              },
            ]}
          >
            {useValhallaApi && <Text style={styles.checkmarkText}>✓</Text>}
          </View>
          <Text style={[styles.valhallaText, { color: colors.foreground }]}>
            Use Valhalla API (more accurate road distances)
          </Text>
        </TouchableOpacity>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.optimizeButton,
              {
                borderWidth: 2,
                borderColor: magenta + "99",
                backgroundColor: colors.primary,
              },
              loading && styles.disabled,
            ]}
            onPress={runVRP}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="navigate"
                  size={18}
                  color="#ffffff"
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.optimizeButtonText, { color: "#ffffff" }]}>
                  Optimize Routes & Export
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.clearButton,
              { backgroundColor: colors.muted + "40" },
            ]}
            onPress={clearAll}
            activeOpacity={0.8}
          >
            <Text
              style={[styles.clearButtonText, { color: colors.foreground }]}
            >
              Clear
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Picker modal */}
      <Modal visible={pickerOpen !== null} transparent animationType="slide">
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setPickerOpen(null)}
        >
          <View
            style={[
              styles.pickerModal,
              { backgroundColor: colors.surface, borderColor: magenta + "66" },
            ]}
          >
            <Text
              style={[
                styles.sectionHeaderSmall,
                { color: colors.foreground, marginBottom: 12 },
              ]}
            >
              {pickerOpen === "objective" ? "Objective" : "Algorithm"}
            </Text>
            {pickerOpen === "objective" &&
              OBJECTIVE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.pickerOption,
                    { borderBottomColor: colors.border },
                    objective === opt.value && { backgroundColor: cyan + "22" },
                  ]}
                  onPress={() => {
                    setObjective(opt.value);
                    setPickerOpen(null);
                    hapticImpact();
                  }}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      { color: colors.foreground },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {objective === opt.value ? (
                    <Ionicons name="checkmark" size={20} color={cyan} />
                  ) : null}
                </TouchableOpacity>
              ))}
            {pickerOpen === "algorithm" &&
              ALGORITHM_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.pickerOption,
                    { borderBottomColor: colors.border },
                    algorithm === opt.value && { backgroundColor: cyan + "22" },
                  ]}
                  onPress={() => {
                    setAlgorithm(opt.value);
                    setPickerOpen(null);
                    hapticImpact();
                  }}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      { color: colors.foreground },
                    ]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                  {algorithm === opt.value ? (
                    <Ionicons name="checkmark" size={20} color={cyan} />
                  ) : null}
                </TouchableOpacity>
              ))}
          </View>
        </Pressable>
      </Modal>

      {/* Delivery instructions – load from one JSON file; auto-matched to route stops by address */}
      <DeliveryInstructionsCard fillScreen={fillScreen} />

      {/* Nominatim search – place name to coordinates */}
      <View
        style={[
          styles.card,
          fillScreen && styles.cardFill,
          { backgroundColor: colors.surface },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          Search place (Nominatim)
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Search by place name or address to get coordinates, then add to VRP
          above.
        </Text>
        <TextInput
          key={useUncontrolledInputs ? `nominatim-${nominatimKey}` : undefined}
          ref={nominatimInputRef}
          style={[
            styles.input,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              color: colors.foreground,
              minHeight: 48,
            },
          ]}
          placeholder="e.g. Downtown Montreal, or 123 Main St, Toronto"
          placeholderTextColor={colors.muted}
          {...(useUncontrolledInputs
            ? {
                defaultValue: "",
                onChangeText: (t) => {
                  nominatimValueRef.current = t;
                },
              }
            : { value: nominatimQuery, onChangeText: setNominatimQuery })}
          onSubmitEditing={runNominatimSearch}
          returnKeyType="search"
        />
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.runButton,
              { backgroundColor: colors.primary },
              nominatimLoading && styles.disabled,
            ]}
            onPress={runNominatimSearch}
            disabled={nominatimLoading}
            activeOpacity={0.8}
          >
            {nominatimLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.runButtonText}>Search</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.clearButton,
              { backgroundColor: colors.muted + "40" },
            ]}
            onPress={() => {
              if (useUncontrolledInputs) {
                nominatimValueRef.current = "";
                setNominatimKey((k) => k + 1);
              }
              setNominatimQuery("");
              setNominatimResults([]);
              hapticImpact();
            }}
            activeOpacity={0.8}
          >
            <Text
              style={[styles.clearButtonText, { color: colors.foreground }]}
            >
              Clear
            </Text>
          </TouchableOpacity>
        </View>
        {nominatimResults.length > 0 ? (
          <View
            style={[styles.nominatimResults, { borderTopColor: colors.border }]}
          >
            <Text
              style={[
                styles.resultTitle,
                { color: colors.foreground, marginBottom: 8 },
              ]}
            >
              Results – tap to add to VRP
            </Text>
            {nominatimResults.map((place, idx) => (
              <TouchableOpacity
                key={`${place.lat}-${place.lon}-${idx}`}
                style={[
                  styles.nominatimRow,
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => addNominatimToVRP(place)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.stopLabel, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {place.display_name}
                </Text>
                <Text style={[styles.stopCoords, { color: colors.muted }]}>
                  {place.lat}, {place.lon}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      {result ? (
        <View style={[styles.resultCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.resultTitle, { color: colors.foreground }]}>
            Optimized Route
          </Text>
          <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.stat, { color: colors.muted }]}>
              📍 {result.stops.length} stops
              {result.routes && result.routes.length > 1
                ? ` · ${result.routes.length} vehicles`
                : ""}
            </Text>
            <Text style={[styles.stat, { color: colors.muted }]}>
              🛣️ {result.totalDistance} km
            </Text>
            <Text style={[styles.stat, { color: colors.muted }]}>
              ⏱️ {result.totalTime} min
            </Text>
          </View>

          {/* Unassigned stops (VROOM only) */}
          {result.unassigned && result.unassigned.length > 0 && (
            <View
              style={{
                marginHorizontal: 0,
                marginTop: 8,
                marginBottom: 4,
                padding: 10,
                borderRadius: 8,
                backgroundColor: colors.error + "22",
                borderWidth: 1,
                borderColor: colors.error + "66",
              }}
            >
              <Text
                style={[
                  styles.sectionHeaderSmall,
                  { color: colors.error, marginBottom: 4 },
                ]}
              >
                ⚠️ {result.unassigned.length} stop
                {result.unassigned.length > 1 ? "s" : ""} unassigned
              </Text>
              <Text
                style={[
                  styles.helperText,
                  { color: colors.muted, marginBottom: 6 },
                ]}
              >
                Could not be served within capacity / time-window constraints.
              </Text>
              {result.unassigned.map((label, i) => (
                <Text
                  key={i}
                  style={[styles.stopLabel, { color: colors.error, marginBottom: 2 }]}
                >
                  • {label}
                </Text>
              ))}
            </View>
          )}

          {result.routes && result.routes.length > 1
            ? result.routes.map((routeStops, routeIdx) => {
                const stats = result.routeStats?.[routeIdx];
                return (
                  <View
                    key={routeIdx}
                    style={[
                      styles.routeBlock,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 4,
                      }}
                    >
                      <Text style={[styles.routeLabel, { color: cyan }]}>
                        Route {routeIdx + 1}
                      </Text>
                      {stats && (
                        <Text
                          style={[styles.helperText, { color: colors.muted }]}
                        >
                          {(stats.distance / 1000).toFixed(1)} km ·{" "}
                          {Math.round(stats.duration / 60)} min
                        </Text>
                      )}
                    </View>
                    {routeStops.map((stop, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.stopRow,
                          { borderBottomColor: colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.stopNumber,
                            {
                              backgroundColor:
                                idx === 0 || idx === routeStops.length - 1
                                  ? colors.success
                                  : colors.primary,
                            },
                          ]}
                        >
                          <Text style={styles.stopNumberText}>
                            {idx === 0
                              ? "S"
                              : idx === routeStops.length - 1
                                ? "E"
                                : idx}
                          </Text>
                        </View>
                        <View style={styles.stopInfo}>
                          <Text
                            style={[
                              styles.stopLabel,
                              { color: colors.foreground },
                            ]}
                          >
                            {stop.label}
                            {stop.demand != null && stop.demand !== 1
                              ? ` (${stop.demand} units)`
                              : ""}
                          </Text>
                          <Text
                            style={[styles.stopCoords, { color: colors.muted }]}
                          >
                            {stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}
                            {stop.arrivalTime
                              ? ` · ETA ${new Date(stop.arrivalTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                              : ""}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })
            : result.stops.map((stop, idx) => (
                <View
                  key={idx}
                  style={[styles.stopRow, { borderBottomColor: colors.border }]}
                >
                  <View
                    style={[
                      styles.stopNumber,
                      {
                        backgroundColor:
                          idx === 0 || idx === result.stops.length - 1
                            ? colors.success
                            : colors.primary,
                      },
                    ]}
                  >
                    <Text style={styles.stopNumberText}>
                      {idx === 0
                        ? "S"
                        : idx === result.stops.length - 1
                          ? "E"
                          : idx}
                    </Text>
                  </View>
                  <View style={styles.stopInfo}>
                    <Text
                      style={[styles.stopLabel, { color: colors.foreground }]}
                    >
                      {stop.label}
                      {stop.demand != null && stop.demand !== 1
                        ? ` (${stop.demand} units)`
                        : ""}
                    </Text>
                    <Text style={[styles.stopCoords, { color: colors.muted }]}>
                      {stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}
                      {stop.arrivalTime
                        ? ` · ETA ${new Date(stop.arrivalTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </Text>
                  </View>
                </View>
              ))}
          <View
            style={[styles.previewButtonRow, { borderTopColor: colors.border }]}
          >
            <TouchableOpacity
              style={[
                styles.previewButton,
                styles.previewButtonSecondary,
                { borderColor: colors.border },
              ]}
              onPress={handleExportCsv}
              activeOpacity={0.8}
            >
              <Ionicons
                name="document-text-outline"
                size={18}
                color={colors.foreground}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.previewButtonTextSecondary,
                  { color: colors.foreground },
                ]}
              >
                Export CSV
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.previewButton,
                styles.previewButtonSecondary,
                { borderColor: colors.border },
              ]}
              onPress={handleExportGpx}
              activeOpacity={0.8}
              disabled={exportGpxLoading}
            >
              {exportGpxLoading ? (
                <ActivityIndicator
                  size="small"
                  color={colors.foreground}
                  style={{ marginRight: 6 }}
                />
              ) : (
                <Ionicons
                  name="navigate-outline"
                  size={18}
                  color={colors.foreground}
                  style={{ marginRight: 6 }}
                />
              )}
              <Text
                style={[
                  styles.previewButtonTextSecondary,
                  { color: colors.foreground },
                ]}
              >
                {exportGpxLoading ? "Snapping to roads…" : "Export GPX"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.previewButton,
                styles.previewButtonSecondary,
                { borderColor: colors.border },
              ]}
              onPress={handleExportGpxPerVehicle}
              activeOpacity={0.8}
              disabled={exportGpxLoading}
            >
              {exportGpxLoading ? (
                <ActivityIndicator
                  size="small"
                  color={colors.foreground}
                  style={{ marginRight: 6 }}
                />
              ) : (
                <Ionicons
                  name="archive-outline"
                  size={18}
                  color={colors.foreground}
                  style={{ marginRight: 6 }}
                />
              )}
              <Text
                style={[
                  styles.previewButtonTextSecondary,
                  { color: colors.foreground },
                ]}
              >
                {exportGpxLoading ? "Snapping to roads…" : "GPX per vehicle"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.previewButton,
                styles.previewButtonSecondary,
                { borderColor: colors.border },
              ]}
              onPress={handleSaveAsCurrentRoute}
              activeOpacity={0.8}
            >
              <Ionicons
                name="home-outline"
                size={18}
                color={colors.foreground}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.previewButtonTextSecondary,
                  { color: colors.foreground },
                ]}
              >
                Save to Home
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.previewButton,
                { backgroundColor: cyan, borderColor: magenta + "99" },
              ]}
              onPress={handlePreviewRoute}
              activeOpacity={0.8}
              disabled={previewLoading}
            >
              {previewLoading ? (
                <ActivityIndicator
                  size="small"
                  color="#0a0a0a"
                  style={{ marginRight: 6 }}
                />
              ) : (
                <Ionicons
                  name="map-outline"
                  size={18}
                  color="#0a0a0a"
                  style={{ marginRight: 6 }}
                />
              )}
              <Text style={styles.previewButtonText}>
                {previewLoading ? "Snapping to roads…" : "Preview on map"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Extra padding at bottom for keyboard */}
      <View style={styles.bottomPadding} />
    </>
  );

  // Use keyboard-controller's KeyboardAvoidingView on native (avoids setCenter recursion / runloop hang on iOS).
  // On web, no keyboard avoiding needed.
  if (Platform.OS === "web") {
    return nestedInScrollView ? (
      fillScreen ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            styles.scrollContentFill,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={styles.nestedContent}>{content}</View>
      )
    ) : (
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >
        {content}
      </ScrollView>
    );
  }

  // On iOS: do NOT use KeyboardAvoidingView. It triggers layout (padding/height) on keyboard
  // frame updates, which can block the main thread and make typing lag or drop keystrokes.
  // Rely on ScrollView + deferred scroll on focus instead; user can scroll if keyboard covers content.
  // On Android: use KeyboardAvoidingView with "height" for normal behavior.
  if (Platform.OS === "ios") {
    return nestedInScrollView ? (
      <View style={styles.nestedContent}>{content}</View>
    ) : (
      <View style={styles.keyboardAvoid}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {content}
        </ScrollView>
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      style={nestedInScrollView ? undefined : styles.keyboardAvoid}
      behavior="height"
      keyboardVerticalOffset={0}
    >
      {nestedInScrollView ? (
        <View style={styles.nestedContent}>{content}</View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {content}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  scrollContentFill: {
    flexGrow: 1,
    flexDirection: "column",
  },
  nestedContent: {
    paddingBottom: 20,
  },
  cardFill: {
    flex: 1,
    marginHorizontal: 0,
    minHeight: 0,
  },
  card: {
    margin: 16,
    padding: 16,
    borderRadius: 10,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  sectionHeaderSmall: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  segmentedRow: {
    flexDirection: "row",
    gap: 8,
  },
  segmentedOption: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  segmentedLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
  },
  vehicleRow: {
    flexDirection: "row",
    gap: 10,
  },
  vehicleInputWrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  vehicleLabel: {
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  vehicleInput: {
    fontSize: 16,
    padding: 0,
    minHeight: 36,
  },
  advancedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    marginTop: 12,
    borderBottomWidth: 1,
  },
  advancedBody: {
    paddingVertical: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  depotInput: {
    minHeight: 44,
  },
  travelSpeedInput: {
    maxWidth: 80,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  pickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  optimizeButton: {
    flex: 3,
    flexDirection: "row",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  optimizeButtonText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  pickerModal: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 36,
  },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  pickerOptionText: {
    fontSize: 15,
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  valhallaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  checkmark: {
    width: 22,
    height: 22,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  checkmarkText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  valhallaText: {
    fontSize: 15,
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    fontFamily: "monospace",
  },
  buttonRow: {
    flexDirection: "row",
    marginTop: 16,
    gap: 12,
  },
  runButton: {
    flex: 3,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.6,
  },
  runButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  clearButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  clearButtonText: {
    fontSize: 17,
    fontWeight: "500",
  },
  resultCard: {
    margin: 16,
    marginTop: 0,
    padding: 16,
    borderRadius: 10,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  stat: {
    fontSize: 14,
  },
  routeBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderBottomWidth: 1,
  },
  routeLabel: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  stopNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  stopNumberText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  stopInfo: {
    flex: 1,
  },
  stopLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  stopCoords: {
    fontSize: 13,
    marginTop: 2,
  },
  previewButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  previewButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 0,
  },
  previewButtonSecondary: {
    backgroundColor: "transparent",
  },
  previewButtonText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "700",
  },
  previewButtonTextSecondary: {
    fontSize: 15,
    fontWeight: "600",
  },
  nominatimResults: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  nominatimRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  bottomPadding: {
    height: 150,
  },
});
