/**
 * Extract tab content: draw polygon on CartoDB basemap → preview roads / extract & process
 * via webovertureextract WebSocket → download GeoJSON / graph.
 *
 * Web: full MapLibre GL JS + @mapbox/mapbox-gl-draw; Preview Roads uses same backend as Extract.
 * Native: simplified polygon drawing + WebSocket extraction.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Dimensions,
  Linking,
  ScrollView,
  Alert,
  TextInput,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useColors } from "@/hooks/use-colors";
import { Fonts, glassStyle } from "@/lib/_core/theme";
import {
  connectAndExtract,
  computePolygonMetrics,
  coordsToPolygonFeature,
  httpGeoJSONUrl,
  httpDownloadUrl,
  type ExtractionProgress,
  type ExtractionStage,
  type ExtractionStats,
  type MeasurementMetrics,
} from "@/lib/overtureExtractService";
import { getElevationForPoints } from "@/services/googleElevationService";
import {
  partitionZonesFromGeoJSON,
  type GeoJSONFeatureCollection,
} from "@/services/overtureOptimizerService";
import { useZonesStore } from "@/stores/zonesStore";
import { extractFromDownloadedData } from "@/lib/offline-extract";
import { ExtractConnectionStatus } from "@/components/extract/ExtractConnectionStatus";
import { usePluginStore } from "@/stores/pluginStore";
import { extractOSM } from "@/lib/plugins/osm-extraction/osmExtractionService";
import { toOSMXML } from "@/lib/exportService";
import type { OverpassElement } from "@/lib/overpassService";

// ---------------------------------------------------------------------------
// Web-only lazy imports (MapLibre GL JS, mapbox-gl-draw, DuckDB WASM)
// ---------------------------------------------------------------------------
let maplibregl: typeof import("maplibre-gl") | null = null;
let MapboxDraw: any = null;

if (Platform.OS === "web" && typeof window !== "undefined") {
  try {
    maplibregl = require("maplibre-gl");
    // inject CSS
    if (typeof document !== "undefined") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
      document.head.appendChild(link);
      const drawLink = document.createElement("link");
      drawLink.rel = "stylesheet";
      drawLink.href =
        "https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-draw/v1.5.1/mapbox-gl-draw.css";
      document.head.appendChild(drawLink);
    }
  } catch {}
  try {
    MapboxDraw = require("@mapbox/mapbox-gl-draw");
    if (MapboxDraw && MapboxDraw.default) MapboxDraw = MapboxDraw.default;
  } catch {}
}

// ---------------------------------------------------------------------------
// DuckDB WASM singleton for preview
// ---------------------------------------------------------------------------
let duckdbInstance: any = null;
let duckdbConn: any = null;

async function initDuckDB() {
  if (duckdbConn) return duckdbConn;
  if (Platform.OS !== "web") return null;
  try {
    const duckdb = await import("@duckdb/duckdb-wasm");
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

    // Default to MVP bundle immediately to avoid waiting for network if offline
    let bundle: any = JSDELIVR_BUNDLES.mvp;

    try {
      const selected = await duckdb.selectBundle(JSDELIVR_BUNDLES);
      if (selected && selected.mainWorker) {
        bundle = selected;
      }
    } catch (e) {
      console.warn("[DuckDB] Bundle selection failed, using MVP bundle:", e);
    }

    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    duckdbInstance = db;
    duckdbConn = await db.connect();
    // Load spatial + httpfs
    await duckdbConn.query("INSTALL spatial; LOAD spatial;");
    await duckdbConn.query("INSTALL httpfs; LOAD httpfs;");
    return duckdbConn;
  } catch (e) {
    console.warn("[DuckDB] Init failed:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Web-safe alert (Alert.alert is no-op on web)
// ---------------------------------------------------------------------------
function alertUser(title: string, message?: string) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

// ---------------------------------------------------------------------------
// Stage badge colors
// ---------------------------------------------------------------------------
const STAGE_COLORS: Record<ExtractionStage, string> = {
  connecting: "#6b7280",
  downloading: "#3b82f6",
  clipping: "#f59e0b",
  building_graph: "#8b5cf6",
  complete: "#22c55e",
  error: "#ef4444",
};

// ---------------------------------------------------------------------------
// City presets
// ---------------------------------------------------------------------------
const CITY_PRESETS = [
  {
    name: "Montreal",
    center: [-73.5673, 45.5017] as [number, number],
    zoom: 12,
  },
  {
    name: "Quebec City",
    center: [-71.2074, 46.8139] as [number, number],
    zoom: 12,
  },
  {
    name: "Toronto",
    center: [-79.3832, 43.6532] as [number, number],
    zoom: 12,
  },
  { name: "Ottawa", center: [-75.6972, 45.4215] as [number, number], zoom: 12 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ExtractContent() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  // Map ref
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const drawRef = useRef<any>(null);

  // Polygon + measurements
  const [polygon, setPolygon] =
    useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null);
  const [metrics, setMetrics] = useState<MeasurementMetrics | null>(null);

  // Preview (DuckDB)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRoadCount, setPreviewRoadCount] = useState<number | null>(null);
  const [previewPointCount, setPreviewPointCount] = useState<number | null>(
    null,
  );

  // Extraction (WebSocket)
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [resultHash, setResultHash] = useState<string | null>(null);
  const [resultStats, setResultStats] = useState<ExtractionStats | null>(null);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);
  /** Stores GeoJSON graph from offline extraction (set when resultHash === "__offline__"). */
  const offlineGeoJSONRef = useRef<GeoJSON.FeatureCollection | null>(null);
  /** Stores raw Overpass elements from OSM extraction (set when resultHash === "__osm__"). */
  const osmRawElementsRef = useRef<OverpassElement[] | null>(null);

  // Dimensions
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Zone partitioning (send to Map → Zones)
  const [zoneTruckCount, setZoneTruckCount] = useState("2");
  const [zoneBalanceMetric, setZoneBalanceMetric] = useState<
    "time" | "distance"
  >("time");
  const [zoneName, setZoneName] = useState("");
  const [zonePartitionLoading, setZonePartitionLoading] = useState(false);
  const zonePartitionInProgressRef = useRef(false);
  const addSavedZone = useZonesStore((s) => s.addSavedZone);

  // Extract source: "overture" (default) or "osm" (Overpass API, requires osm-extraction plugin)
  const [extractSource, setExtractSource] = useState<"overture" | "osm">(
    "overture",
  );
  const osmExtractionEnabled = usePluginStore((s) =>
    s.isPluginEnabled("osm-extraction", false),
  );

  const dimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const handleContainerLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      if (w <= 0 || h <= 0) return;
      const prev = dimensionsRef.current;
      if (prev && prev.width === w && prev.height === h) return;
      dimensionsRef.current = { width: w, height: h };
      setDimensions({ width: w, height: h });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Init MapLibre + Draw (web only)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (Platform.OS !== "web" || !maplibregl || !mapContainerRef.current)
      return;
    if (mapRef.current) return; // already initialized

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          carto: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
              "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
          },
        },
        layers: [
          {
            id: "carto-tiles",
            type: "raster",
            source: "carto",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [-73.5673, 45.5017], // Montreal default
      zoom: 12,
    });

    mapRef.current = map;

    map.on("load", () => {
      // Add MapboxDraw
      if (MapboxDraw) {
        const draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: {},
          defaultMode: "draw_polygon",
          styles: [
            // Polygon fill
            {
              id: "gl-draw-polygon-fill",
              type: "fill",
              filter: [
                "all",
                ["==", "$type", "Polygon"],
                ["!=", "mode", "static"],
              ],
              paint: {
                "fill-color": "#3b82f6",
                "fill-outline-color": "#3b82f6",
                "fill-opacity": 0.15,
              },
            },
            // Polygon outline
            {
              id: "gl-draw-polygon-stroke-active",
              type: "line",
              filter: [
                "all",
                ["==", "$type", "Polygon"],
                ["!=", "mode", "static"],
              ],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#3b82f6",
                "line-dasharray": [0.2, 2],
                "line-width": 2,
              },
            },
            // Line
            {
              id: "gl-draw-line",
              type: "line",
              filter: [
                "all",
                ["==", "$type", "LineString"],
                ["!=", "mode", "static"],
              ],
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#3b82f6",
                "line-dasharray": [0.2, 2],
                "line-width": 2,
              },
            },
            // Vertex points
            {
              id: "gl-draw-point",
              type: "circle",
              filter: [
                "all",
                ["==", "$type", "Point"],
                ["==", "meta", "vertex"],
              ],
              paint: {
                "circle-radius": 5,
                "circle-color": "#fff",
                "circle-stroke-color": "#3b82f6",
                "circle-stroke-width": 2,
              },
            },
            // Midpoints
            {
              id: "gl-draw-point-mid",
              type: "circle",
              filter: [
                "all",
                ["==", "$type", "Point"],
                ["==", "meta", "midpoint"],
              ],
              paint: { "circle-radius": 3, "circle-color": "#3b82f6" },
            },
          ],
        });
        map.addControl(draw);
        drawRef.current = draw;

        map.on("draw.create", updatePolygon);
        map.on("draw.update", updatePolygon);
        map.on("draw.delete", () => {
          setPolygon(null);
          setMetrics(null);
          clearPreviewLayer();
          setPreviewRoadCount(null);
          setPreviewPointCount(null);
          setResultHash(null);
          setResultStats(null);
        });
      }

      // Add geolocate control
      map.addControl(
        new maplibregl!.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
        }),
        "top-right",
      );
      map.addControl(
        new maplibregl!.NavigationControl({
          showCompass: true,
          showZoom: true,
        }),
        "top-right",
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // Depend on primitive values so we don't re-run when dimensions object reference changes (e.g. same w/h from onLayout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions?.width, dimensions?.height]);

  // -------------------------------------------------------------------------
  // Polygon update handler
  // -------------------------------------------------------------------------
  const updatePolygon = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const data = draw.getAll();
    if (data.features.length === 0) {
      setPolygon(null);
      setMetrics(null);
      return;
    }
    const feat = data.features[
      data.features.length - 1
    ] as GeoJSON.Feature<GeoJSON.Polygon>;
    // Keep only the last polygon
    if (data.features.length > 1) {
      const ids = data.features.slice(0, -1).map((f: any) => f.id);
      ids.forEach((id: string) => draw.delete(id));
    }
    setPolygon(feat);
    try {
      setMetrics(computePolygonMetrics(feat));
    } catch {
      setMetrics(null);
    }
    // Clear previous results when polygon changes
    setResultHash(null);
    setResultStats(null);
    setPreviewRoadCount(null);
    setPreviewPointCount(null);
  }, []);

  // -------------------------------------------------------------------------
  // Clear preview layer
  // -------------------------------------------------------------------------
  const clearPreviewLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getLayer("preview-roads")) map.removeLayer("preview-roads");
    if (map.getSource("preview-roads")) map.removeSource("preview-roads");
  }, []);

  // -------------------------------------------------------------------------
  // Preview roads — Overture (WebSocket) or OSM (Overpass API)
  // -------------------------------------------------------------------------
  const previewRoads = useCallback(() => {
    if (!polygon || Platform.OS !== "web") return;
    if (extracting) return; // already running
    setPreviewLoading(true);
    setPreviewRoadCount(null);
    setPreviewPointCount(null);
    setExtracting(true);
    setProgress({ stage: "connecting", message: "Connecting..." });

    // OSM path — direct Overpass API call, no WebSocket
    if (extractSource === "osm") {
      extractOSM(polygon)
        .then((result) => {
          const count = result.geojson.features.length;
          setPreviewRoadCount(result.stats?.roads ?? count);
          setPreviewPointCount(count);
          const map = mapRef.current;
          if (map && count > 0) {
            clearPreviewLayer();
            map.addSource("preview-roads", {
              type: "geojson",
              data: result.geojson,
            });
            map.addLayer({
              id: "preview-roads",
              type: "line",
              source: "preview-roads",
              paint: {
                "line-color": "#ef4444",
                "line-width": 1.5,
                "line-opacity": 0.7,
              },
            });
          }
          setProgress({
            stage: "complete",
            message: `OSM preview: ${count} road segments`,
          });
        })
        .catch((err) => {
          setProgress({
            stage: "error",
            message: `OSM preview failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        })
        .finally(() => {
          setExtracting(false);
          setPreviewLoading(false);
        });
      return;
    }

    const handle = connectAndExtract(
      polygon,
      (p) => setProgress(p),
      (hash, stats) => {
        setResultHash(hash);
        setResultStats(stats);
        setExtracting(false);
        setProgress(null);
        setPreviewRoadCount(stats.roads);
        setPreviewPointCount(stats.points ?? stats.nodes ?? 0);
        // Fetch GeoJSON from backend and draw on map
        fetch(httpGeoJSONUrl(hash))
          .then((res) => {
            if (!res.ok)
              throw new Error(
                `GeoJSON fetch failed: ${res.status} ${res.statusText}`,
              );
            return res.json();
          })
          .then((geojson: GeoJSON.FeatureCollection) => {
            const count = geojson?.features?.length ?? 0;
            console.log(
              "[Preview] GeoJSON loaded:",
              count,
              "features from",
              httpGeoJSONUrl(hash),
            );
            const map = mapRef.current;
            if (map && count > 0) {
              clearPreviewLayer();
              map.addSource("preview-roads", {
                type: "geojson",
                data: geojson,
              });
              map.addLayer({
                id: "preview-roads",
                type: "line",
                source: "preview-roads",
                paint: {
                  "line-color": "#ef4444",
                  "line-width": 1.5,
                  "line-opacity": 0.7,
                },
              });
            } else if (count === 0) {
              console.warn(
                "[Preview] Extract returned 0 features — nothing to draw. Rebuild extract image if using Docker.",
              );
            }
          })
          .catch((e) => {
            console.error(
              "[Preview] Fetch/draw failed:",
              e,
              "URL:",
              httpGeoJSONUrl(hash),
            );
          })
          .finally(() => setPreviewLoading(false));
      },
      (err) => {
        setExtracting(false);
        setProgress(null);
        setPreviewLoading(false);
        console.error("[Preview]", err);
      },
    );
    cancelRef.current = handle;
  }, [polygon, extracting, extractSource, clearPreviewLayer]);

  // -------------------------------------------------------------------------
  // Extract & process — Overture (WebSocket) or OSM (Overpass API)
  // -------------------------------------------------------------------------
  const extractAndProcess = useCallback(() => {
    if (!polygon) return;
    setExtracting(true);
    setResultHash(null);
    setResultStats(null);
    offlineGeoJSONRef.current = null;
    osmRawElementsRef.current = null;
    setProgress({ stage: "connecting", message: "Connecting..." });

    // OSM path — direct Overpass API call, no WebSocket
    if (extractSource === "osm") {
      extractOSM(polygon)
        .then((result) => {
          const count = result.geojson.features.length;
          if (count === 0) {
            setProgress({
              stage: "error",
              message: "OSM returned no road features for this area.",
            });
            return;
          }
          offlineGeoJSONRef.current = result.geojson;
          osmRawElementsRef.current = result.rawElements;
          setResultHash("__osm__");
          const st = result.stats ?? {
            roads: count,
            points: count,
            nodes: count,
            edges: count,
          };
          setResultStats({
            roads: st.roads,
            points: st.points,
            nodes: st.nodes,
            edges: st.edges,
          });
          setPreviewRoadCount(result.stats?.roads ?? count);
          setPreviewPointCount(count);
          const map = mapRef.current;
          if (map && Platform.OS === "web") {
            clearPreviewLayer();
            map.addSource("preview-roads", {
              type: "geojson",
              data: result.geojson,
            });
            map.addLayer({
              id: "preview-roads",
              type: "line",
              source: "preview-roads",
              paint: {
                "line-color": "#8b5cf6",
                "line-width": 2,
                "line-opacity": 0.8,
              },
            });
          }
          setProgress({
            stage: "complete",
            message: `OSM: ${count} road segments`,
            percent: 100,
          });
        })
        .catch((err) => {
          setProgress({
            stage: "error",
            message: `OSM extraction failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        })
        .finally(() => setExtracting(false));
      return;
    }

    const handle = connectAndExtract(
      polygon,
      (p) => {
        console.log(
          `[Extract] Progress: ${p.stage} ${p.percent}% - ${p.message}`,
        );
        setProgress(p);
      },
      (hash, stats) => {
        console.log("[Extract] Success!", hash, stats);
        setResultHash(hash);
        setResultStats(stats);
        setPreviewRoadCount(stats.roads);
        setPreviewPointCount(stats.points ?? stats.nodes ?? 0);
        const geoUrl = httpGeoJSONUrl(hash);
        console.log("[Extract] Fetching GeoJSON from", geoUrl);
        fetch(geoUrl)
          .then((res) => {
            if (!res.ok) {
              throw new Error(
                `GeoJSON fetch failed: ${res.status} ${res.statusText}`,
              );
            }
            return res.json();
          })
          .then((geojson: GeoJSON.FeatureCollection) => {
            const count = geojson?.features?.length ?? 0;
            console.log("[Extract] GeoJSON loaded:", count, "features");
            if (count === 0) {
              setProgress({
                stage: "error",
                message:
                  "Extract returned no road data (0 features). If using Docker, rebuild the extract image: docker compose build extract && docker compose up -d.",
              });
              return;
            }
            // Draw extracted roads on the map
            const map = mapRef.current;
            if (map && Platform.OS === "web") {
              clearPreviewLayer();
              map.addSource("preview-roads", {
                type: "geojson",
                data: geojson,
              });
              map.addLayer({
                id: "preview-roads",
                type: "line",
                source: "preview-roads",
                paint: {
                  "line-color": "#8b5cf6",
                  "line-width": 2,
                  "line-opacity": 0.8,
                },
              });
            }
            setProgress(null);
          })
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              "[Extract] GeoJSON fetch failed:",
              msg,
              "URL:",
              geoUrl,
            );
            setProgress({
              stage: "error",
              message: `Could not load result: ${msg}. Check backend proxy and extract service (see console for URL).`,
            });
          })
          .finally(() => setExtracting(false));
      },
      (err) => {
        // WebSocket failed — try offline data before showing error
        console.warn("[Extract] WebSocket failed:", err);

        // On web, offline extraction is not supported/mocked. Show error immediately.
        if (Platform.OS === "web") {
          console.error(
            "[Extract] Web extraction failed. Check console for WS connection details.",
          );
          setProgress({
            stage: "error",
            message: `Extraction failed: ${err}\n(See browser console for details)`,
          });
          setExtracting(false);
          return;
        }

        setProgress({
          stage: "building_graph",
          message: "Trying offline data…",
        });
        const polyGeom = polygon.geometry as GeoJSON.Polygon;
        (async () => {
          try {
            console.log("[Extract] Attempting offline extraction...");
            const result = await extractFromDownloadedData(polyGeom, (p) => {
              const stage = p.phase.toLowerCase().includes("graph")
                ? "building_graph"
                : p.phase.toLowerCase().includes("clip") ||
                    p.phase.toLowerCase().includes("tile")
                  ? "clipping"
                  : "downloading";
              console.log(`[Extract] Offline progress: ${p.phase}`);
              setProgress({
                stage,
                message: p.phase,
                percent:
                  p.done != null && p.total
                    ? Math.round((p.done / p.total) * 100)
                    : undefined,
              });
            });
            if (result) {
              offlineGeoJSONRef.current = result.graphGeojson as unknown as GeoJSON.FeatureCollection;
              setResultHash("__offline__");
              setResultStats({
                points: result.stats.nodes,
                roads: result.stats.roads,
                nodes: result.stats.nodes,
                edges: result.stats.edges,
                segmentsLengthKm: result.stats.segmentsLengthKm,
              });
              setProgress({
                stage: "complete",
                message: `Offline (${result.source}) — ${result.stats.nodes} nodes, ${result.stats.edges} edges`,
                percent: 100,
              });
            } else {
              console.warn("[Extract] Offline extraction returned no result");
              setProgress({
                stage: "error",
                message: `${err} — No offline data for this area. Download a region in Settings → Offline Maps.`,
              });
            }
          } catch (e2) {
            console.error("[Extract] Offline extraction failed:", e2);
            setProgress({ stage: "error", message: String(e2) });
          } finally {
            setExtracting(false);
          }
        })();
      },
      "roads",
    );
    cancelRef.current = handle;
  }, [polygon, extractSource, clearPreviewLayer]);

  const cancelExtraction = useCallback(() => {
    cancelRef.current?.cancel();
    setExtracting(false);
    setProgress(null);
  }, []);

  // -------------------------------------------------------------------------
  // Download handlers
  // -------------------------------------------------------------------------
  const downloadGeoJSON = useCallback(() => {
    if (!resultHash) return;
    if (
      (resultHash === "__offline__" || resultHash === "__osm__") &&
      offlineGeoJSONRef.current
    ) {
      try {
        const blob = new Blob([JSON.stringify(offlineGeoJSONRef.current)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          resultHash === "__osm__"
            ? "osm-extract.geojson"
            : "offline-extract.geojson";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {}
      return;
    }
    if (Platform.OS === "web") {
      window.open(httpDownloadUrl(resultHash), "_blank");
    } else {
      Linking.openURL(httpDownloadUrl(resultHash));
    }
  }, [resultHash]);

  const downloadOSM = useCallback(() => {
    if (!osmRawElementsRef.current || osmRawElementsRef.current.length === 0)
      return;
    if (!polygon) return;
    try {
      const ring = polygon.geometry.coordinates[0];
      const lats = ring.map(([, lat]) => lat);
      const lons = ring.map(([lon]) => lon);
      const bounds = {
        minLat: Math.min(...lats),
        minLon: Math.min(...lons),
        maxLat: Math.max(...lats),
        maxLon: Math.max(...lons),
      };
      const xml = toOSMXML(osmRawElementsRef.current, bounds);
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "osm-extract.osm";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {}
  }, [polygon]);

  // -------------------------------------------------------------------------
  // Zone partitioning: send to Map → Zones dropdown (uses extracted GeoJSON after Extract & Process)
  // -------------------------------------------------------------------------
  const sendToZones = useCallback(async () => {
    if (zonePartitionInProgressRef.current) return;
    if (!polygon) return;
    const ring = polygon.geometry.coordinates[0];
    if (!ring || ring.length < 3) {
      alertUser("Zone partitioning", "Polygon must have at least 3 vertices.");
      return;
    }
    if (!resultHash) {
      alertUser(
        "Run Extract & Process first",
        "Zone partitioning uses the road graph from your extract. Run Extract & Process, then tap Partition & send to Zones.",
      );
      return;
    }
    zonePartitionInProgressRef.current = true;
    setZonePartitionLoading(true);
    const truckCount = Math.max(
      1,
      Math.min(12, parseInt(zoneTruckCount, 10) || 2),
    );
    const polygonLatLon: [number, number][] = ring.map(([lng, lat]) => [
      lat,
      lng,
    ]);
    try {
      let geojson: { type: string; features: unknown[] };
      if (
        (resultHash === "__offline__" || resultHash === "__osm__") &&
        offlineGeoJSONRef.current
      ) {
        geojson = offlineGeoJSONRef.current as {
          type: string;
          features: unknown[];
        };
      } else {
        const res = await fetch(httpGeoJSONUrl(resultHash!));
        if (!res.ok) throw new Error(`Failed to fetch GeoJSON (${res.status})`);
        geojson = (await res.json()) as { type: string; features: unknown[] };
      }
      if (!geojson?.features?.length)
        throw new Error("Extract result has no road features.");
      const zoneGeojson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: geojson.features as GeoJSONFeatureCollection["features"],
      };
      const { zones } = await partitionZonesFromGeoJSON({
        geojson: zoneGeojson,
        truck_count: truckCount,
        balance_metric: zoneBalanceMetric,
      });
      const name =
        zoneName.trim() || `Zones ${new Date().toLocaleDateString()}`;
      addSavedZone({
        name,
        polygon: polygonLatLon,
        zones,
        truck_count: truckCount,
        balance_metric: zoneBalanceMetric,
      });
      alertUser(
        "Sent to Zones",
        "Zone partition saved. Open the Map tab → sidebar (☰) → Zones to view and display zones on the map.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const is404Or503 = /404|503/.test(msg);
      alertUser(
        "Zone partitioning failed",
        is404Or503
          ? "The optimizer backend does not have the partition-from-geojson endpoint yet, or it is unavailable (503). Redeploy the optimizer from this repo's backend/ folder so it includes POST /api/zones/partition-from-geojson."
          : msg,
      );
    } finally {
      zonePartitionInProgressRef.current = false;
      setZonePartitionLoading(false);
    }
  }, [
    polygon,
    resultHash,
    zoneTruckCount,
    zoneBalanceMetric,
    zoneName,
    addSavedZone,
  ]);

  // -------------------------------------------------------------------------
  // Clear polygon
  // -------------------------------------------------------------------------
  const clearPolygon = useCallback(() => {
    const draw = drawRef.current;
    if (draw) draw.deleteAll();
    setPolygon(null);
    setMetrics(null);
    clearPreviewLayer();
    setPreviewRoadCount(null);
    setPreviewPointCount(null);
    setResultHash(null);
    setResultStats(null);
    offlineGeoJSONRef.current = null;
    osmRawElementsRef.current = null;
    setProgress(null);
  }, [clearPreviewLayer]);

  // -------------------------------------------------------------------------
  // City preset fly-to
  // -------------------------------------------------------------------------
  const flyToPreset = useCallback((center: [number, number], zoom: number) => {
    mapRef.current?.flyTo({ center, zoom, duration: 1500 });
  }, []);

  // -------------------------------------------------------------------------
  // Start new drawing
  // -------------------------------------------------------------------------
  const startDrawing = useCallback(() => {
    const draw = drawRef.current;
    if (draw) {
      draw.deleteAll();
      draw.changeMode("draw_polygon");
    }
    setPolygon(null);
    setMetrics(null);
    clearPreviewLayer();
    setPreviewRoadCount(null);
    setPreviewPointCount(null);
    setResultHash(null);
    setResultStats(null);
    offlineGeoJSONRef.current = null;
    osmRawElementsRef.current = null;
    setProgress(null);
  }, [clearPreviewLayer]);

  // -------------------------------------------------------------------------
  // Native fallback
  // -------------------------------------------------------------------------
  if (Platform.OS !== "web") {
    return <NativeExtractFallback colors={colors} insets={insets} />;
  }

  // -------------------------------------------------------------------------
  // Web render
  // -------------------------------------------------------------------------
  const stageColor = progress ? STAGE_COLORS[progress.stage] : "#6b7280";

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={handleContainerLayout}
    >
      {/* Full-screen map */}
      <View style={styles.mapContainer}>
        <div
          ref={mapContainerRef}
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        />

        {/* Top-left: Measurements card */}
        {metrics && (
          <View
            style={[
              styles.metricsCard,
              glassStyle,
              {
                backgroundColor: colors.surface + "ee",
                borderColor: colors.border,
                top: 12 + (insets?.top ?? 0),
              },
            ]}
          >
            <Text style={[styles.metricsLabel, { color: colors.muted }]}>
              Area
            </Text>
            <Text
              style={[
                styles.metricsValue,
                { color: colors.text, fontFamily: Fonts?.mono },
              ]}
            >
              {metrics.areaKm2 < 1
                ? `${(metrics.areaKm2 * 1000).toFixed(0)} m²`
                : `${metrics.areaKm2.toFixed(2)} km²`}
            </Text>
            <Text
              style={[
                styles.metricsLabel,
                { color: colors.muted, marginTop: 4 },
              ]}
            >
              Perimeter
            </Text>
            <Text
              style={[
                styles.metricsValue,
                { color: colors.text, fontFamily: Fonts?.mono },
              ]}
            >
              {metrics.perimeterKm.toFixed(2)} km
            </Text>
          </View>
        )}

        {/* Top-right: City presets */}
        <View
          style={[styles.presetsContainer, { top: 12 + (insets?.top ?? 0) }]}
        >
          {CITY_PRESETS.map((p) => (
            <TouchableOpacity
              key={p.name}
              style={[
                styles.presetChip,
                {
                  backgroundColor: colors.surface + "ee",
                  borderColor: colors.border,
                },
              ]}
              onPress={() => flyToPreset(p.center, p.zoom)}
            >
              <Text style={[styles.presetText, { color: colors.text }]}>
                {p.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Bottom-left: Draw/Clear toolbar */}
        <View style={[styles.drawToolbar, { bottom: polygon ? 260 : 20 }]}>
          <TouchableOpacity
            style={[styles.toolButton, { backgroundColor: "#3b82f6" }]}
            onPress={startDrawing}
          >
            <MaterialCommunityIcons
              name="pencil-outline"
              size={18}
              color="#fff"
            />
            <Text style={styles.toolButtonText}>Draw</Text>
          </TouchableOpacity>
          {polygon && (
            <TouchableOpacity
              style={[
                styles.toolButton,
                { backgroundColor: colors.muted + "88", marginLeft: 8 },
              ]}
              onPress={clearPolygon}
            >
              <MaterialCommunityIcons name="close" size={18} color="#fff" />
              <Text style={styles.toolButtonText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Bottom sheet (visible when polygon exists) */}
      {polygon && (
        <View
          style={[
            styles.bottomSheet,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              maxHeight: resultHash ? 380 : 280,
            },
          ]}
        >
          <ScrollView
            style={styles.bottomSheetScroll}
            showsVerticalScrollIndicator={false}
          >
            <ExtractConnectionStatus />
            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <StatBox
                label="Points"
                value={
                  previewPointCount != null ? String(previewPointCount) : "—"
                }
                colors={colors}
              />
              <StatBox
                label="Linestrings"
                value={
                  previewRoadCount != null ? String(previewRoadCount) : "—"
                }
                colors={colors}
              />
              <StatBox
                label="Nodes"
                value={
                  resultStats?.nodes != null ? String(resultStats.nodes) : "—"
                }
                colors={colors}
              />
              <StatBox
                label="Edges"
                value={
                  resultStats?.edges != null ? String(resultStats.edges) : "—"
                }
                colors={colors}
              />
            </View>

            {/* Progress */}
            {progress && (
              <View style={styles.progressSection}>
                <View style={styles.progressHeader}>
                  <View
                    style={[
                      styles.stageBadge,
                      { backgroundColor: stageColor + "22" },
                    ]}
                  >
                    <View
                      style={[styles.stageDot, { backgroundColor: stageColor }]}
                    />
                    <Text style={[styles.stageText, { color: stageColor }]}>
                      {progress.stage.replace("_", " ")}
                    </Text>
                  </View>
                  <Text
                    style={[styles.progressMessage, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    {progress.message}
                  </Text>
                </View>
                {progress.percent != null && (
                  <View
                    style={[
                      styles.progressBarBg,
                      { backgroundColor: colors.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(100, progress.percent)}%`,
                          backgroundColor: stageColor,
                        },
                      ]}
                    />
                  </View>
                )}
              </View>
            )}

            {/* Downloads — keep high in sheet; panel maxHeight is limited */}
            {resultHash && (
              <View style={[styles.actionsRow, { marginTop: 4 }]}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: "#22c55e" }]}
                  onPress={downloadGeoJSON}
                >
                  <MaterialCommunityIcons
                    name="download"
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.actionBtnText}>Download GeoJSON</Text>
                </TouchableOpacity>
                {resultHash === "__osm__" &&
                  (osmRawElementsRef.current?.length ?? 0) > 0 && (
                    <TouchableOpacity
                      style={[
                        styles.actionBtn,
                        { backgroundColor: "#16a34a" },
                      ]}
                      onPress={downloadOSM}
                    >
                      <MaterialCommunityIcons
                        name="download"
                        size={16}
                        color="#fff"
                      />
                      <Text style={styles.actionBtnText}>Download OSM</Text>
                    </TouchableOpacity>
                  )}
              </View>
            )}

            {/* Source toggle (visible only when osm-extraction plugin is enabled) */}
            {osmExtractionEnabled && (
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  marginBottom: 10,
                  alignItems: "center",
                }}
              >
                <Text style={[styles.metricsLabel, { color: colors.muted }]}>
                  Source:
                </Text>
                <TouchableOpacity
                  onPress={() => setExtractSource("overture")}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 6,
                    backgroundColor:
                      extractSource === "overture" ? "#3b82f6" : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color:
                        extractSource === "overture" ? "#fff" : colors.text,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    Overture
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setExtractSource("osm")}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 6,
                    backgroundColor:
                      extractSource === "osm" ? "#f97316" : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: extractSource === "osm" ? "#fff" : colors.text,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    OSM (Overpass)
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Action buttons */}
            <View style={styles.actionsRow}>
              {Platform.OS === "web" && (
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: "#3b82f6",
                      opacity: previewLoading ? 0.6 : 1,
                    },
                  ]}
                  onPress={previewRoads}
                  disabled={previewLoading || extracting}
                >
                  {previewLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialCommunityIcons
                      name="eye-outline"
                      size={16}
                      color="#fff"
                    />
                  )}
                  <Text style={styles.actionBtnText}>Preview Roads</Text>
                </TouchableOpacity>
              )}
              {!extracting ? (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: "#8b5cf6" }]}
                  onPress={extractAndProcess}
                >
                  <MaterialCommunityIcons
                    name="cloud-download-outline"
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.actionBtnText}>Extract & Process</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: "#ef4444" }]}
                  onPress={cancelExtraction}
                >
                  <MaterialCommunityIcons
                    name="close-circle-outline"
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.actionBtnText}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Zone partitioning — send to Map → Zones */}
            <View
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <Text
                style={[
                  styles.metricsLabel,
                  { color: colors.muted, marginBottom: 8 },
                ]}
              >
                Zone partitioning → send to Zones (Map sidebar)
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <Text style={[styles.metricsLabel, { color: colors.muted }]}>
                  Trucks
                </Text>
                <TextInput
                  style={[
                    styles.vehicleInput,
                    {
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      minWidth: 48,
                      color: colors.text,
                    },
                  ]}
                  value={zoneTruckCount}
                  onChangeText={setZoneTruckCount}
                  keyboardType="number-pad"
                  placeholder="2"
                  placeholderTextColor={colors.muted}
                />
                <TouchableOpacity
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor:
                        zoneBalanceMetric === "time"
                          ? "#8b5cf6"
                          : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setZoneBalanceMetric("time")}
                >
                  <Text
                    style={{
                      color:
                        zoneBalanceMetric === "time" ? "#fff" : colors.text,
                      fontSize: 13,
                    }}
                  >
                    Time
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor:
                        zoneBalanceMetric === "distance"
                          ? "#8b5cf6"
                          : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setZoneBalanceMetric("distance")}
                >
                  <Text
                    style={{
                      color:
                        zoneBalanceMetric === "distance" ? "#fff" : colors.text,
                      fontSize: 13,
                    }}
                  >
                    Distance
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    color: colors.text,
                    marginBottom: 8,
                  },
                ]}
                placeholder="Zone name (optional)"
                placeholderTextColor={colors.muted}
                value={zoneName}
                onChangeText={setZoneName}
              />
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: "#22c55e",
                    opacity: zonePartitionLoading ? 0.7 : 1,
                  },
                ]}
                onPress={sendToZones}
                disabled={zonePartitionLoading}
                {...(Platform.OS === "web"
                  ? {
                      onClick: (e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!zonePartitionLoading) sendToZones();
                      },
                    }
                  : {})}
              >
                {zonePartitionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialCommunityIcons
                    name="vector-polygon"
                    size={16}
                    color="#fff"
                  />
                )}
                <Text style={styles.actionBtnText}>
                  {zonePartitionLoading
                    ? "Partitioning…"
                    : "Partition & send to Zones"}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Polygon vertices and segment measurements */}
            {metrics && (
              <View style={{ marginTop: 8, marginBottom: 8 }}>
                <Text style={[styles.metricsLabel, { color: colors.muted }]}>
                  {polygon?.geometry.coordinates[0].length
                    ? polygon.geometry.coordinates[0].length - 1
                    : 0}{" "}
                  vertices — polygon ready
                </Text>
                {metrics.segments.length > 0 && (
                  <View style={{ marginTop: 4 }}>
                    <Text
                      style={[styles.metricsLabel, { color: colors.muted }]}
                    >
                      Segments
                    </Text>
                    {metrics.segments.slice(0, 4).map((seg, i) => (
                      <Text
                        key={i}
                        style={[
                          styles.segmentText,
                          { color: colors.text, fontFamily: Fonts?.mono },
                        ]}
                      >
                        Pt{seg.from} → Pt{seg.to}: {seg.distanceKm.toFixed(2)}{" "}
                        km
                      </Text>
                    ))}
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color: colors.primary,
                          fontFamily: Fonts?.mono,
                          marginTop: 4,
                          fontWeight: "600",
                        },
                      ]}
                    >
                      Total: {metrics.perimeterKm.toFixed(2)} km
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stat box sub-component
// ---------------------------------------------------------------------------
function StatBox({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof import("@/hooks/use-colors").useColors>;
}) {
  return (
    <View style={[styles.statBox, { borderColor: colors.border }]}>
      <Text
        style={[
          styles.statBoxValue,
          { color: colors.text, fontFamily: Fonts?.mono },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.statBoxLabel, { color: colors.muted }]}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Native fallback (simplified: no DuckDB, no MapLibre GL JS)
// Tap on map to place polygon vertices → close polygon → extract via WS.
// Uses the existing RouteMap which renders via react-native-maps with
// whatever base layer is configured (OSM tiles, Apple Maps, etc.).
// ---------------------------------------------------------------------------
function NativeExtractFallback({
  colors,
  insets,
}: {
  colors: ReturnType<typeof import("@/hooks/use-colors").useColors>;
  insets: { top: number; bottom: number };
}) {
  const [polygon, setPolygon] =
    useState<GeoJSON.Feature<GeoJSON.Polygon> | null>(null);
  const [metrics, setMetrics] = useState<MeasurementMetrics | null>(null);
  const [elevationLoading, setElevationLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [resultHash, setResultHash] = useState<string | null>(null);
  const [resultStats, setResultStats] = useState<ExtractionStats | null>(null);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [drawMode, setDrawMode] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [zoneTruckCount, setZoneTruckCount] = useState("2");
  const [zoneBalanceMetric, setZoneBalanceMetric] = useState<
    "time" | "distance"
  >("time");
  const [zoneName, setZoneName] = useState("");
  const [zonePartitionLoading, setZonePartitionLoading] = useState(false);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);
  const offlineGeoJSONRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const osmRawElementsRef = useRef<OverpassElement[] | null>(null);
  const addSavedZone = useZonesStore((s) => s.addSavedZone);

  const [dims, setDims] = useState<{ width: number; height: number } | null>(
    null,
  );

  // Lazy require to avoid pulling native modules at module scope on web
  const { RouteMap } = require("@/components/route-map") as { RouteMap: any };

  // Tap on map → add vertex
  const handleMapPress = useCallback(
    (lat: number, lon: number) => {
      if (!drawMode) return;
      setDrawPoints((prev) => [...prev, [lon, lat]]);
    },
    [drawMode],
  );

  // Build polygon from drawn points (auto-close when >= 3 vertices)
  useEffect(() => {
    if (drawPoints.length >= 3) {
      const feat = coordsToPolygonFeature(drawPoints);
      setPolygon(feat);
      try {
        const m = computePolygonMetrics(feat);
        setMetrics(m);

        // Fetch elevation for polygon vertices
        setElevationLoading(true);
        const points = drawPoints.map(([lon, lat]) => ({ lat, lon }));
        getElevationForPoints(points)
          .then((elevations) => {
            if (elevations.length > 0) {
              const elevationValues = elevations
                .map((e) => e.elevationMeters)
                .sort((a, b) => a - b);
              const min = elevationValues[0];
              const max = elevationValues[elevationValues.length - 1];
              const midIdx = Math.floor(elevationValues.length / 2);
              const median =
                elevationValues.length % 2 === 0
                  ? (elevationValues[midIdx - 1] + elevationValues[midIdx]) / 2
                  : elevationValues[midIdx];
              setMetrics((prev) =>
                prev ? { ...prev, elevation: { min, median, max } } : null,
              );
            }
          })
          .catch(() => {
            // Elevation fetch failed, continue without it
          })
          .finally(() => setElevationLoading(false));
      } catch {
        setMetrics(null);
      }
    } else {
      setPolygon(null);
      setMetrics(null);
    }
  }, [drawPoints]);

  const clearDraw = useCallback(() => {
    setDrawPoints([]);
    setPolygon(null);
    setMetrics(null);
    setProgress(null);
    setResultHash(null);
    setResultStats(null);
    setDrawMode(true);
    osmRawElementsRef.current = null;
  }, []);

  const extractAndProcess = useCallback(() => {
    if (!polygon) return;
    setDrawMode(false);
    setExtracting(true);
    setResultHash(null);
    setResultStats(null);
    offlineGeoJSONRef.current = null;
    osmRawElementsRef.current = null;

    const handle = connectAndExtract(
      polygon,
      (p) => setProgress(p),
      (hash, stats) => {
        setResultHash(hash);
        setResultStats(stats);
        const geoUrl = httpGeoJSONUrl(hash);
        fetch(geoUrl)
          .then((res) => {
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            return res.json();
          })
          .then((geojson: GeoJSON.FeatureCollection) => {
            const count = geojson?.features?.length ?? 0;
            if (count === 0) {
              setProgress({
                stage: "error",
                message:
                  "Extract returned no data (0 features). Rebuild extract image if using Docker.",
              });
            } else {
              setProgress({
                stage: "complete",
                message: `Extraction complete — ${stats.nodes} nodes, ${stats.edges} edges, ${count} features`,
                percent: 100,
              });
            }
          })
          .catch((e) => {
            setProgress({
              stage: "error",
              message: `Could not load result: ${e instanceof Error ? e.message : String(e)}`,
            });
          })
          .finally(() => setExtracting(false));
      },
      (err) => {
        // WebSocket failed — try offline data before showing error
        console.warn("[Extract] WebSocket failed, trying offline data:", err);
        setProgress({
          stage: "building_graph",
          message: "Trying offline data…",
        });
        const polyGeom = polygon.geometry as GeoJSON.Polygon;
        (async () => {
          try {
            const result = await extractFromDownloadedData(polyGeom, (p) => {
              const stage = p.phase.toLowerCase().includes("graph")
                ? "building_graph"
                : p.phase.toLowerCase().includes("clip") ||
                    p.phase.toLowerCase().includes("tile")
                  ? "clipping"
                  : "downloading";
              setProgress({
                stage,
                message: p.phase,
                percent:
                  p.done != null && p.total
                    ? Math.round((p.done / p.total) * 100)
                    : undefined,
              });
            });
            if (result) {
              offlineGeoJSONRef.current = result.graphGeojson as unknown as GeoJSON.FeatureCollection;
              setResultHash("__offline__");
              setResultStats({
                points: result.stats.nodes,
                roads: result.stats.roads,
                nodes: result.stats.nodes,
                edges: result.stats.edges,
                segmentsLengthKm: result.stats.segmentsLengthKm,
              });
              setProgress({
                stage: "complete",
                message: `Offline (${result.source}) — ${result.stats.nodes} nodes, ${result.stats.edges} edges`,
                percent: 100,
              });
            } else {
              setProgress({
                stage: "error",
                message: `${err} — No offline data for this area. Download a region in Settings → Offline Maps.`,
              });
            }
          } catch (e2) {
            setProgress({ stage: "error", message: String(e2) });
          } finally {
            setExtracting(false);
          }
        })();
      },
    );
    cancelRef.current = handle;
  }, [polygon]);

  const sendToZones = useCallback(async () => {
    if (!polygon) return;
    const ring = polygon.geometry.coordinates[0];
    if (!ring || ring.length < 3) {
      alertUser("Zone partitioning", "Polygon must have at least 3 vertices.");
      return;
    }
    if (!resultHash) {
      alertUser(
        "Run Extract & Process first",
        "Zone partitioning uses the road graph from your extract. Run Extract & Process, then tap Partition & send to Zones.",
      );
      return;
    }
    const truckCount = Math.max(
      1,
      Math.min(12, parseInt(zoneTruckCount, 10) || 2),
    );
    const polygonLatLon: [number, number][] = ring.map(([lng, lat]) => [
      lat,
      lng,
    ]);
    setZonePartitionLoading(true);
    try {
      let geojson: { type: string; features: unknown[] };
      if (
        (resultHash === "__offline__" || resultHash === "__osm__") &&
        offlineGeoJSONRef.current
      ) {
        geojson = offlineGeoJSONRef.current as {
          type: string;
          features: unknown[];
        };
      } else {
        const res = await fetch(httpGeoJSONUrl(resultHash!));
        if (!res.ok) throw new Error(`Failed to fetch GeoJSON (${res.status})`);
        geojson = (await res.json()) as { type: string; features: unknown[] };
      }
      if (!geojson?.features?.length)
        throw new Error("Extract result has no road features.");
      const zoneGeojson: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: geojson.features as GeoJSONFeatureCollection["features"],
      };
      const { zones } = await partitionZonesFromGeoJSON({
        geojson: zoneGeojson,
        truck_count: truckCount,
        balance_metric: zoneBalanceMetric,
      });
      const name =
        zoneName.trim() || `Zones ${new Date().toLocaleDateString()}`;
      addSavedZone({
        name,
        polygon: polygonLatLon,
        zones,
        truck_count: truckCount,
        balance_metric: zoneBalanceMetric,
      });
      alertUser(
        "Sent to Zones",
        "Zone partition saved. Open the Map tab → sidebar (☰) → Zones to view and display zones on the map.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const is404Or503 = /404|503/.test(msg);
      alertUser(
        "Zone partitioning failed",
        is404Or503
          ? "The optimizer backend does not have the partition-from-geojson endpoint yet, or it is unavailable (503). Redeploy the optimizer from this repo's backend/ folder so it includes POST /api/zones/partition-from-geojson."
          : msg,
      );
    } finally {
      setZonePartitionLoading(false);
    }
  }, [
    polygon,
    resultHash,
    zoneTruckCount,
    zoneBalanceMetric,
    zoneName,
    addSavedZone,
  ]);

  const stageColor = progress ? STAGE_COLORS[progress.stage] : "#6b7280";

  const mapHeight = dims
    ? dims.height * 0.55
    : Dimensions.get("window").height * 0.55;
  const mapWidth = dims?.width ?? Dimensions.get("window").width;

  // Pass polygon vertices as osmExtractionPoints so they render on the native map
  const extractionPoints = drawPoints.map(([lon, lat]) => ({
    latitude: lat,
    longitude: lon,
  }));

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w > 0 && h > 0) setDims({ width: w, height: h });
      }}
    >
      <View style={{ flex: 1, minHeight: 300 }}>
        <RouteMap
          collectionPoints={[]}
          height={mapHeight}
          width={mapWidth}
          onMapPress={handleMapPress}
          osmExtractionPolygon={
            extractionPoints.length >= 3 ? extractionPoints : undefined
          }
          osmExtractionPoints={extractionPoints}
        />
        {/* Polygon Info Panel - Google Earth style */}
        {drawMode && (
          <View
            style={[
              styles.polygonInfoPanel,
              {
                backgroundColor: colors.surface + "f5",
                borderColor: colors.border,
                top: 12 + insets.top,
              },
            ]}
          >
            <View style={styles.polygonInfoHeader}>
              <MaterialCommunityIcons
                name="vector-polygon"
                size={18}
                color={colors.primary}
              />
              <Text style={[styles.polygonInfoTitle, { color: colors.text }]}>
                {drawPoints.length < 3 ? "Draw Polygon" : "Polygon"}
              </Text>
              <Text style={[styles.vertexCount, { color: colors.muted }]}>
                {drawPoints.length}{" "}
                {drawPoints.length === 1 ? "vertex" : "vertices"}
              </Text>
            </View>

            {drawPoints.length < 3 ? (
              <Text style={[styles.polygonInfoHint, { color: colors.muted }]}>
                Tap map to place at least 3 vertices
              </Text>
            ) : metrics ? (
              <>
                <View style={styles.polygonMetricRow}>
                  <Text
                    style={[styles.polygonMetricLabel, { color: colors.muted }]}
                  >
                    Perimeter
                  </Text>
                  <Text
                    style={[
                      styles.polygonMetricValue,
                      { color: colors.text, fontFamily: Fonts?.mono },
                    ]}
                  >
                    {metrics.perimeterKm < 1
                      ? `${(metrics.perimeterKm * 1000).toFixed(2)} m`
                      : `${metrics.perimeterKm.toFixed(2)} km`}
                  </Text>
                </View>

                <View style={styles.polygonMetricRow}>
                  <Text
                    style={[styles.polygonMetricLabel, { color: colors.muted }]}
                  >
                    Area
                  </Text>
                  <Text
                    style={[
                      styles.polygonMetricValue,
                      { color: colors.text, fontFamily: Fonts?.mono },
                    ]}
                  >
                    {metrics.areaKm2 < 0.001
                      ? `${(metrics.areaKm2 * 1000000).toFixed(2)} m²`
                      : metrics.areaKm2 < 1
                        ? `${(metrics.areaKm2 * 1000000).toFixed(0)} m²`
                        : `${metrics.areaKm2.toFixed(2)} km²`}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.advancedToggle}
                  onPress={() => setShowAdvanced(!showAdvanced)}
                >
                  <Text
                    style={[
                      styles.advancedToggleText,
                      { color: colors.primary },
                    ]}
                  >
                    Advanced measurements
                  </Text>
                  <MaterialCommunityIcons
                    name={showAdvanced ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.primary}
                  />
                </TouchableOpacity>

                {showAdvanced && (
                  <View
                    style={[
                      styles.advancedSection,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <View style={styles.polygonMetricRow}>
                      <Text
                        style={[
                          styles.polygonMetricLabel,
                          { color: colors.muted },
                        ]}
                      >
                        Elevation estimate
                      </Text>
                      {elevationLoading ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.primary}
                        />
                      ) : metrics.elevation ? (
                        <Text
                          style={[
                            styles.polygonMetricValue,
                            {
                              color: colors.text,
                              fontFamily: Fonts?.mono,
                              fontSize: 11,
                            },
                          ]}
                        >
                          Min: {metrics.elevation.min.toFixed(1)}m | Med:{" "}
                          {metrics.elevation.median.toFixed(1)}m | Max:{" "}
                          {metrics.elevation.max.toFixed(1)}m
                        </Text>
                      ) : (
                        <Text
                          style={[
                            styles.polygonMetricValue,
                            { color: colors.muted, fontSize: 11 },
                          ]}
                        >
                          Not available
                        </Text>
                      )}
                    </View>
                  </View>
                )}
              </>
            ) : null}
          </View>
        )}
      </View>

      <ScrollView
        style={[
          styles.nativePanel,
          { backgroundColor: colors.surface, borderTopColor: colors.border },
        ]}
      >
        <ExtractConnectionStatus />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={[styles.nativeTitle, { color: colors.text }]}>
            Overture Extract
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {drawPoints.length > 0 && (
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: colors.muted + "66",
                    flex: 0,
                    paddingHorizontal: 12,
                  },
                ]}
                onPress={() => setDrawPoints((prev) => prev.slice(0, -1))}
              >
                <MaterialCommunityIcons name="undo" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Undo</Text>
              </TouchableOpacity>
            )}
            {drawPoints.length > 0 && (
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: "#ef4444",
                    flex: 0,
                    paddingHorizontal: 12,
                  },
                ]}
                onPress={clearDraw}
              >
                <MaterialCommunityIcons name="close" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {!polygon && (
          <Text
            style={[
              styles.nativeSubtitle,
              { color: colors.muted, marginTop: 4 },
            ]}
          >
            Tap on the map to place at least 3 vertices to draw a polygon.
          </Text>
        )}

        {progress && (
          <View style={[styles.progressSection, { marginTop: 12 }]}>
            <View style={styles.progressHeader}>
              <View
                style={[
                  styles.stageBadge,
                  { backgroundColor: stageColor + "22" },
                ]}
              >
                <View
                  style={[styles.stageDot, { backgroundColor: stageColor }]}
                />
                <Text style={[styles.stageText, { color: stageColor }]}>
                  {progress.stage.replace("_", " ")}
                </Text>
              </View>
              <Text style={[styles.progressMessage, { color: colors.muted }]}>
                {progress.message}
              </Text>
            </View>
            {progress.percent != null && (
              <View
                style={[
                  styles.progressBarBg,
                  { backgroundColor: colors.border },
                ]}
              >
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(100, progress.percent)}%`,
                      backgroundColor: stageColor,
                    },
                  ]}
                />
              </View>
            )}
          </View>
        )}

        {/* Stats grid - Linestrings = raw segments, Nodes = intersections, Edges = graph edges */}
        {resultStats && (
          <View style={[styles.statsGrid, { marginTop: 12 }]}>
            <StatBox
              label="Linestrings"
              value={resultStats.roads > 0 ? String(resultStats.roads) : "—"}
              colors={colors}
            />
            <StatBox
              label="Nodes"
              value={String(resultStats.nodes)}
              colors={colors}
            />
            <StatBox
              label="Edges"
              value={String(resultStats.edges)}
              colors={colors}
            />
          </View>
        )}

        {polygon && !extracting && (
          <>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: "#8b5cf6", marginTop: 12 },
              ]}
              onPress={extractAndProcess}
            >
              <MaterialCommunityIcons
                name="cloud-download-outline"
                size={16}
                color="#fff"
              />
              <Text style={styles.actionBtnText}>Extract & Process</Text>
            </TouchableOpacity>
            {metrics && (
              <View style={{ marginTop: 12 }}>
                <Text style={[styles.metricsLabel, { color: colors.muted }]}>
                  {drawPoints.length} vertices — polygon ready
                </Text>
                {metrics.segments.length > 0 && (
                  <View style={{ marginTop: 6 }}>
                    <Text
                      style={[styles.metricsLabel, { color: colors.muted }]}
                    >
                      Segments
                    </Text>
                    {metrics.segments.slice(0, 4).map((seg, i) => (
                      <Text
                        key={i}
                        style={[
                          styles.segmentText,
                          { color: colors.text, fontFamily: Fonts?.mono },
                        ]}
                      >
                        Pt{seg.from} → Pt{seg.to}: {seg.distanceKm.toFixed(2)}{" "}
                        km
                      </Text>
                    ))}
                    <Text
                      style={[
                        styles.segmentText,
                        {
                          color: colors.primary,
                          fontFamily: Fonts?.mono,
                          marginTop: 4,
                          fontWeight: "600",
                        },
                      ]}
                    >
                      Total: {metrics.perimeterKm.toFixed(2)} km
                    </Text>
                  </View>
                )}
              </View>
            )}
          </>
        )}

        {/* Zone partitioning — send to Map → Zones */}
        {polygon && (
          <View
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Text
              style={[
                styles.metricsLabel,
                { color: colors.muted, marginBottom: 8 },
              ]}
            >
              Zone partitioning → send to Zones (Map sidebar)
            </Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <Text style={[styles.metricsLabel, { color: colors.muted }]}>
                Trucks
              </Text>
              <TextInput
                style={[
                  styles.vehicleInput,
                  {
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    minWidth: 48,
                    color: colors.text,
                  },
                ]}
                value={zoneTruckCount}
                onChangeText={setZoneTruckCount}
                keyboardType="number-pad"
                placeholder="2"
                placeholderTextColor={colors.muted}
              />
              <TouchableOpacity
                style={[
                  styles.presetChip,
                  {
                    backgroundColor:
                      zoneBalanceMetric === "time"
                        ? "#8b5cf6"
                        : colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setZoneBalanceMetric("time")}
              >
                <Text
                  style={{
                    color: zoneBalanceMetric === "time" ? "#fff" : colors.text,
                    fontSize: 13,
                  }}
                >
                  Time
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.presetChip,
                  {
                    backgroundColor:
                      zoneBalanceMetric === "distance"
                        ? "#8b5cf6"
                        : colors.background,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setZoneBalanceMetric("distance")}
              >
                <Text
                  style={{
                    color:
                      zoneBalanceMetric === "distance" ? "#fff" : colors.text,
                    fontSize: 13,
                  }}
                >
                  Distance
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  color: colors.text,
                  marginBottom: 8,
                },
              ]}
              placeholder="Zone name (optional)"
              placeholderTextColor={colors.muted}
              value={zoneName}
              onChangeText={setZoneName}
            />
            <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  backgroundColor: "#22c55e",
                  opacity: zonePartitionLoading ? 0.7 : 1,
                },
              ]}
              onPress={sendToZones}
              disabled={zonePartitionLoading}
            >
              {zonePartitionLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons
                  name="vector-polygon"
                  size={16}
                  color="#fff"
                />
              )}
              <Text style={styles.actionBtnText}>
                {zonePartitionLoading
                  ? "Partitioning…"
                  : "Partition & send to Zones"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {extracting && (
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: "#ef4444", marginTop: 12 },
            ]}
            onPress={() => {
              cancelRef.current?.cancel();
              setExtracting(false);
            }}
          >
            <MaterialCommunityIcons
              name="close-circle-outline"
              size={16}
              color="#fff"
            />
            <Text style={styles.actionBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}

        {resultHash && (
          <View style={[styles.actionsRow, { marginTop: 12 }]}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#22c55e" }]}
              onPress={() => {
                if (
                  (resultHash === "__offline__" || resultHash === "__osm__") &&
                  offlineGeoJSONRef.current
                ) {
                  Share.share({
                    message: JSON.stringify(offlineGeoJSONRef.current),
                    title:
                      resultHash === "__osm__"
                        ? "osm-extract.geojson"
                        : "offline-extract.geojson",
                  }).catch(() =>
                    Alert.alert(
                      "Share failed",
                      "Could not share GeoJSON data.",
                    ),
                  );
                } else {
                  Linking.openURL(httpDownloadUrl(resultHash));
                }
              }}
            >
              <MaterialCommunityIcons name="download" size={16} color="#fff" />
              <Text style={styles.actionBtnText}>GeoJSON</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    ...(Platform.OS === "web" && {
      minHeight:
        typeof window !== "undefined"
          ? Math.max(400, window.innerHeight - 120)
          : 400,
    }),
  },
  mapContainer: {
    flex: 1,
    position: "relative" as any,
    ...(Platform.OS === "web" && {
      minHeight:
        typeof window !== "undefined"
          ? Math.max(300, window.innerHeight - 180)
          : 300,
    }),
  },

  // Metrics card (legacy)
  metricsCard: {
    position: "absolute",
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    zIndex: 10,
  },
  metricsLabel: { fontSize: 10, fontWeight: "500" },
  metricsValue: { fontSize: 15, fontWeight: "700" },
  segmentText: { fontSize: 12, fontWeight: "500", marginTop: 2 },

  // Polygon Info Panel (Google Earth style)
  polygonInfoPanel: {
    position: "absolute",
    right: 12,
    width: 220,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  polygonInfoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  polygonInfoTitle: {
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  vertexCount: {
    fontSize: 11,
    fontWeight: "500",
  },
  polygonInfoHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  polygonMetricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  polygonMetricLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  polygonMetricValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    marginTop: 4,
  },
  advancedToggleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  advancedSection: {
    borderTopWidth: 1,
    paddingTop: 8,
    marginTop: 4,
  },

  // City presets
  presetsContainer: {
    position: "absolute",
    right: 60,
    flexDirection: "row",
    gap: 6,
    zIndex: 10,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  presetText: { fontSize: 11, fontWeight: "600" },

  // Draw toolbar
  drawToolbar: {
    position: "absolute",
    left: 12,
    flexDirection: "row",
    zIndex: 10,
  },
  toolButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  toolButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // Bottom sheet
  bottomSheet: {
    maxHeight: 280,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bottomSheetScroll: { flex: 1 },

  // Stats grid
  statsGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  statBoxValue: { fontSize: 16, fontWeight: "700" },
  statBoxLabel: { fontSize: 10, marginTop: 2 },

  // Progress
  progressSection: { marginBottom: 10 },
  progressHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  stageBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  stageText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize" as any,
  },
  progressMessage: { fontSize: 12, flex: 1 },
  progressBarBg: {
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    overflow: "hidden",
  },
  progressBarFill: { height: 4, borderRadius: 2 },

  // Action buttons
  actionsRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  vehicleInput: { fontSize: 14, minWidth: 48 },
  input: {
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },

  // Native fallback
  nativePanel: {
    padding: 16,
    borderTopWidth: 1,
  },
  nativeTitle: { fontSize: 18, fontWeight: "700", marginBottom: 4 },
  nativeSubtitle: { fontSize: 13 },
});
