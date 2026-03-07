/**
 * Route map — WEB ONLY.
 * Metro resolves @/components/route-map to this file on web and to route-map.native.tsx on native.
 * Do not import react-native-maps here; use leaflet + react-leaflet only.
 */
import React, { useRef, useMemo, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { View, Text } from "react-native";
import { buildOvertureOverlayStyle, PMTILES_CITIES } from "@/components/maplibre/overture-style";
import { useColors } from "@/hooks/use-colors";
import {
  getDefaultPerformanceUtils,
  attachToMapRender,
} from "@/lib/maplibre-performance";
import { useMapType } from "@/lib/map-type-preference";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import { useMapWebPluginsStore } from "@/stores/mapWebPluginsStore";
import type { CollectionPoint, WastePoint } from "@/types";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-utils";

// Leaflet is loaded only when window is defined (avoids "window is not defined" during SSR/bundle eval).
let MapContainer: any;
let TileLayer: any;
let Marker: any;
let Popup: any;
let Polyline: any;
let GeoJSONLayer: any;
let useMapHook: any;
let MarkerClusterGroup: any;

function loadLeafletWhenReady() {
  if (typeof window === "undefined") return false;
  if (MapContainer) return true;
  try {
    const leaflet = require("react-leaflet");
    const L = require("leaflet");
    require("leaflet.markercluster");
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
      iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
      shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    });
    MapContainer = leaflet.MapContainer;
    TileLayer = leaflet.TileLayer;
    Marker = leaflet.Marker;
    Popup = leaflet.Popup;
    Polyline = leaflet.Polyline;
    GeoJSONLayer = leaflet.GeoJSON;
    useMapHook = leaflet.useMap;
    MarkerClusterGroup = require("react-leaflet-markercluster").default;
    return true;
  } catch (e) {
    console.warn("Leaflet not available:", e);
    return false;
  }
}

/** Passes the Leaflet map instance to a ref so parent can implement zoom/locate/reset. */
function MapRefBridge({
  mapRef,
  onMapReady,
}: {
  mapRef: React.MutableRefObject<any>;
  onMapReady?: (ready: boolean) => void;
}) {
  const map = useMapHook?.();
  useEffect(() => {
    mapRef.current = map ?? null;
    onMapReady?.(!!map);
    return () => {
      mapRef.current = null;
      onMapReady?.(false);
    };
  }, [map, mapRef, onMapReady]);
  return null;
}

