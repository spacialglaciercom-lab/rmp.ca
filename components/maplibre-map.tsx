import React, { useEffect, useRef, useMemo } from "react";
import { View, Text, Platform, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { buildPMTilesStyle } from "@/lib/pmtiles-source";
import type { CollectionPoint } from "@/types";

// Only load MapLibre on native platforms
let MapLibreGL: any;
if (Platform.OS !== "web") {
  try {
    MapLibreGL = require("@maplibre/maplibre-react-native").default;
  } catch {
    // not available
  }
}

// PMTiles protocol adapter — registered once
let pmtilesProtocolRegistered = false;

function registerPMTilesProtocol() {
  if (pmtilesProtocolRegistered || !MapLibreGL) return;
  try {
    const { PMTiles } = require("pmtiles");

    // Cache of PMTiles instances keyed by URL
    const cache = new Map<string, InstanceType<typeof PMTiles>>();

    MapLibreGL.addCustomProtocol("pmtiles", async (params: { url: string }) => {
      try {
        // Strip the pmtiles:// prefix to get the real URL
        const url = params.url.replace("pmtiles://", "");
        const pmtilesUrl = url.split("/").slice(0, -1).join("/") + ".pmtiles";
        // Remaining path parts encode z/x/y
        const parts = url.split("/");
        const y = parseInt(parts.pop()!, 10);
        const x = parseInt(parts.pop()!, 10);
        const z = parseInt(parts.pop()!, 10);

        if (isNaN(z) || isNaN(x) || isNaN(y)) {
          return { data: new ArrayBuffer(0) };
        }

        if (!cache.has(pmtilesUrl)) {
          cache.set(pmtilesUrl, new PMTiles(pmtilesUrl));
        }
        const tile = await cache.get(pmtilesUrl)!.getZxy(z, x, y);
        if (!tile?.data) return { data: new ArrayBuffer(0) };
        return { data: tile.data };
      } catch (e) {
        // Return empty tile instead of letting the rejection crash native code
        console.warn("[pmtiles] Tile fetch failed:", e);
        return { data: new ArrayBuffer(0) };
      }
    });

    pmtilesProtocolRegistered = true;
  } catch (e) {
    console.warn("[maplibre-map] Failed to register pmtiles protocol:", e);
  }
}

export interface MapLibreMapProps {
  collectionPoints?: CollectionPoint[];
  routePoints?: Array<{ lat: number; lon: number }>;
  pmtilesUrl: string;
  height?: number;
  onPointClick?: (point: CollectionPoint) => void;
}

export const MapLibreMap = React.memo(function MapLibreMap({
  collectionPoints = [],
  routePoints,
  pmtilesUrl,
  height = 400,
  onPointClick,
}: MapLibreMapProps) {
  const colors = useColors();
  const mapRef = useRef<any>(null);

  // Register protocol once on mount
  useEffect(() => {
    registerPMTilesProtocol();
  }, []);

  const styleJSON = useMemo(() => buildPMTilesStyle({ url: pmtilesUrl }), [pmtilesUrl]);

  // Compute initial center/zoom from points
  const initialCamera = useMemo(() => {
    const allLats = [
      ...collectionPoints.map((p) => p.latitude),
      ...(routePoints?.map((p) => p.lat) ?? []),
    ];
    const allLons = [
      ...collectionPoints.map((p) => p.longitude),
      ...(routePoints?.map((p) => p.lon) ?? []),
    ];

    if (allLats.length === 0) {
      // Default to Toronto
      return { centerCoordinate: [-79.38, 43.65], zoomLevel: 11 };
    }

    const minLat = Math.min(...allLats);
    const maxLat = Math.max(...allLats);
    const minLon = Math.min(...allLons);
    const maxLon = Math.max(...allLons);

    return {
      centerCoordinate: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
      zoomLevel: 12,
      bounds: {
        ne: [maxLon, maxLat],
        sw: [minLon, minLat],
        paddingTop: 40,
        paddingBottom: 40,
        paddingLeft: 40,
        paddingRight: 40,
      },
    };
  }, [collectionPoints, routePoints]);

  // Build GeoJSON for route polyline overlay
  const routeGeoJSON = useMemo(() => {
    if (!routePoints || routePoints.length < 2) return null;
    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: routePoints.map((p) => [p.lon, p.lat]),
          },
        },
      ],
    };
  }, [routePoints]);

  // Build GeoJSON for collection point markers
  const pointsGeoJSON = useMemo(() => {
    if (collectionPoints.length === 0) return null;
    return {
      type: "FeatureCollection" as const,
      features: collectionPoints.map((p) => ({
        type: "Feature" as const,
        properties: {
          id: p.id,
          address: p.address,
          collectionType: p.collectionType,
          status: p.status,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [p.longitude, p.latitude],
        },
      })),
    };
  }, [collectionPoints]);

  // Web fallback
  if (Platform.OS === "web" || !MapLibreGL) {
    return (
      <View
        style={{
          height,
          backgroundColor: colors.surface,
          justifyContent: "center",
          alignItems: "center",
          borderRadius: 12,
        }}
      >
        <Text style={{ color: colors.muted }}>
          MapLibre is only available on native platforms
        </Text>
      </View>
    );
  }

  return (
    <View style={[{ height, borderRadius: 12, overflow: "hidden" }]}>
      <MapLibreGL.MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        styleJSON={JSON.stringify(styleJSON)}
        logoEnabled={false}
        attributionEnabled={false}
      >
        <MapLibreGL.Camera
          defaultSettings={initialCamera}
        />

        {/* Route polyline overlay */}
        {routeGeoJSON && (
          <MapLibreGL.ShapeSource id="route-line" shape={routeGeoJSON}>
            <MapLibreGL.LineLayer
              id="route-line-layer"
              style={{
                lineColor: "#10b981",
                lineWidth: 3,
                lineDasharray: [5, 3],
                lineOpacity: 0.8,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {/* Collection point markers */}
        {pointsGeoJSON && (
          <MapLibreGL.ShapeSource
            id="collection-points"
            shape={pointsGeoJSON}
            onPress={(e: any) => {
              const feature = e?.features?.[0];
              if (feature && onPointClick) {
                const pt = collectionPoints.find(
                  (p) => p.id === feature.properties?.id,
                );
                if (pt) onPointClick(pt);
              }
            }}
          >
            <MapLibreGL.CircleLayer
              id="collection-points-circle"
              style={{
                circleRadius: 6,
                circleColor: "#3b82f6",
                circleStrokeColor: "#ffffff",
                circleStrokeWidth: 2,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}
      </MapLibreGL.MapView>
    </View>
  );
});
