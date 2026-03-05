/**
 * Route map implementation using MapLibre (vector) on native.
 * Matches RouteMapProps / RouteMapRef so it can replace the react-native-maps implementation.
 */
import React, {
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import { View, StyleSheet, Text, type NativeSyntheticEvent } from "react-native";
import {
  MapView,
  Camera,
  ShapeSource,
  LineLayer,
  FillLayer,
  PointAnnotation,
  UserLocation,
  type MapViewRef,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import { useColors } from "@/hooks/use-colors";
import { useMapType } from "@/lib/map-type-preference";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useMapOrientation } from "@/lib/map-orientation-preference";
import type { CollectionPoint } from "@/types";
import { MAPLIBRE_STYLE_OSM, MAPLIBRE_STYLE_OSM_DARK, MAPLIBRE_RENDER_CONFIG } from "./constants";
import { buildOvertureStyleUri, PMTILES_CITIES } from "./overture-style";

export interface RouteMapRef {
  zoomIn: () => void;
  zoomOut: () => void;
  centerOnUser: () => Promise<void>;
  resetNorth: () => void;
}

export interface SegmentRisk {
  segmentIndex: number;
  riskScore: number;
}

export interface RouteMapProps {
  collectionPoints: CollectionPoint[];
  routePoints?: Array<{ lat: number; lon: number; label?: string }>;
  segmentRisks?: SegmentRisk[];
  height?: number;
  width?: number;
  onPointClick?: (point: CollectionPoint) => void;
  onMapPress?: (lat: number, lon: number) => void;
  onMapLongPress?: (lat: number, lon: number) => void;
  tapDestination?: { lat: number; lon: number } | null;
  onLoad?: () => void;
  onError?: (error: string) => void;
  hasOfflineRegions?: boolean;
  userBearing?: number | null;
  showAerial?: boolean;
  showTraffic?: boolean;
  osmExtractionPolygon?: Array<{ latitude: number; longitude: number }>;
  osmExtractionPoints?: Array<{ latitude: number; longitude: number }>;
  osmExtractedFeatures?: Array<{
    id: string;
    geometry: {
      type: "Point" | "LineString" | "Polygon";
      coordinates: number[] | number[][] | number[][][];
    };
  }>;
  osmExtractorVisible?: boolean;
  /** Show Overture Maps transportation overlay from PMTiles. */
  showOverture?: boolean;
  /** Zones panel: preview polygon (boundary of selected zone result). */
  zonesPreviewPolygon?: Array<{ latitude: number; longitude: number }>;
  /** Zones panel: sector division — one polygon per zone. */
  zonesPreviewPolygons?: Array<Array<{ latitude: number; longitude: number }>>;
  /** Which city's PMTiles to load (default: auto-detect or "montreal"). */
  overtureCity?: string;
}

const DEFAULT_CENTER: [number, number] = [-73.6, 45.5];
const DEFAULT_ZOOM = 10;

function getMarkerColor(collectionType?: string): string {
  if (collectionType === "residential") return "#3b82f6";
  if (collectionType === "commercial") return "#f59e0b";
  if (collectionType === "industrial") return "#ef4444";
  return "#6366f1";
}

function segmentRiskToColor(
  riskScore: number,
  colors: ReturnType<typeof useColors>
): string {
  if (riskScore >= 70) return colors.error ?? "#ef4444";
  if (riskScore >= 40) return colors.warning ?? "#ff6b4a";
  return colors.success ?? "#22c55e";
}

/** GeoJSON LineString from [{ lat, lon }, ...] */
function routeToLineString(
  points: Array<{ lat: number; lon: number }>
): GeoJSON.LineString {
  return {
    type: "LineString",
    coordinates: points.map((p) => [p.lon, p.lat]),
  };
}

function extractCoordsFromPressEvent(e: unknown): { lat: number; lon: number } | null {
  const ev = e as NativeSyntheticEvent<{ payload: GeoJSON.Feature }> | undefined;
  const payload = ev?.nativeEvent?.payload ?? (e as GeoJSON.Feature | undefined);
  const geom = payload?.geometry;
  if (geom?.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    const [lon, lat] = geom.coordinates;
    return { lat: Number(lat), lon: Number(lon) };
  }
  return null;
}

export const MapLibreRouteMap = React.memo(
  forwardRef<RouteMapRef, RouteMapProps>(function MapLibreRouteMap(
    {
      collectionPoints,
      routePoints,
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
      showTraffic: _showTraffic,
      osmExtractionPolygon,
      osmExtractionPoints,
      osmExtractedFeatures,
      osmExtractorVisible: _osmExtractorVisible,
      showOverture = false,
      overtureCity,
      zonesPreviewPolygon,
      zonesPreviewPolygons,
    },
    ref
  ) {
    const colors = useColors();
    const showRouteMarkers = useMapDisplayStore((s) => s.showRouteMarkers);
    const showRouteLine = useMapDisplayStore((s) => s.showRouteLine);
    const mapRef = useRef<MapViewRef>(null);
    const cameraRef = useRef<CameraRef>(null);
    const lastCenterRef = useRef<GeoJSON.Position | null>(null);
    const lastZoomRef = useRef<number | null>(null);
    const prevStyleUrlRef = useRef<string>("");
    const [mapTypePreference] = useMapType();
    const [orientation] = useMapOrientation();

    const resolvedCity = overtureCity ?? PMTILES_CITIES[0] ?? "montreal";

    const styleUrl = useMemo(() => {
      const baseStyle =
        showAerial
          ? MAPLIBRE_STYLE_OSM
          : mapTypePreference === "dark"
            ? MAPLIBRE_STYLE_OSM_DARK
            : MAPLIBRE_STYLE_OSM;

      if (showOverture && PMTILES_CITIES.includes(resolvedCity)) {
        return buildOvertureStyleUri({
          baseStyleUrl: baseStyle,
          city: resolvedCity,
          showRoads: true,
        });
      }
      return baseStyle;
    }, [showAerial, mapTypePreference, showOverture, resolvedCity]);

    const pointsForBounds = useMemo(
      () =>
        collectionPoints.length > 0
          ? collectionPoints.map((p) => ({ lat: p.latitude, lon: p.longitude }))
          : (routePoints ?? []).length > 0
            ? routePoints!
            : [],
      [collectionPoints, routePoints]
    );

    const initialCenter: GeoJSON.Position = useMemo(() => {
      if (pointsForBounds.length === 0) return DEFAULT_CENTER;
      const lats = pointsForBounds.map((p) => p.lat);
      const lons = pointsForBounds.map((p) => p.lon);
      return [
        (Math.min(...lons) + Math.max(...lons)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2,
      ];
    }, [pointsForBounds]);

    const routeCoords = useMemo(
      () => (routePoints ?? []).map((p) => ({ lat: p.lat, lon: p.lon })),
      [routePoints]
    );

    const routeLineString = useMemo(
      () =>
        routeCoords.length >= 2
          ? routeToLineString(routeCoords)
          : null,
      [routeCoords]
    );

    const segmentLines = useMemo(() => {
      if (
        !segmentRisks?.length ||
        !routePoints ||
        routePoints.length < 2
      )
        return null;
      const riskMap = new Map(segmentRisks.map((s) => [s.segmentIndex, s.riskScore]));
      return routePoints.slice(0, -1).map((_, i) => {
        const p1 = routePoints[i];
        const p2 = routePoints[i + 1];
        const risk = riskMap.get(i) ?? 0;
        const color = segmentRiskToColor(risk, colors);
        return {
          id: `seg-${i}`,
          coordinates: [
            [p1.lon, p1.lat],
            [p2.lon, p2.lat],
          ] as [number, number][],
          color,
        };
      });
    }, [routePoints, segmentRisks, colors]);

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => {
          mapRef.current?.getZoom().then((z) => {
            if (z != null) cameraRef.current?.zoomTo(Math.min(z + 1, 20), 200);
          });
        },
        zoomOut: () => {
          mapRef.current?.getZoom().then((z) => {
            if (z != null) cameraRef.current?.zoomTo(Math.max(z - 1, 2), 200);
          });
        },
        centerOnUser: async () => {
          try {
            const Loc = await import("expo-location");
            const { status } = await Loc.requestForegroundPermissionsAsync();
            if (status !== "granted") return;
            const pos = await (
              Loc as {
                getCurrentPositionAsync?: (o?: object) => Promise<{
                  coords: { latitude: number; longitude: number };
                }>;
              }
            ).getCurrentPositionAsync?.({});
            if (pos?.coords)
              cameraRef.current?.flyTo(
                [pos.coords.longitude, pos.coords.latitude],
                300
              );
          } catch {
            /* ignore */
          }
        },
        resetNorth: () => {
          cameraRef.current?.setCamera({ heading: 0, animationDuration: 200 });
        },
      }),
      []
    );

    const handlePress = useCallback(
      (e: unknown) => {
        const coords = extractCoordsFromPressEvent(e);
        if (coords) onMapPress?.(coords.lat, coords.lon);
      },
      [onMapPress]
    );

    const handleLongPress = useCallback(
      (e: unknown) => {
        const coords = extractCoordsFromPressEvent(e);
        if (coords) onMapLongPress?.(coords.lat, coords.lon);
      },
      [onMapLongPress]
    );

    const hasLoadedRef = useRef(false);
    const handleMapLoaded = useCallback(() => {
      hasLoadedRef.current = true;
      if (pointsForBounds.length >= 2 && cameraRef.current) {
        const lats = pointsForBounds.map((p) => p.lat);
        const lons = pointsForBounds.map((p) => p.lon);
        const pad = 0.02;
        const sw: GeoJSON.Position = [
          Math.min(...lons) - pad,
          Math.min(...lats) - pad,
        ];
        const ne: GeoJSON.Position = [
          Math.max(...lons) + pad,
          Math.max(...lats) + pad,
        ];
        cameraRef.current.fitBounds(ne, sw, 80, 0);
      }
      lastCenterRef.current = initialCenter;
      lastZoomRef.current = pointsForBounds.length >= 2 ? 12 : DEFAULT_ZOOM;
      prevStyleUrlRef.current = styleUrl;
      onLoad?.();
    }, [onLoad, pointsForBounds, initialCenter, styleUrl]);

    const handleRegionDidChange = useCallback(() => {
      mapRef.current?.getCenter().then((c) => {
        if (c) lastCenterRef.current = c;
      });
      mapRef.current?.getZoom().then((z) => {
        if (z != null) lastZoomRef.current = z;
      });
    }, []);

    const handleStyleLoaded = useCallback(() => {
      const prev = prevStyleUrlRef.current;
      prevStyleUrlRef.current = styleUrl;
      if (prev !== "" && prev !== styleUrl) {
        const center = lastCenterRef.current;
        const zoom = lastZoomRef.current;
        if (center && zoom != null && cameraRef.current) {
          cameraRef.current.setCamera({
            centerCoordinate: center,
            zoomLevel: zoom,
            animationDuration: 0,
          });
        }
      }
    }, [styleUrl]);

    useEffect(() => {
      if (orientation !== "course" || userBearing == null || userBearing < 0 || userBearing >= 360)
        return;
      cameraRef.current?.setCamera({ heading: userBearing, animationDuration: 0 });
    }, [orientation, userBearing]);

    const safeWidth = typeof width === "number" && width > 0 ? width : 320;
    const safeHeight = typeof height === "number" && height > 0 ? height : 400;
    const rotateEnabled = orientation !== "north";

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
          mapStyle={styleUrl}
          onPress={handlePress}
          onLongPress={handleLongPress}
          onDidFinishLoadingMap={handleMapLoaded}
          onDidFinishLoadingStyle={handleStyleLoaded}
          onRegionDidChange={handleRegionDidChange}
          preferredFramesPerSecond={MAPLIBRE_RENDER_CONFIG.preferredFramesPerSecond}
          localizeLabels={MAPLIBRE_RENDER_CONFIG.localizeLabels}
          regionDidChangeDebounceTime={MAPLIBRE_RENDER_CONFIG.regionDidChangeDebounceTime}
          zoomEnabled
          scrollEnabled
          rotateEnabled={rotateEnabled}
          pitchEnabled={false}
          attributionEnabled={true}
          logoEnabled={false}
        >
          <Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: initialCenter,
              zoomLevel: pointsForBounds.length >= 2 ? 12 : DEFAULT_ZOOM,
              animationDuration: 0,
            }}
            minZoomLevel={2}
            maxZoomLevel={20}
          />
          <UserLocation visible={true} />

          {showRouteLine && routeLineString && !segmentLines && (
            <ShapeSource id="route-line" shape={routeLineString}>
              <LineLayer
                id="route-layer"
                style={{
                  lineColor: "#F97316",
                  lineWidth: 4,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </ShapeSource>
          )}

          {showRouteLine && segmentLines?.map((seg) => (
            <ShapeSource
              key={seg.id}
              id={seg.id}
              shape={{
                type: "LineString",
                coordinates: seg.coordinates,
              }}
            >
              <LineLayer
                id={`${seg.id}-layer`}
                style={{
                  lineColor: seg.color,
                  lineWidth: 4,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </ShapeSource>
          ))}

          {osmExtractionPolygon && osmExtractionPolygon.length >= 3 && (
            <ShapeSource
              id="osm-extraction-polygon"
              shape={{
                type: "Polygon",
                coordinates: [
                  [
                    ...osmExtractionPolygon.map((p) => [p.longitude, p.latitude] as [number, number]),
                    [osmExtractionPolygon[0].longitude, osmExtractionPolygon[0].latitude],
                  ],
                ],
              }}
            >
              <FillLayer
                id="osm-extraction-fill"
                style={{
                  fillColor: "rgba(59, 130, 246, 0.25)",
                  fillOutlineColor: "#3b82f6",
                }}
              />
              <LineLayer
                id="osm-extraction-boundary"
                style={{
                  lineColor: "#3b82f6",
                  lineWidth: 4,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </ShapeSource>
          )}

          {zonesPreviewPolygon && zonesPreviewPolygon.length >= 3 && (
            <ShapeSource
              id="zones-preview-polygon"
              shape={{
                type: "Polygon",
                coordinates: [
                  [
                    ...zonesPreviewPolygon.map((p) => [p.longitude, p.latitude] as [number, number]),
                    [zonesPreviewPolygon[0].longitude, zonesPreviewPolygon[0].latitude],
                  ],
                ],
              }}
            >
              <FillLayer
                id="zones-preview-fill"
                style={{
                  fillColor: "rgba(249, 115, 22, 0.25)",
                  fillOutlineColor: "#f97316",
                }}
              />
              <LineLayer
                id="zones-preview-boundary"
                style={{
                  lineColor: "#f97316",
                  lineWidth: 4,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </ShapeSource>
          )}

          {osmExtractedFeatures?.map((f) => {
            const geom = f.geometry;
            if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates))
              return null;
            const coords = (geom.coordinates as number[][]).map(
              (c) => [c[0], c[1]] as [number, number]
            );
            if (coords.length < 2) return null;
            return (
              <ShapeSource key={f.id} id={`osm-line-${f.id}`} shape={{ type: "LineString", coordinates: coords }}>
                <LineLayer
                  id={`osm-line-layer-${f.id}`}
                  style={{
                    lineColor: "rgba(34, 197, 94, 0.9)",
                    lineWidth: 2,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
              </ShapeSource>
            );
          })}

          {showRouteMarkers && collectionPoints.map((point) => (
            <PointAnnotation
              key={point.id}
              id={point.id}
              coordinate={[point.longitude, point.latitude]}
              onSelected={() => onPointClick?.(point)}
            >
              <View
                style={[
                  styles.marker,
                  { backgroundColor: getMarkerColor(point.collectionType) },
                ]}
              />
            </PointAnnotation>
          ))}

          {routePoints && routePoints.length >= 2 && !segmentRisks?.length && (
            <>
              <PointAnnotation
                id="route-start"
                coordinate={[routePoints[0].lon, routePoints[0].lat]}
              >
                <View style={[styles.marker, styles.startMarker]} />
              </PointAnnotation>
              {routePoints.length > 1 && (
                <PointAnnotation
                  id="route-end"
                  coordinate={[
                    routePoints[routePoints.length - 1].lon,
                    routePoints[routePoints.length - 1].lat,
                  ]}
                >
                  <View style={[styles.marker, styles.endMarker]} />
                </PointAnnotation>
              )}
            </>
          )}

          {tapDestination && (
            <PointAnnotation
              id="tap-destination"
              coordinate={[tapDestination.lon, tapDestination.lat]}
            >
              <View style={[styles.marker, styles.destMarker]} />
            </PointAnnotation>
          )}

          {osmExtractionPoints?.map((point, index) => (
            <PointAnnotation
              key={`osm-${index}`}
              id={`osm-pt-${index}`}
              coordinate={[point.longitude, point.latitude]}
            >
              <View style={styles.osmMarker}>
                <Text style={styles.osmMarkerText}>{index + 1}</Text>
              </View>
            </PointAnnotation>
          ))}
        </MapView>
        <View style={styles.attribution} pointerEvents="none">
          <Text style={styles.attributionText}>
            © OpenStreetMap contributors{showOverture ? " | Overture Maps" : ""}
          </Text>
        </View>
      </View>
    );
  })
);

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: "hidden",
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#fff",
  },
  startMarker: {
    backgroundColor: "#22c55e",
  },
  endMarker: {
    backgroundColor: "#ef4444",
  },
  destMarker: {
    backgroundColor: "#3b82f6",
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
