/**
 * Route map — NATIVE ONLY (iOS/Android).
 * Uses OpenStreetMap tiles via react-native-maps UrlTile (same as web/Leaflet).
 * mapType="none" hides the default base map; UrlTile provides OSM.
 */
import React, { useRef, useMemo, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { View, StyleSheet, Platform, Text } from "react-native";
import MapView, { Geojson, Marker, Polygon, Polyline, UrlTile } from "react-native-maps";

/** VRP stop number badge – shown only when routePoints have labels (VRP preview). */
function VRPStopMarker({ label, index, total }: { label: string; index: number; total: number }) {
  const isStart = index === 0;
  const isEnd = index === total - 1;
  const bgColor = isStart || isEnd ? "#22c55e" : "#2196F3";
  return (
    <View
      style={[
        styles.vrpMarkerOuter,
        { backgroundColor: bgColor },
      ]}
    >
      <Text style={styles.vrpMarkerText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

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
import { useColors } from "@/hooks/use-colors";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useMapType } from "@/lib/map-type-preference";
import { useMapOrientation } from "@/lib/map-orientation-preference";
import { useMapLayerStore } from "@/stores/mapLayerStore";
import type { CollectionPoint } from "@/types";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-utils";

// Helpers for cleaning coordinate arrays so we never hand NaNs to the
// native map view – this is the root cause of the NSInvalidArgumentException
// crash when the route is cleared.
import { sanitizeLatLonArray, sanitizeByVehicle } from "@/lib/coord-utils";

const OSM_TILE_STANDARD = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_TILE_DARK = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";

/** Quebec government orthophoto (aerial imagery) - WMTS GoogleMapsCompatible. */
const QUEBEC_ORTHOPHOTO_URL =
  "https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_f4def498/default/GoogleMapsCompatibleExt2:epsg:3857/{z}/{y}/{x}.jpg";


/** Convert Leaflet-style tile URL ({s}, {r}) to one react-native-maps UrlTile can use (only supports {z},{x},{y}). */
function urlTemplateForNative(url: string): string {
  return url
    .replace(/\{s\}/g, "a")
    .replace(/\{r\}/g, "");
}

/** Per-segment weather risk for route overlay (green/yellow/red). */
export interface SegmentRisk {
  segmentIndex: number;
  riskScore: number;
}

/** Per-vehicle route (VRP): when set with length > 1, multiple polylines are drawn instead of routePoints. */
const ROUTE_COLORS_BY_VEHICLE = ["#F97316", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];

export interface RouteMapProps {
  collectionPoints: CollectionPoint[];
  routePoints?: Array<{ lat: number; lon: number; label?: string }>;
  /** When set (e.g. VRP multi-vehicle), one polyline per vehicle with distinct colors. */
  routePointsByVehicle?: Array<Array<{ lat: number; lon: number; label?: string }>>;
  segmentRisks?: SegmentRisk[];
  height?: number;
  width?: number;
  onPointClick?: (point: CollectionPoint) => void;
  onMapPress?: (lat: number, lon: number) => void;
  /** Called when user long-presses on the map (Save to Favorites). */
  onMapLongPress?: (lat: number, lon: number) => void;
  tapDestination?: { lat: number; lon: number } | null;
  onLoad?: () => void;
  onError?: (error: string) => void;
  hasOfflineRegions?: boolean;
  /** When orientation is "course", use this bearing (degrees) to rotate the map. */
  userBearing?: number | null;
  /** When true, show Quebec orthophoto (aerial) layer instead of standard base map. */
  showAerial?: boolean;
  /** When true, show traffic overlay. On iOS/Android uses react-native-maps showsTraffic (Apple/Google traffic layer). May be less visible when using custom OSM tiles. */
  showTraffic?: boolean;
  /** OSM Extractor: polygon outline (when user is drawing an extraction area). */
  osmExtractionPolygon?: Array<{ latitude: number; longitude: number }>;
  /** OSM Extractor: point markers for the polygon vertices. */
  osmExtractionPoints?: Array<{ latitude: number; longitude: number }>;
  /** OSM Extractor: extracted features (roads, buildings, POIs) to draw on the map. */
  osmExtractedFeatures?: Array<{
    id: string;
    geometry: {
      type: "Point" | "LineString" | "Polygon";
      coordinates: number[] | number[][] | number[][][];
    };
  }>;
  /** When true, OSM Extractor panel is open. Passed from map-content; native ignores. */
  osmExtractorVisible?: boolean;
  /** Show Overture Maps transportation overlay (PMTiles via MapLibre). */
  showOverture?: boolean;
  /**
   * When set (>= 0), enables navigation segment coloring:
   *   segments before this index → gray (completed)
   *   segment at this index      → green (current)
   *   segments after this index  → white (upcoming)
   */
  navigationSegmentIndex?: number;
  /** Live user GPS position; when set, a user location marker is shown. */
  userPosition?: { latitude: number; longitude: number } | null;
  /** GeoJSON overlay (e.g. Overture transport layer) to draw on the map. */
  geojsonOverlay?: GeoJSONFeatureCollection | null;
  /** Zones panel: preview polygon (boundary of selected zone result) to draw on the map. */
  zonesPreviewPolygon?: Array<{ latitude: number; longitude: number }>;
  /** Zones panel: sector division — one polygon per zone (from zone_polygon). Drawn with distinct colors. */
  zonesPreviewPolygons?: Array<Array<{ latitude: number; longitude: number }>>;
  /** Optional initial bounds to fit map on load (e.g. zone polygons). When set, used when there are no route/collection points. */
  initialBounds?: { minLat: number; minLon: number; maxLat: number; maxLon: number };
}

const DEFAULT_REGION = {
  latitude: 45.5,
  longitude: -73.6,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};

function getMarkerColor(collectionType?: string): string {
  if (collectionType === "residential") return "#3b82f6";
  if (collectionType === "commercial") return "#f59e0b";
  if (collectionType === "industrial") return "#ef4444";
  return "#6366f1";
}

function segmentRiskToColor(riskScore: number, colors: ReturnType<typeof useColors>): string {
  if (riskScore >= 70) return colors.error ?? "#ef4444";
  if (riskScore >= 40) return colors.warning ?? "#ff6b4a";
  return colors.success ?? "#22c55e";
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
  userBearing,
  showAerial = false,
  showTraffic = false,
  osmExtractionPolygon,
  osmExtractionPoints,
  osmExtractedFeatures,
  osmExtractorVisible: _osmExtractorVisible,
  navigationSegmentIndex,
  userPosition,
  geojsonOverlay,
  zonesPreviewPolygon,
  zonesPreviewPolygons,
  initialBounds,
}, ref) {
  const colors = useColors();
  const showRouteMarkers = useMapDisplayStore((s) => s.showRouteMarkers);
  const showRouteLine = useMapDisplayStore((s) => s.showRouteLine);
  const mapRef = useRef<MapView>(null);

  // Process OSM features asynchronously in chunks to avoid blocking the JS thread and triggering the OS watchdog.
  const [osmOverlays, setOsmOverlays] = React.useState<{
    lines: Array<{ key: string; coords: { latitude: number; longitude: number }[] }>;
    polys: Array<{ key: string; coords: { latitude: number; longitude: number }[] }>;
    points: Array<{ key: string; lat: number; lon: number }>;
  } | null>(null);

  useEffect(() => {
    if (!osmExtractedFeatures?.length) {
      // Clear overlays in a microtask so react-native-maps doesn't bulk-remove in one frame
      setOsmOverlays(null);
      return;
    }

    let cancelled = false;
    const CHUNK = 200;
    const maxLine = 800;
    const maxPoly = 800;
    const maxPoint = 300;

    const processAsync = async () => {
      const lines: typeof osmOverlays extends infer T ? T extends null ? never : NonNullable<T>["lines"] : never = [];
      const polys: typeof lines = [];
      const points: Array<{ key: string; lat: number; lon: number }> = [];

      for (let i = 0; i < osmExtractedFeatures.length; i++) {
        if (cancelled) return;
        // Yield to the JS thread every CHUNK features
        if (i > 0 && i % CHUNK === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }

        const f = osmExtractedFeatures[i];
        const geom = f.geometry;
        if (!geom) continue;

        if (geom.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
          if (points.length < maxPoint) points.push({ key: f.id, lon: geom.coordinates[0] as number, lat: geom.coordinates[1] as number });
        } else if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
          if (lines.length >= maxLine) continue;
          const coords = (geom.coordinates as number[][]).map((c) => ({ latitude: c[1], longitude: c[0] }));
          if (coords.length >= 2) lines.push({ key: f.id, coords });
        } else if (geom.type === "Polygon" && Array.isArray(geom.coordinates) && geom.coordinates[0]) {
          if (polys.length >= maxPoly) continue;
          const ring = (geom.coordinates[0] as number[][]).map((c) => ({ latitude: c[1], longitude: c[0] }));
          if (ring.length >= 3) polys.push({ key: f.id, coords: ring });
        }
      }

      if (!cancelled) {
        setOsmOverlays({ lines, polys, points });
      }
    };

    processAsync().catch((err) => {
      console.warn("[RouteMap] OSM overlay processing failed:", err);
      if (!cancelled) setOsmOverlays(null);
    });

    return () => { cancelled = true; };
  }, [osmExtractedFeatures]);
  const [orientation] = useMapOrientation();

  const routePoints = useMemo(() => {
    if (routePointsByVehicle?.length === 1) return routePointsByVehicle[0];
    return routePointsProp;
  }, [routePointsByVehicle, routePointsProp]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      mapRef.current?.getCamera().then((camera) => {
        if (camera?.zoom != null) {
          mapRef.current?.setCamera({ ...camera, zoom: Math.min(camera.zoom + 1, 20) });
        }
      });
    },
    zoomOut: () => {
      mapRef.current?.getCamera().then((camera) => {
        if (camera?.zoom != null) {
          mapRef.current?.setCamera({ ...camera, zoom: Math.max(camera.zoom - 1, 2) });
        }
      });
    },
    centerOnUser: async () => {
      try {
        const Loc = await import("expo-location");
        const { status } = await Loc.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await (Loc as { getCurrentPositionAsync?: (o?: object) => Promise<{ coords: { latitude: number; longitude: number } }> }).getCurrentPositionAsync?.({});
        if (pos?.coords) {
          mapRef.current?.animateToRegion({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }, 300);
        }
      } catch (_) {
        /* ignore */
      }
    },
    resetNorth: () => {
      mapRef.current?.getCamera().then((camera) => {
        if (camera) {
          mapRef.current?.animateCamera({ ...camera, heading: 0 }, { duration: 300 });
        }
      });
    },
    fitToRoute: () => {
      fitToRoute();
    },
    centerOnPoint: (lat: number, lon: number) => {
      mapRef.current?.animateToRegion(
        {
          latitude: lat,
          longitude: lon,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        300
      );
    },
  }), [fitToRoute]);
  const [mapTypePreference] = useMapType();

  const pointsForBounds = useMemo(() => {
    if (collectionPoints.length > 0) {
      return collectionPoints.map((p) => ({ lat: p.latitude, lon: p.longitude }));
    }
    if (routePointsByVehicle && routePointsByVehicle.length > 1) {
      return routePointsByVehicle.flat();
    }
    if (routePoints && routePoints.length > 0) return routePoints;
    if (initialBounds) {
      const { minLat, maxLat, minLon, maxLon } = initialBounds;
      return [
        { lat: minLat, lon: minLon },
        { lat: minLat, lon: maxLon },
        { lat: maxLat, lon: maxLon },
        { lat: maxLat, lon: minLon },
      ];
    }
    return [];
  }, [collectionPoints, routePoints, routePointsByVehicle, initialBounds]);

  /** Bounding box from all points so fitToRoute shows the full track (no truncation on long GPX). */
  const boundsBox = useMemo(() => {
    if (pointsForBounds.length < 2) return null;
    const lats = pointsForBounds.map((p) => p.lat);
    const lons = pointsForBounds.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return { minLat, maxLat, minLon, maxLon };
  }, [pointsForBounds]);

  const region = useMemo(() => {
    if (pointsForBounds.length === 0) return DEFAULT_REGION;
    const lats = pointsForBounds.map((p) => p.lat);
    const lons = pointsForBounds.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const padLat = Math.max((maxLat - minLat) * 0.2, 0.01);
    const padLon = Math.max((maxLon - minLon) * 0.2, 0.01);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: maxLat - minLat + padLat * 2,
      longitudeDelta: maxLon - minLon + padLon * 2,
    };
  }, [pointsForBounds]);

  const filteredRoutePoints = useMemo(
    () => sanitizeLatLonArray(routePoints),
    [routePoints]
  );

  const routeCoords = useMemo(
    () => filteredRoutePoints.map((p) => ({ latitude: p.lat, longitude: p.lon })),
    [filteredRoutePoints]
  );

  const navSegmentPolylines = useMemo(() => {
    if (navigationSegmentIndex == null || navigationSegmentIndex < 0 || routeCoords.length < 2) return null;
    const idx = navigationSegmentIndex;
    return {
      completed: idx > 0 ? routeCoords.slice(0, idx + 1) : null,
      current: idx < routeCoords.length - 1 ? routeCoords.slice(idx, idx + 2) : null,
      upcoming: idx + 1 < routeCoords.length - 1 ? routeCoords.slice(idx + 1) : null,
    };
  }, [navigationSegmentIndex, routeCoords]);

  // Stable key from bbox so we don't build a huge string for long tracks; ensures full GPX extent is fitted.
  const boundsKey = boundsBox
    ? `${boundsBox.minLat.toFixed(5)}_${boundsBox.maxLat.toFixed(5)}_${boundsBox.minLon.toFixed(5)}_${boundsBox.maxLon.toFixed(5)}`
    : null;

  const fitToRoute = useCallback(() => {
    if (pointsForBounds.length < 2 || !mapRef.current || !boundsBox) return;
    // Use bbox corners so the full track extent is always fitted (native fitToCoordinates can truncate large arrays).
    const b = boundsBox;
    const coords = [
      { latitude: b.minLat, longitude: b.minLon },
      { latitude: b.minLat, longitude: b.maxLon },
      { latitude: b.maxLat, longitude: b.maxLon },
      { latitude: b.maxLat, longitude: b.minLon },
    ];
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
      animated: false,
    });
  }, [boundsKey, boundsBox]);

  useEffect(() => {
    if (!boundsKey) return;
    fitToRoute();
  }, [boundsKey, fitToRoute]);

  const handleMapReady = useCallback(() => {
    // Fit to route when map is ready so preview is visible on iOS (MapView may not be ready when effect first runs).
    if (boundsKey) fitToRoute();
    onLoad?.();
  }, [onLoad, boundsKey, fitToRoute]);

  const rotateEnabled = orientation !== "north";

  // Compass mode: update map heading from device compass (expo-location watchHeadingAsync)
  useEffect(() => {
    if (orientation !== "compass" || !rotateEnabled || Platform.OS === "web") return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;
    let rafId: number | null = null;
    let lastHeading = -1;
    const updateHeading = (heading: number) => {
      if (heading < 0 || heading >= 360) return;
      const rounded = Math.round(heading);
      if (Math.abs(rounded - lastHeading) < 2) return;
      lastHeading = rounded;
      rafId = requestAnimationFrame(() => {
        mapRef.current?.getCamera().then((camera) => {
          if (camera) mapRef.current?.setCamera({ ...camera, heading });
        });
      });
    };
    (async () => {
      try {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        sub = await Location.watchHeadingAsync((e) => updateHeading(e.trueHeading));
        // If cleanup ran while we were awaiting, remove immediately
        if (cancelled) {
          sub.remove();
          sub = null;
        }
      } catch {
        // watchHeadingAsync not available (e.g. web)
      }
    })();
    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      sub?.remove?.();
    };
  }, [orientation, rotateEnabled]);

  // Course mode: update map heading from user bearing (when provided)
  useEffect(() => {
    if (orientation !== "course" || userBearing == null || userBearing < 0 || userBearing >= 360) return;
    mapRef.current?.getCamera().then((camera) => {
      if (camera) mapRef.current?.setCamera({ ...camera, heading: userBearing });
    });
  }, [orientation, userBearing]);

  const handlePress = useCallback(
    (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      onMapPress?.(latitude, longitude);
    },
    [onMapPress]
  );

  const handleLongPress = useCallback(
    (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      onMapLongPress?.(latitude, longitude);
    },
    [onMapLongPress]
  );

  const activeBaseLayer = useMapLayerStore((s) => s.activeBaseLayer);
  const activeOverlays = useMapLayerStore((s) => s.activeOverlays);
  const availableLayers = useMapLayerStore((s) => s.availableLayers);


  const currentBaseLayer = availableLayers.find((layer) => layer.id === activeBaseLayer);
  const tileUrlRaw = showAerial
    ? QUEBEC_ORTHOPHOTO_URL
      
      : (currentBaseLayer?.url || (mapTypePreference === "dark" ? OSM_TILE_DARK : OSM_TILE_STANDARD));
  const tileUrl = urlTemplateForNative(tileUrlRaw);

  const safeWidth = typeof width === "number" && width > 0 ? width : 320;
  const safeHeight = typeof height === "number" && height > 0 ? height : 400;

  return (
    <View
      style={[
        styles.container,
        {
          width: safeWidth,
          height: safeHeight,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onMapReady={handleMapReady}
        onPress={handlePress}
        onLongPress={handleLongPress}
        mapType={
          activeBaseLayer === "google-maps" ? "standard" :
          activeBaseLayer === "google-satellite" ? "satellite" :
          activeBaseLayer === "google-hybrid" ? "hybrid" :
          activeBaseLayer === "google-terrain" ? "terrain" :
          "none"
        }
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsBuildings={activeBaseLayer === "google-hybrid"}
        showsTraffic={showTraffic}
        rotateEnabled={rotateEnabled}
        pitchEnabled={true}
      >
        {!activeBaseLayer.startsWith("google-") && (
          <UrlTile
            urlTemplate={tileUrl}
            tileSize={256}
            opacity={1.0}
            shouldReplaceMapContent={Platform.OS === "ios"}
            maximumZ={19}
            flipY={Platform.OS === "android"}
          />
        )}
        {showRouteLine && (routePointsByVehicle && routePointsByVehicle.length > 1 ? (
          sanitizeByVehicle(routePointsByVehicle)
            .filter((vehiclePoints) => vehiclePoints.length >= 2)
            .map((vehiclePoints, vIdx) => {
              const coords = vehiclePoints.map((p) => ({ latitude: p.lat, longitude: p.lon }));
              const color = ROUTE_COLORS_BY_VEHICLE[vIdx % ROUTE_COLORS_BY_VEHICLE.length];
              return (
                <Polyline
                  key={`vehicle-${vIdx}`}
                  coordinates={coords}
                  strokeColor={color}
                  strokeWidth={6}
                  zIndex={1}
                  lineCap="round"
                  lineJoin="round"
                />
              );
            })
        ) : routeCoords.length >= 2 ? (
          <>
            {navSegmentPolylines ? (
              <>
                {navSegmentPolylines.upcoming && navSegmentPolylines.upcoming.length >= 2 && (
                  <Polyline
                    key="nav-upcoming"
                    coordinates={navSegmentPolylines.upcoming}
                    strokeColor="#FFFFFF"
                    strokeWidth={6}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={1}
                  />
                )}
                {navSegmentPolylines.current && navSegmentPolylines.current.length >= 2 && (
                  <Polyline
                    key="nav-current"
                    coordinates={navSegmentPolylines.current}
                    strokeColor="#22c55e"
                    strokeWidth={8}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={3}
                  />
                )}
                {navSegmentPolylines.completed && navSegmentPolylines.completed.length >= 2 && (
                  <Polyline
                    key="nav-completed"
                    coordinates={navSegmentPolylines.completed}
                    strokeColor="#9CA3AF"
                    strokeWidth={6}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={2}
                  />
                )}
              </>
            ) : segmentRisks && segmentRisks.length > 0 && filteredRoutePoints.length >= 2 ? (
              (() => {
                const riskMap = new Map();
                segmentRisks.forEach(s => riskMap.set(s.segmentIndex, s.riskScore));

                return filteredRoutePoints.slice(0, -1).map((_, i) => {
                  const p1 = filteredRoutePoints[i];
                  const p2 = filteredRoutePoints[i + 1];
                  const risk = riskMap.get(i) ?? 0;
                  const color = segmentRiskToColor(risk, colors);
                  const key = `seg-${i}-${p1.lat}-${p1.lon}-${p2.lat}-${p2.lon}`;

                  return (
                    <Polyline
                      key={key}
                      coordinates={[
                        { latitude: p1.lat, longitude: p1.lon },
                        { latitude: p2.lat, longitude: p2.lon },
                      ]}
                      strokeColor={color}
                      strokeWidth={6}
                      zIndex={1}
                    />
                  );
                });
              })()
            ) : (
              <Polyline
                coordinates={routeCoords}
                strokeColor={"#F97316"}
                strokeWidth={6}
                zIndex={1}
                lineCap="round"
                lineJoin="round"
              />
            )}
          </>
        ) : null)}
        {showRouteMarkers && collectionPoints
            .filter((point) => !isNaN(point.latitude) && !isNaN(point.longitude))
            .map((point) => (
            <Marker
              key={point.id}
              coordinate={{ latitude: point.latitude, longitude: point.longitude }}
              pinColor={getMarkerColor(point.collectionType)}
              onPress={() => onPointClick?.(point)}
              zIndex={10}
            />
        ))}
        {filteredRoutePoints.length === 1 && (
          /* Single-point preview (e.g. favorite waypoint from My Places) */
          <Marker
            coordinate={{
              latitude: filteredRoutePoints[0].lat,
              longitude: filteredRoutePoints[0].lon,
            }}
            pinColor={colors.primary ?? "#3b82f6"}
            title="Preview"
            zIndex={10}
          />
        )}
        {filteredRoutePoints.length >= 2 && (!segmentRisks || segmentRisks.length === 0) && (
          /* Start/End markers only (no numbered VRP markers along the route) */
          <>
            <Marker
              coordinate={{
                latitude: filteredRoutePoints[0].lat,
                longitude: filteredRoutePoints[0].lon,
              }}
              pinColor="#22c55e"
              title="Start"
              zIndex={10}
            />
            <Marker
              coordinate={{
                latitude: filteredRoutePoints[filteredRoutePoints.length - 1].lat,
                longitude: filteredRoutePoints[filteredRoutePoints.length - 1].lon,
              }}
              pinColor="#ef4444"
              title="End"
              zIndex={10}
            />
          </>
        )}
        {tapDestination && !isNaN(tapDestination.lat) && !isNaN(tapDestination.lon) && (
          <Marker
            coordinate={{
              latitude: tapDestination.lat,
              longitude: tapDestination.lon,
            }}
            pinColor="#3b82f6"
            title="Directions here"
            zIndex={10}
          />
        )}
        {userPosition && !isNaN(userPosition.latitude) && !isNaN(userPosition.longitude) && (
          <Marker
            coordinate={userPosition}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={Platform.OS === "android"}
            zIndex={20}
          >
            <View style={[styles.userPositionDot, { backgroundColor: colors.primary ?? "#3b82f6" }]} />
          </Marker>
        )}
        {osmExtractionPoints
            ?.filter((point) => !isNaN(point.latitude) && !isNaN(point.longitude))
            .map((point, index) => (
          <Marker
            key={`osm-extract-${index}`}
            coordinate={point}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={Platform.OS === "android"}
            zIndex={100 + index}
          >
            <View style={styles.osmMarker}>
              <Text style={styles.osmMarkerText}>{index + 1}</Text>
            </View>
          </Marker>
        ))}
        {osmOverlays && osmExtractedFeatures?.length ? (
          <>
            {osmOverlays.lines.map(({ key, coords }) => (
              <Polyline
                key={`osm-line-${key}`}
                coordinates={coords}
                strokeColor="rgba(34, 197, 94, 0.9)"
                strokeWidth={2}
              />
            ))}
            {osmOverlays.polys.map(({ key, coords }) => (
              <Polygon
                key={`osm-poly-${key}`}
                coordinates={coords}
                fillColor="rgba(234, 179, 8, 0.25)"
                strokeColor="rgba(234, 179, 8, 0.7)"
                strokeWidth={1}
              />
            ))}
            {osmOverlays.points.map(({ key, lat, lon }) => (
              <Marker key={`osm-pt-${key}`} coordinate={{ latitude: lat, longitude: lon }} pinColor="#22c55e" />
            ))}
          </>
        ) : null}
        {osmExtractionPolygon && osmExtractionPolygon.length >= 3 && (() => {
          const closed = osmExtractionPolygon.length > 0
            ? [...osmExtractionPolygon, osmExtractionPolygon[0]]
            : osmExtractionPolygon;
          const outlineBlue = "#3b82f6";
          return (
            <>
              <Polygon
                key="osm-extraction-fill"
                coordinates={closed}
                fillColor="rgba(59, 130, 246, 0.25)"
                strokeColor="transparent"
                strokeWidth={0}
                zIndex={0}
              />
              <Polyline
                key="osm-extraction-boundary"
                coordinates={closed}
                strokeColor={outlineBlue}
                strokeWidth={4}
                zIndex={0}
              />
            </>
          );
        })()}
        {geojsonOverlay?.features?.length ? (
          <Geojson
            geojson={geojsonOverlay as any}
            strokeColor="#3b82f6"
            strokeWidth={2}
            fillColor="rgba(59, 130, 246, 0.15)"
            lineCap="round"
            lineJoin="round"
            zIndex={2}
          />
        ) : null}
        {zonesPreviewPolygons && zonesPreviewPolygons.length > 0
          ? (() => {
              const zoneFillColors = [
                "rgba(249, 115, 22, 0.3)",
                "rgba(59, 130, 246, 0.3)",
                "rgba(34, 197, 94, 0.3)",
                "rgba(168, 85, 247, 0.3)",
                "rgba(234, 179, 8, 0.3)",
                "rgba(239, 68, 68, 0.3)",
              ];
              const zoneStrokeColors = ["#f97316", "#3b82f6", "#22c55e", "#a855f7", "#eab308", "#ef4444"];
              return zonesPreviewPolygons.map((poly, idx) => {
                if (poly.length < 3) return null;
                const closed = [...poly, poly[0]];
                const fillColor = zoneFillColors[idx % zoneFillColors.length];
                const strokeColor = zoneStrokeColors[idx % zoneStrokeColors.length];
                return (
                  <React.Fragment key={`zones-preview-${idx}`}>
                    <Polygon
                      coordinates={closed}
                      fillColor={fillColor}
                      strokeColor="transparent"
                      strokeWidth={0}
                      zIndex={1}
                    />
                    <Polyline
                      coordinates={closed}
                      strokeColor={strokeColor}
                      strokeWidth={3}
                      zIndex={1}
                    />
                  </React.Fragment>
                );
              });
            })()
          : zonesPreviewPolygon && zonesPreviewPolygon.length >= 3 && (() => {
              const closed = [...zonesPreviewPolygon, zonesPreviewPolygon[0]];
              const fillOrange = "rgba(249, 115, 22, 0.25)";
              const strokeOrange = "#f97316";
              return (
                <>
                  <Polygon
                    key="zones-preview-fill"
                    coordinates={closed}
                    fillColor={fillOrange}
                    strokeColor="transparent"
                    strokeWidth={0}
                    zIndex={1}
                  />
                  <Polyline
                    key="zones-preview-boundary"
                    coordinates={closed}
                    strokeColor={strokeOrange}
                    strokeWidth={4}
                    zIndex={1}
                  />
                </>
              );
            })()}
      </MapView>
      <View style={styles.attribution} pointerEvents="none">
        <Text style={styles.attributionText}>
          © OpenStreetMap contributors
        </Text>
      </View>
    </View>
  );
}));

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: "hidden",
  },
  vrpMarkerOuter: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: "#fff",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.25, shadowRadius: 2 },
      android: { elevation: 3 },
    }),
  },
  vrpMarkerText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  osmMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  osmMarkerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  userPositionDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: "#fff",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2 },
      android: { elevation: 4 },
    }),
  },
  attribution: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(255,255,255,0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  attributionText: {
    fontSize: 10,
    color: "#333",
  },
});


