/**
 * Collection Route Navigator — WEB ONLY.
 * Metro resolves to this file on web and to CollectionNavigator.tsx on native.
 * Uses leaflet + react-leaflet only; do not import react-native-maps here.
 * Shows collection route map with colored segments and progress tracking.
 */

import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useMapType } from "@/lib/map-type-preference";
import type { CollectionPoint } from "@/types";

export interface CollectionNavigatorProps {
  routePoints: Array<{ lat: number; lon: number }>;
  collectionPoints: CollectionPoint[];
  onClose: () => void;
}

let MapContainer: any;
let TileLayer: any;
let Marker: any;
let Polyline: any;

try {
  const leaflet = require("react-leaflet");
  const L = require("leaflet");
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
    iconUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
    shadowUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  });
  MapContainer = leaflet.MapContainer;
  TileLayer = leaflet.TileLayer;
  Marker = leaflet.Marker;
  Polyline = leaflet.Polyline;
} catch {
  // Leaflet not available
}

const LEAFLET_CSS_ID = "leaflet-css-cdn";
const LEAFLET_CSS_HREF =
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";

const COLORS = {
  route: "#F97316",
  collectionPoint: "#22c55e",
} as const;

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function haversineDistance(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function CollectionNavigator({
  routePoints,
  collectionPoints,
  onClose,
}: CollectionNavigatorProps) {
  const colors = useColors();
  const [mapTypePreference] = useMapType();
  const { height } = Dimensions.get("window");
  const isDark = mapTypePreference === "dark";
  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution = isDark
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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

  const routePositions = useMemo(
    () => routePoints.map((p) => [p.lat, p.lon] as [number, number]),
    [routePoints]
  );

  const bounds = useMemo(() => {
    if (routePositions.length === 0) return null;
    const lats = routePositions.map((p) => p[0]);
    const lons = routePositions.map((p) => p[1]);
    const pad = 0.005;
    return [
      [Math.min(...lats) - pad, Math.min(...lons) - pad],
      [Math.max(...lats) + pad, Math.max(...lons) + pad],
    ] as [[number, number], [number, number]];
  }, [routePositions]);

  const totalDistance = useMemo(() => {
    let dist = 0;
    for (let i = 1; i < routePoints.length; i++) {
      dist += haversineDistance(routePoints[i - 1], routePoints[i]);
    }
    return dist;
  }, [routePoints]);

  const hasMap = MapContainer && TileLayer && routePositions.length >= 2;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {!hasMap && routePositions.length >= 2 && (
        <View style={[styles.mapPlaceholder, styles.mapFull]}>
          <Text style={[styles.mapPlaceholderText, { color: colors.muted }]}>
            Map view unavailable.
          </Text>
        </View>
      )}
      {hasMap && (
        <View style={[styles.mapWrap, styles.mapFull]}>
          <div style={{ width: "100%", height, position: "relative" }}>
            <MapContainer
              bounds={bounds ?? undefined}
              boundsOptions={bounds ? { padding: [30, 30] } : undefined}
              center={
                bounds ? undefined : [routePositions[0][0], routePositions[0][1]]
              }
              zoom={bounds ? undefined : 14}
              style={{ height, width: "100%" }}
            >
              <TileLayer attribution={tileAttribution} url={tileUrl} />
              <Polyline
                positions={routePositions}
                color={COLORS.route}
                weight={6}
                opacity={1}
              />
              {routePositions.length > 0 && routePositions[0] && (
                <Marker position={routePositions[0]} title="Start" />
              )}
              {routePositions.length > 0 && (
                <Marker
                  position={routePositions[routePositions.length - 1]}
                  title="End"
                />
              )}
              {collectionPoints.map((cp) => (
                <Marker
                  key={cp.id}
                  position={[cp.latitude, cp.longitude]}
                  title={cp.address || "Collection point"}
                />
              ))}
            </MapContainer>
          </div>
        </View>
      )}

      <View style={[styles.overlay, { backgroundColor: colors.background + "E6" }]}>
        <Text style={[styles.overlayStat, { color: colors.foreground }]}>
          {collectionPoints.length} stops · {formatDistance(totalDistance)}
        </Text>
        <Text style={[styles.overlayNote, { color: colors.muted }]}>
          Collection navigation is only available on mobile devices.
        </Text>
        <TouchableOpacity
          style={[styles.closeButton, { backgroundColor: COLORS.route }]}
          onPress={onClose}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapFull: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  mapWrap: {
    width: "100%",
    overflow: "hidden",
  },
  overlay: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 16,
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  overlayStat: {
    fontSize: 16,
    fontWeight: "600",
  },
  overlayNote: {
    fontSize: 13,
    textAlign: "center",
  },
  closeButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 4,
  },
  closeButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  mapPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
  },
  mapPlaceholderText: {
    fontSize: 14,
  },
});