function InvalidateSizeOnMount({ width, height }: { width?: number; height?: number }) {
  const map = useMapHook?.();
  useEffect(() => {
    if (!map || typeof map.invalidateSize !== "function") return;
    const run = () => map.invalidateSize();
    const t1 = setTimeout(run, 150);
    const t2 = setTimeout(run, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map, width, height]);
  return null;
}

const FIT_OPTIONS = { padding: [80, 80] as [number, number], maxZoom: 14 };

function doFitBounds(
  map: any,
  bounds: [[number, number], [number, number]]
) {
  try {
    const container = map.getContainer?.();
    if (container?.parentNode && map.fitBounds) {
      const L = require("leaflet");
      const leafletBounds = L.latLngBounds(bounds[0], bounds[1]);
      map.fitBounds(leafletBounds, FIT_OPTIONS);
    }
  } catch (_) {
    // ignore Leaflet errors when container not ready
  }
}

/** Fit map to bounds only when the route/content actually changes (not on every re-render). Prevents zoom from being reset and track from disappearing. */
function FitBoundsToContent({
  bounds,
}: {
  bounds: [[number, number], [number, number]] | null;
}) {
  const map = useMapHook?.();
  // Stable key so we only re-fit when bounds *values* change, not when parent re-renders with new array reference
  const boundsKey = bounds
    ? `${bounds[0][0].toFixed(5)}_${bounds[0][1].toFixed(5)}_${bounds[1][0].toFixed(5)}_${bounds[1][1].toFixed(5)}`
    : null;
  useEffect(() => {
    if (!map || !bounds) return;
    // Fit immediately when bounds become available so preview is visible without zooming (MapContainer props are immutable after first render).
    const raf = requestAnimationFrame(() => doFitBounds(map, bounds));
    const t = setTimeout(() => doFitBounds(map, bounds), 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [map, boundsKey]);
  return null;
}

const seqIconCache = new Map<string, any>();
function getSeqIcon(label: string) {
  let icon = seqIconCache.get(label);
  if (!icon) {
    const L = require("leaflet");
    icon = L.divIcon({
      html: `<span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#2196F3;color:white;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${label}</span>`,
      className: "route-seq-marker",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    seqIconCache.set(label, icon);
  }
  return icon;
}

const wasteIconCache = new Map<string, any>();
function getWasteIcon(type: "bin" | "dumpster") {
  let icon = wasteIconCache.get(type);
  if (!icon) {
    const L = require("leaflet");
    const isBin = type === "bin";
    const bg = isBin ? "#22c55e" : "#3b82f6";
    const size = isBin ? 20 : 26;
    const label = isBin ? "B" : "D";
    icon = L.divIcon({
      html: `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:white;font-size:12px;font-weight:700;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${label}</span>`,
      className: "waste-marker",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    wasteIconCache.set(type, icon);
  }
  return icon;
}

/**
 * Renders a GeoJSON FeatureCollection on the Leaflet map using L.geoJSON.
 * Automatically removes and re-adds the layer when data or style changes.
 */
function LeafletGeoJSONOverlay({
  data,
  strokeColor,
  strokeWidth,
  fillColor,
}: {
  data: GeoJSONFeatureCollection;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
}) {
  const map = useMapHook?.();
  const layerRef = React.useRef<any>(null);

  useEffect(() => {
    if (!map || !data?.features?.length) return;
    try {
      const L = require("leaflet");

      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }

      const geojsonLayer = L.geoJSON(data, {
        style: (feature: any) => {
          const role = feature?.properties?.role;
          if (role === "optimized-route") {
            return {
              color: strokeColor,
              weight: strokeWidth + 2,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
            };
          }
          if (role === "step") {
            return {
              color: strokeColor,
              weight: strokeWidth,
              opacity: 0.7,
              dashArray: "8 4",
              lineCap: "round",
              lineJoin: "round",
            };
          }
          if (role === "vehicle-route") {
            return {
              color: feature.properties.color || strokeColor,
              weight: strokeWidth + 1,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
            };
          }
          return {
            color: strokeColor,
            weight: strokeWidth,
            opacity: 0.8,
            fillColor,
            fillOpacity: 0.15,
          };
        },
        pointToLayer: (feature: any, latlng: any) => {
          const role = feature?.properties?.role;
          const label = feature?.properties?.label || "";
          const isStart = role === "start" || role === "vehicle-start";
          const isEnd = role === "end" || role === "vehicle-end";
          const bg = isStart ? "#22c55e" : isEnd ? "#ef4444" : "#2196F3";
          const icon = L.divIcon({
            html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${bg};color:white;font-size:10px;font-weight:700;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${label.slice(0, 3)}</span>`,
            className: "geojson-overlay-marker",
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          return L.marker(latlng, { icon });
        },
        onEachFeature: (feature: any, layer: any) => {
          const props = feature?.properties;
          if (!props) return;
          const parts: string[] = [];
          if (props.name) parts.push(`<strong>${props.name}</strong>`);
          if (props.distance != null) parts.push(`Distance: ${(props.distance / 1000).toFixed(2)} km`);
          if (props.duration != null) parts.push(`Duration: ${Math.round(props.duration / 60)} min`);
          if (props.maneuverType && props.maneuverType !== "unknown") {
            parts.push(`Maneuver: ${props.maneuverType}${props.maneuverModifier ? ` (${props.maneuverModifier})` : ""}`);
          }
          if (parts.length > 0) {
            layer.bindPopup(parts.join("<br/>"), { maxWidth: 250 });
          }
        },
      });

      geojsonLayer.addTo(map);
      layerRef.current = geojsonLayer;
    } catch (e) {
      console.warn("[GeoJSONOverlay] Failed to render:", e);
    }

    return () => {
      if (layerRef.current && map) {
        try {
          map.removeLayer(layerRef.current);
        } catch (_) {
          /* map may already be destroyed */
        }
        layerRef.current = null;
      }
    };
  }, [map, data, strokeColor, strokeWidth, fillColor]);

  return null;
}

function MapClickHandler({ onMapPress }: { onMapPress: (lat: number, lon: number) => void }) {
  const map = useMapHook?.();
  const onMapPressRef = React.useRef(onMapPress);
  onMapPressRef.current = onMapPress;
  useEffect(() => {
    if (!map || typeof map.on !== "function") return;
    const handler = (e: { latlng: { lat: number; lng: number } }) => {
      onMapPressRef.current(e.latlng.lat, e.latlng.lng);
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map]);
  return null;
}

/** Transparent overlay rendered *outside* MapContainer so it sits above Leaflet panes and receives clicks (fixes pick-on-map on web). Forwards wheel to the map so scroll zoom works. */
function MapClickOverlaySibling({
  mapRef,
  onMapPress,
}: {
  mapRef: React.MutableRefObject<any>;
  onMapPress: (lat: number, lon: number) => void;
}) {
  const onPressRef = React.useRef(onMapPress);
  onPressRef.current = onMapPress;
  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const map = mapRef.current;
      if (!map || typeof map.containerPointToLatLng !== "function") return;
      const container = map.getContainer?.();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      try {
        const L = require("leaflet");
        const point = L.point ? L.point(x, y) : [x, y];
        const latLng = map.containerPointToLatLng(point);
        if (latLng && typeof latLng.lat === "number" && typeof latLng.lng === "number") {
          onPressRef.current(latLng.lat, latLng.lng);
        }
      } catch (_) {
        const latLng = map.containerPointToLatLng([x, y] as [number, number]);
        if (latLng && typeof latLng.lat === "number" && typeof latLng.lng === "number") {
          onPressRef.current(latLng.lat, latLng.lng);
        }
      }
    },
    [mapRef]
  );
  const handleWheel = React.useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const map = mapRef.current;
      if (!map || typeof map.getZoom !== "function" || typeof map.setZoom !== "function") return;
      e.preventDefault();
      const zoom = map.getZoom();
      const delta = e.deltaY > 0 ? -1 : 1;
      map.setZoom(Math.max(2, Math.min(20, zoom + delta)));
    },
    [mapRef]
  );
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Click map to pick location"
      onClick={handleClick}
      onWheel={handleWheel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.currentTarget.click();
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1000,
        cursor: "crosshair",
        pointerEvents: "auto",
      }}
    />
  );
}

/** Web: contextmenu (right-click) as long-press equivalent for Save to Favorites. */
function MapContextMenuHandler({
  onMapLongPress,
}: {
  onMapLongPress: (lat: number, lon: number) => void;
}) {
  const map = useMapHook?.();
  useEffect(() => {
    if (!map || typeof map.on !== "function") return;
    const handler = (e: { latlng: { lat: number; lng: number } }) => {
      e.originalEvent?.preventDefault?.();
      onMapLongPress(e.latlng.lat, e.latlng.lng);
    };
    map.on("contextmenu", handler);
    return () => {
      map.off("contextmenu", handler);
    };
  }, [map, onMapLongPress]);
  return null;
}

/** Per-segment weather risk for route overlay (green/yellow/red). */
export interface SegmentRisk {
  segmentIndex: number;
  riskScore: number;
}

const ROUTE_COLORS_BY_VEHICLE = ["#F97316", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

export interface RouteMapProps {
  collectionPoints: CollectionPoint[];
  routePoints?: Array<{ lat: number; lon: number; label?: string }>;
  /** When set (e.g. VRP multi-vehicle), one polyline per vehicle with distinct colors. */
  routePointsByVehicle?: Array<Array<{ lat: number; lon: number; label?: string }>>;
  /** When set with routePoints, draws route in segment colors by risk (weather overlay). */
  segmentRisks?: SegmentRisk[];
  height?: number;
  width?: number;
  onPointClick?: (point: CollectionPoint) => void;
  /** Called when user taps/clicks on the map (web: click; native: press). */
  onMapPress?: (lat: number, lon: number) => void;
  /** Called when user long-presses (native) or right-clicks (web) on the map — Save to Favorites. */
  onMapLongPress?: (lat: number, lon: number) => void;
  /** When set, show a blue marker at this point (tap destination for "Directions here"). */
  tapDestination?: { lat: number; lon: number } | null;
  /** Called when the map has finished loading (so map-content can hide its overlay). */
  onLoad?: () => void;
  /** Called when the map fails to load. */
  onError?: (error: string) => void;
  /** Native only: use offline tile cache. Ignored on web. */
  hasOfflineRegions?: boolean;
  /** Native only: bearing for "course" orientation. Ignored on web. */
  userBearing?: number | null;
  /** Native only: show Quebec orthophoto layer. Ignored on web. */
  showAerial?: boolean;
  /** Native only: show traffic overlay. Ignored on web. */
  showTraffic?: boolean;
  /** OSM Extractor: boundary polygon (closed when ≥3 points). */
  osmExtractionPolygon?: Array<{ latitude: number; longitude: number }>;
  /** OSM Extractor: individual boundary points to display as markers. */
  osmExtractionPoints?: Array<{ latitude: number; longitude: number }>;
  /** OSM Extractor: extracted features to draw. */
  osmExtractedFeatures?: Array<{
    id: string;
    geometry: { type: "Point" | "LineString" | "Polygon"; coordinates: number[] | number[][] | number[][][] };
  }>;
  /** OSM Extractor panel open. */
  osmExtractorVisible?: boolean;
  /** Overture Maps overlay (native + web). */
  showOverture?: boolean;
  /**
   * GeoJSON FeatureCollection overlay for optimized route polylines.
   * Rendered via Leaflet's L.geoJSON layer on web.
   */
  geojsonOverlay?: GeoJSONFeatureCollection | null;
  /** Stroke color for the GeoJSON route overlay polyline. Defaults to "#2196F3". */
  geojsonStrokeColor?: string;
  /** Stroke width for the GeoJSON route overlay polyline. Defaults to 4. */
  geojsonStrokeWidth?: number;
  /** Fill color for GeoJSON polygon features. Defaults to "rgba(33,150,243,0.15)". */
  geojsonFillColor?: string;
  /** Zones panel: preview polygon (boundary of selected zone result). */
  zonesPreviewPolygon?: Array<{ latitude: number; longitude: number }>;
  /** Zones panel: sector division — one polygon per zone. */
  zonesPreviewPolygons?: Array<Array<{ latitude: number; longitude: number }>>;
  /** Optional initial bounds to fit map on load (e.g. zone polygons). When set, used when there are no route/collection points. */
  initialBounds?: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  /** When set (>= 0), highlight current route segment (green) vs completed (gray) vs upcoming (white). */
  navigationSegmentIndex?: number;
  /** Live user GPS position; when set, a user location marker is shown. */
  userPosition?: { latitude: number; longitude: number } | null;
  /** Zones waste mode: bins and dumpsters to show with custom icons. */
  wastePoints?: WastePoint[];
}

/** Web: no-op. Native: zoom, locate, compass. */
export interface RouteMapRef {
  zoomIn: () => void;
  zoomOut: () => void;
  centerOnUser: () => Promise<void>;
  resetNorth: () => void;
  /** Fit map view to the current route/track bounds. Used when opening a preview from My Places. */
  fitToRoute: () => void;
  /** Center map on a single point (e.g. favorite waypoint preview). */
  centerOnPoint: (lat: number, lon: number) => void;
}

const DEFAULT_CENTER: [number, number] = [45.42, -75.7]; // Ottawa area
const DEFAULT_ZOOM = 10;

/**
 * Map component for displaying collection points and routes (Web version - Leaflet)
 */
function segmentRiskToColor(riskScore: number, colors: ReturnType<typeof useColors>): string {
  if (riskScore >= 70) return colors.error ?? "#ef4444";
  if (riskScore >= 40) return colors.warning ?? "#ff6b4a";
  return colors.success ?? "#22c55e";
}

const LEAFLET_CSS_ID = "leaflet-css-cdn";
const LEAFLET_CSS_HREF = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
const MAPLIBRE_CSS_ID = "maplibre-gl-css-cdn";

/** Overture PMTiles overlay for web: MapLibre GL layer synced to Leaflet view. */
function OvertureOverlay({
  leafletMapRef,
  width,
  height,
  city,
}: {
  leafletMapRef: React.MutableRefObject<any>;
  width: number;
  height: number;
  city: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const protocolRegistered = useRef(false);
  const perfCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current || !leafletMapRef.current) return;
    const leafletMap = leafletMapRef.current;
    let mlMap: any = null;
    const init = () => {
      try {
        const maplibregl = require("maplibre-gl");
        const { Protocol } = require("pmtiles");
        if (!protocolRegistered.current) {
          const protocol = new Protocol();
          maplibregl.addProtocol("pmtiles", protocol.tile);
          protocolRegistered.current = true;
        }
        const style = buildOvertureOverlayStyle({ city });
        mlMap = new maplibregl.Map({
          container: containerRef.current!,
          style,
          center: [leafletMap.getCenter().lng, leafletMap.getCenter().lat],
          zoom: leafletMap.getZoom(),
          interactive: false,
          attributionControl: false,
        });
        mapRef.current = mlMap;
        const sync = () => {
          if (!mlMap || !leafletMapRef.current) return;
          const c = leafletMapRef.current.getCenter();
          mlMap.setCenter([c.lng, c.lat]);
          mlMap.setZoom(leafletMapRef.current.getZoom());
          mlMap.setBearing(leafletMapRef.current.getBearing?.() ?? 0);
        };
        leafletMap.on("moveend", sync);
        mlMap.on("load", () => {
          sync();
          if (mlMap && typeof mlMap.on === "function") {
            perfCleanupRef.current?.();
            perfCleanupRef.current = attachToMapRender(mlMap, getDefaultPerformanceUtils());
          }
        });
        return () => {
          leafletMap.off("moveend", sync);
        };
      } catch (e) {
        console.warn("Overture overlay failed to load:", e);
      }
    };
    const cleanup = init();
    return () => {
      perfCleanupRef.current?.();
      perfCleanupRef.current = null;
      if (typeof cleanup === "function") cleanup();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [city, leafletMapRef]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(MAPLIBRE_CSS_ID)) return;
    const link = document.createElement("link");
    link.id = MAPLIBRE_CSS_ID;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css";
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: "none",
        zIndex: 450,
      }}
    />
  );
}
const MARKERCLUSTER_CSS_ID = "leaflet-markercluster-css";

function injectPluginStyles() {
  if (typeof document === "undefined") return;
  if (!document.getElementById(MARKERCLUSTER_CSS_ID)) {
    try {
      const link = document.createElement("link");
      link.id = MARKERCLUSTER_CSS_ID;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/react-leaflet-markercluster@5.0.0-rc.0/dist/styles.min.css";
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    } catch (_) {
      /* ignore */
    }
  }
}

export const RouteMap = React.memo(forwardRef<RouteMapRef, RouteMapProps>(function RouteMap({
  collectionPoints,
  routePoints: routePointsProp,
  routePointsByVehicle,
  segmentRisks,
  height = 400,
  width,
  onPointClick,
  onMapPress,
  onMapLongPress,
  tapDestination,
  onLoad,
  onError,
  osmExtractionPolygon,
  osmExtractionPoints,
  osmExtractedFeatures,
  osmExtractorVisible: _osmExtractorVisible,
  showOverture = false,
  navigationSegmentIndex: _navigationSegmentIndex,
  userPosition,
  geojsonOverlay,
  geojsonStrokeColor = "#2196F3",
  geojsonStrokeWidth = 4,
  geojsonFillColor = "rgba(33,150,243,0.15)",
  zonesPreviewPolygon,
  zonesPreviewPolygons,
  initialBounds,
  wastePoints = [],
}, _ref) {
  const colors = useColors();
  const showRouteMarkers = useMapDisplayStore((s) => s.showRouteMarkers);
  const showRouteLine = useMapDisplayStore((s) => s.showRouteLine);

  const routePoints = useMemo(() => {
    if (routePointsByVehicle?.length === 1) return routePointsByVehicle[0];
    return routePointsProp;
  }, [routePointsByVehicle, routePointsProp]);
  const mapRef = useRef<any>(null);
  const leafletMapRef = useRef<any>(null);
  const boundsRef = useRef<[[number, number], [number, number]] | null>(null);
  const markerClusteringEnabled = useMapWebPluginsStore((s) => s.markerClusteringEnabled);
  const mapControls = useMemo(() => ({
    zoomIn: () => {
      const map = leafletMapRef.current;
      if (map && typeof map.zoomIn === "function") map.zoomIn();
    },
    zoomOut: () => {
      const map = leafletMapRef.current;
      if (map && typeof map.zoomOut === "function") map.zoomOut();
    },
    centerOnUser: async () => {
      const map = leafletMapRef.current;
      if (!map || typeof navigator === "undefined" || !navigator.geolocation) return;
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            if (leafletMapRef.current && typeof leafletMapRef.current.setView === "function") {
              const z = Math.max(leafletMapRef.current.getZoom?.() ?? 14, 14);
              leafletMapRef.current.setView([latitude, longitude], z);
            }
            resolve();
          },
          () => resolve(),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      });
    },
    resetNorth: () => {
      const map = leafletMapRef.current;
      if (map && typeof map.setBearing === "function") map.setBearing(0);
      // Standard Leaflet has no rotation; no-op is fine
    },
    fitToRoute: () => {
      const map = leafletMapRef.current;
      const b = boundsRef.current;
      if (map && b) doFitBounds(map, b);
    },
    centerOnPoint: (lat: number, lon: number) => {
      const map = leafletMapRef.current;
      if (map && typeof map.setView === "function") {
        map.setView([lat, lon], 15);
      }
    },
  }), []);
  const [leafletReady, setLeafletReady] = React.useState(false);
  const [leafletMapReady, setLeafletMapReady] = React.useState(false);

  // Load Leaflet only when window is defined (fixes "window is not defined" on web bundle/SSR).
  useEffect(() => {
    if (loadLeafletWhenReady()) {
      injectPluginStyles();
      useMapWebPluginsStore.getState().hydrate();
      setLeafletReady(true);
    } else {
      onError?.("Leaflet failed to load");
    }
  }, [onError]);

  // Phase 1.2: Inject Leaflet CSS only when a map is first rendered (not on initial app load).
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(LEAFLET_CSS_ID)) return;
    const link = document.createElement("link");
    link.id = LEAFLET_CSS_ID;
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS_HREF;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }, []);
  const [mapTypePreference] = useMapType();
  const activeBaseLayer = useMapLayerStore((s) => s.activeBaseLayer);
  const activeOverlays = useMapLayerStore((s) => s.activeOverlays);
  const availableLayers = useMapLayerStore((s) => s.availableLayers);


  const currentBaseLayer = availableLayers.find((layer) => layer.id === activeBaseLayer);
  const baseUrl = currentBaseLayer
    ? (currentBaseLayer.url || (mapTypePreference === "dark"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"))
    : (mapTypePreference === "dark"
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
  const attribution = currentBaseLayer
    ? (currentBaseLayer.attribution || (mapTypePreference === "dark"
        ? "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> &copy; <a href=\"https://carto.com/attributions\">CARTO</a>"
        : "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"))
    : (mapTypePreference === "dark"
        ? "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> &copy; <a href=\"https://carto.com/attributions\">CARTO</a>"
        : "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors");

  const tileUrl = baseUrl;
  const tileAttribution = attribution;

  const hasCollectionPoints = collectionPoints.length > 0;
  const hasRoutePoints = routePoints && routePoints.length > 0;
  const hasRoutePointsByVehicle = routePointsByVehicle && routePointsByVehicle.length > 1;
  const bounds = useMemo(() => {
    let points: [number, number][] = [];
    if (hasCollectionPoints) {
      points = collectionPoints.map((p) => [p.latitude, p.longitude] as [number, number]);
    } else if (hasRoutePointsByVehicle) {
      points = routePointsByVehicle!.flat().map((p) => [p.lat, p.lon] as [number, number]);
    } else if (hasRoutePoints) {
      points = routePoints!.map((p) => [p.lat, p.lon] as [number, number]);
    }
    if (points.length === 0 && initialBounds) {
      const padLat = Math.max((initialBounds.maxLat - initialBounds.minLat) * 0.2, 0.01);
      const padLon = Math.max((initialBounds.maxLon - initialBounds.minLon) * 0.2, 0.01);
      return [
        [initialBounds.minLat - padLat, initialBounds.minLon - padLon],
        [initialBounds.maxLat + padLat, initialBounds.maxLon + padLon],
      ] as [[number, number], [number, number]];
    }
    if (points.length === 0) return null;
    const lats = points.map((p) => p[0]);
    const lons = points.map((p) => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const latPadding = Math.max((maxLat - minLat) * 0.2, 0.01);
    const lonPadding = Math.max((maxLon - minLon) * 0.2, 0.01);
    return [
      [minLat - latPadding, minLon - lonPadding],
      [maxLat + latPadding, maxLon + lonPadding],
    ] as [[number, number], [number, number]];
  }, [collectionPoints, hasCollectionPoints, routePoints, hasRoutePoints, routePointsByVehicle, hasRoutePointsByVehicle, initialBounds]);

  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);

  // Leaflet needs explicit pixel dimensions; 100% alone can fail when parent is flex
  const pixelHeight = height && height > 0 ? height : 400;
  const pixelWidth = width && width > 0 ? width : typeof window !== "undefined" ? window.innerWidth : 800;
  const containerStyle = useMemo(
    () => ({
      height: pixelHeight,
      width: pixelWidth,
      minHeight: 200,
      minWidth: 200,
    }),
    [pixelHeight, pixelWidth]
  );

  // Call onLoad when map is ready (must be before early return so hook order is stable).
  useEffect(() => {
    if (leafletReady && MapContainer) onLoad?.();
  }, [leafletReady, onLoad]);

  if (!leafletReady || !MapContainer) {
    return (
      <View
        style={{
          ...containerStyle,
          backgroundColor: colors.surface,
          justifyContent: "center",
          alignItems: "center",
          borderRadius: 12,
        }}
      >
        <Text style={{ color: colors.muted, textAlign: "center", padding: 16 }}>
          Map loading...
        </Text>
      </View>
    );
  }

  // Plain div wrapper avoids RN View passing pointerEvents/etc to Leaflet (fixes deprecation + layout)
  const wrapperStyle = {
    ...containerStyle,
    borderRadius: 12,
    overflow: "hidden" as const,
    backgroundColor: colors.surface,
  };

  const overtureCity = PMTILES_CITIES[0] ?? "montreal";

  const handleWrapperWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const map = leafletMapRef.current;
      if (!map || typeof map.getZoom !== "function" || typeof map.setZoom !== "function") return;
      e.preventDefault();
      e.stopPropagation();
      const zoom = map.getZoom();
      const delta = e.deltaY > 0 ? -1 : 1;
      map.setZoom(Math.max(2, Math.min(20, zoom + delta)));
    },
    []
  );

  return (
    <View style={[wrapperStyle, onMapPress ? { pointerEvents: "auto" } : { pointerEvents: "box-none" }]}>
      <div
        style={{
          width: pixelWidth,
          height: pixelHeight,
          minWidth: 200,
          minHeight: 200,
          position: "relative",
          pointerEvents: "auto",
        }}
        onWheel={handleWrapperWheel}
      >
        <MapContainer
          ref={mapRef}
          {...(bounds
            ? { bounds, boundsOptions: { padding: [80, 80], maxZoom: 14 } }
            : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })}
          style={{ height: pixelHeight, width: pixelWidth }}
        >
          <TileLayer attribution={tileAttribution} url={tileUrl} />
          {useMapHook ? (
            <MapRefBridge
              mapRef={leafletMapRef}
              onMapReady={setLeafletMapReady}
            />
          ) : null}
          {useMapHook ? <InvalidateSizeOnMount width={pixelWidth} height={pixelHeight} /> : null}
          {useMapHook && bounds ? <FitBoundsToContent bounds={bounds} /> : null}
          {useMapHook && onMapPress ? <MapClickHandler onMapPress={onMapPress} /> : null}
          {useMapHook && onMapLongPress ? (
            <MapContextMenuHandler onMapLongPress={onMapLongPress} />
          ) : null}

          {tapDestination != null && (
            <Marker position={[tapDestination.lat, tapDestination.lon]} title="Directions here" />
          )}

          {userPosition != null && !isNaN(userPosition.latitude) && !isNaN(userPosition.longitude) && (() => {
            const L = require("leaflet");
            const icon = L.divIcon({
              className: "user-position-marker",
              html: `<div style="width:14px;height:14px;border-radius:50%;background:${colors.primary ?? "#3b82f6"};border:3px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.3);" />`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            });
            return <Marker position={[userPosition.latitude, userPosition.longitude]} icon={icon} zIndexOffset={25} />;
          })()}

          {osmExtractionPoints?.map((point, index) => (
            <Marker
              key={`osm-pt-${index}`}
              position={[point.latitude, point.longitude]}
              title={`Point ${index + 1}`}
              zIndexOffset={500}
            >
              <Popup>
                <span style={{ fontWeight: 600 }}>Point {index + 1}</span>
              </Popup>
            </Marker>
          ))}

          {osmExtractedFeatures?.length ? (() => {
            const maxLine = 800;
            const maxPoly = 800;
            const maxPoint = 300;
            const lines: Array<{ key: string; positions: [number, number][] }> = [];
            const polys: Array<{ key: string; positions: [number, number][] }> = [];
            const points: Array<{ key: string; lat: number; lon: number }> = [];
            for (const f of osmExtractedFeatures) {
              const geom = f.geometry;
              if (!geom) continue;
              if (geom.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
                if (points.length < maxPoint) points.push({ key: f.id, lon: geom.coordinates[0], lat: geom.coordinates[1] });
              } else               if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
                if (lines.length >= maxLine) continue;
                const positions = (geom.coordinates as number[][]).map((c) => [c[1], c[0]] as [number, number]);
                if (positions.length >= 2) lines.push({ key: f.id, positions });
              } else if (geom.type === "Polygon" && Array.isArray(geom.coordinates) && geom.coordinates[0]) {
                if (polys.length >= maxPoly) continue;
                const ring = (geom.coordinates[0] as number[][]).map((c) => [c[1], c[0]] as [number, number]);
                if (ring.length >= 3) polys.push({ key: f.id, positions: ring });
              }
            }
            return (
              <>
                {lines.map(({ key, positions }) => (
                  <Polyline key={`osm-l-${key}`} positions={positions} pathOptions={{ color: "#22c55e", weight: 2, opacity: 0.9 }} />
                ))}
                {polys.map(({ key, positions }) => (
                  <Polyline key={`osm-p-${key}`} positions={positions} pathOptions={{ color: "#eab308", weight: 1, fill: true, fillOpacity: 0.25, fillColor: "#eab308" }} />
                ))}
                {points.map(({ key, lat, lon }) => (
                  <Marker key={`osm-m-${key}`} position={[lat, lon]} zIndexOffset={400} />
                ))}
              </>
            );
          })() : null}

          {osmExtractionPolygon && osmExtractionPolygon.length >= 3 && (() => {
            const closed = [...osmExtractionPolygon.map((p) => [p.latitude, p.longitude] as [number, number]), [osmExtractionPolygon[0].latitude, osmExtractionPolygon[0].longitude]];
            return (
              <Polyline
                positions={closed}
                pathOptions={{ color: "#3b82f6", weight: 4, fill: true, fillOpacity: 0.25, fillColor: "#3b82f6", opacity: 1 }}
                key="osm-extraction-boundary"
              />
            );
          })()}

          {zonesPreviewPolygons && zonesPreviewPolygons.length > 0
            ? (() => {
                const zoneStrokeColors = ["#f97316", "#3b82f6", "#22c55e", "#a855f7", "#eab308", "#ef4444"];
                const nonInteractive = !!onMapPress; // when picking location, let map receive clicks
                return zonesPreviewPolygons.map((poly, idx) => {
                  if (poly.length < 3) return null;
                  const closed = [...poly.map((p) => [p.latitude, p.longitude] as [number, number]), [poly[0].latitude, poly[0].longitude]];
                  const stroke = zoneStrokeColors[idx % zoneStrokeColors.length];
                  return (
                    <Polyline
                      key={`zones-preview-${idx}`}
                      positions={closed}
                      pathOptions={{ color: stroke, weight: 3, fill: true, fillOpacity: 0.3, fillColor: stroke, opacity: 1, interactive: !nonInteractive }}
                    />
                  );
                });
              })()
            : zonesPreviewPolygon && zonesPreviewPolygon.length >= 3 && (() => {
              const nonInteractive = !!onMapPress;
              const closed = [...zonesPreviewPolygon.map((p) => [p.latitude, p.longitude] as [number, number]), [zonesPreviewPolygon[0].latitude, zonesPreviewPolygon[0].longitude]];
              return (
                <Polyline
                  positions={closed}
                  pathOptions={{ color: "#f97316", weight: 4, fill: true, fillOpacity: 0.25, fillColor: "#f97316", opacity: 1, interactive: !nonInteractive }}
                  key="zones-preview-boundary"
                />
              );
            })()}

          {wastePoints.length > 0 && (() => {
            const useCluster = wastePoints.length > 20 && MarkerClusterGroup;
            const list = wastePoints.map((p) => (
              <Marker
                key={p.id}
                position={[p.lat, p.lon]}
                icon={getWasteIcon(p.type)}
                zIndexOffset={800}
              >
                <Popup>
                  <div style={{ fontSize: "12px", maxWidth: "200px" }}>
                    <strong>{p.type === "bin" ? "Bin" : "Dumpster"}</strong>
                    <br />
                    {p.address || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}
                    {p.capacityLiters != null && <><br />Capacity: {p.capacityLiters} L</>}
                    {p.condition && <><br />Condition: {p.condition}</>}
                  </div>
                </Popup>
              </Marker>
            ));
            return useCluster ? (
              <MarkerClusterGroup key="waste-points-cluster">{list}</MarkerClusterGroup>
            ) : (
              <React.Fragment key="waste-points">{list}</React.Fragment>
            );
          })()}

          {useMapHook && geojsonOverlay && geojsonOverlay.features.length > 0 && (
            <LeafletGeoJSONOverlay
              data={geojsonOverlay}
              strokeColor={geojsonStrokeColor}
              strokeWidth={geojsonStrokeWidth}
              fillColor={geojsonFillColor}
            />
          )}

          {showRouteLine && (routePointsByVehicle && routePointsByVehicle.length > 1
            ? routePointsByVehicle.map((vehiclePoints, vIdx) => {
                if (vehiclePoints.length < 2) return null;
                const positions = vehiclePoints.map((p) => [p.lat, p.lon] as [number, number]);
                const color = ROUTE_COLORS_BY_VEHICLE[vIdx % ROUTE_COLORS_BY_VEHICLE.length];
                return (
                  <Polyline
                    key={`vehicle-${vIdx}`}
                    positions={positions}
                    pathOptions={{ color, weight: 6, opacity: 1 }}
                  />
                );
              })
            : routePoints && routePoints.length > 1 && (segmentRisks && segmentRisks.length > 0 ? (
              (() => {
                const riskByIndex = new Map(segmentRisks.map((s) => [s.segmentIndex, s.riskScore]));
                return routePoints.slice(0, -1).map((_, i) => {
                  const p1 = routePoints[i];
                  const p2 = routePoints[i + 1];
                  const risk = riskByIndex.get(i) ?? 0;
                  const color = segmentRiskToColor(risk, colors);
                  const key = `seg-${i}-${p1.lat}-${p1.lon}-${p2.lat}-${p2.lon}`;
                  return (
                    <Polyline
                      key={key}
                      positions={[[p1.lat, p1.lon], [p2.lat, p2.lon]]}
                      color={color}
                      weight={6}
                      opacity={0.95}
                    />
                  );
                });
              })()
            ) : (
              <Polyline
                positions={routePoints.map((p) => [p.lat, p.lon])}
                color="#F97316"
                weight={6}
                opacity={1}
              />
            )))}

          {routePoints && routePoints.length === 1 && (
            <Marker
              key="preview-single"
              position={[routePoints[0].lat, routePoints[0].lon]}
              icon={getSeqIcon("P")}
            />
          )}

          {routePoints && routePoints.length >= 2 && !(routePointsByVehicle && routePointsByVehicle.length > 1) &&
            (showRouteMarkers && routePoints.some((p) => p.label != null) ? (
              routePoints.map((p, i) =>
                p.label != null ? (
                  <Marker
                    key={`seq-${i}`}
                    position={[p.lat, p.lon]}
                    icon={getSeqIcon(p.label)}
                  />
                ) : null
              )
            ) : (
              <>
                <Marker
                  key="route-start"
                  position={[routePoints[0].lat, routePoints[0].lon]}
                  icon={getSeqIcon("S")}
                />
                <Marker
                  key="route-end"
                  position={[routePoints[routePoints.length - 1].lat, routePoints[routePoints.length - 1].lon]}
                  icon={getSeqIcon("E")}
                />
              </>
            ))}

          {showRouteMarkers && (MarkerClusterGroup && markerClusteringEnabled && collectionPoints.length > 0 ? (
            <MarkerClusterGroup>
              {collectionPoints.map((point) => (
                <Marker
                  key={point.id}
                  position={[point.latitude, point.longitude]}
                  title={point.address}
                  zIndexOffset={1000}
                  eventHandlers={{
                    click: () => onPointClick?.(point),
                  }}
                >
                  <Popup>
                    <div style={{ fontSize: "12px", maxWidth: "200px" }}>
                      <strong>{point.address}</strong>
                      <br />
                      Type: {point.collectionType}
                      <br />
                      Status: {point.status}
                      <br />
                      Time:{" "}
                      {point.scheduledTime
                        ? new Date(point.scheduledTime).toLocaleTimeString()
                        : "N/A"}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          ) : (
            collectionPoints.map((point) => (
              <Marker
                key={point.id}
                position={[point.latitude, point.longitude]}
                title={point.address}
                zIndexOffset={1000}
                eventHandlers={{
                  click: () => onPointClick?.(point),
                }}
              >
                <Popup>
                  <div style={{ fontSize: "12px", maxWidth: "200px" }}>
                    <strong>{point.address}</strong>
                    <br />
                    Type: {point.collectionType}
                    <br />
                    Status: {point.status}
                    <br />
                    Time:{" "}
                    {point.scheduledTime
                      ? new Date(point.scheduledTime).toLocaleTimeString()
                      : "N/A"}
                  </div>
                </Popup>
              </Marker>
            ))
          ))}
        </MapContainer>
        {showOverture && PMTILES_CITIES.length > 0 && leafletMapReady && (
          <OvertureOverlay
            leafletMapRef={leafletMapRef}
            width={pixelWidth}
            height={pixelHeight}
            city={overtureCity}
          />
        )}
        {/* No overlay on web: map must receive pointer events for pan and click. MapClickHandler inside MapContainer handles onMapPress. */}
      </div>
    </View>
  );
}));

/**
 * Fit map bounds to collection points
 */
export function FitBoundsButton({ mapRef }: { mapRef: React.RefObject<any> }) {
  const colors = useColors();

  return (
    <View
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        backgroundColor: colors.primary,
        borderRadius: 8,
        padding: 8,
        zIndex: 1000,
      }}
    />
  );
}

