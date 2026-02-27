/**
 * Turn-by-turn navigation — WEB ONLY.
 * Metro resolves to this file on web and to NavigationView.tsx on native.
 * Uses leaflet + react-leaflet only; do not import react-native-maps here.
 * Shows route map and user location when available (watchPosition).
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
import type { MatchedRoute } from "@/lib/mapMatching";
/** Same shape as native NavigationView; defined here so web bundle does not load NavigationView.tsx (react-native-maps). */
export interface OffRoutePayload {
  location: { lat: number; lon: number };
  currentStepIndex: number;
  segmentIndex?: number;
  distance: number;
}

export interface NavigationViewProps {
  matchedRoute: MatchedRoute;
  /** When set, draw this full route for display so segments don't disappear (matched route is downsampled). */
  fullRoutePoints?: Array<{ lat: number; lon: number }>;
  onClose: () => void;
  onOffRoute?: (payload: OffRoutePayload) => void;
  onRecalculate?: (payload: OffRoutePayload) => void;
  /** When true, auto-call onRecalculate on off-route (native only; ignored on web). */
  autoRecalculateOnOffRoute?: boolean;
}

let MapContainer: any;
let TileLayer: any;
let Marker: any;
let Polyline: any;
let useMapHook: any;

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
  useMapHook = leaflet.useMap;
} catch {
  // Leaflet not available
}

function formatDistance(meters: number): string {
  if (meters >= 1609) return `${(meters / 1609).toFixed(1)} mi`;
  if (meters >= 160) return `${Math.round(meters / 160) * 160} ft`;
  return `${Math.round(meters)} ft`;
}

function formatDuration(seconds: number): string {
  const mins = Math.max(0, Math.floor(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${hrs}h ${m}m` : `${hrs}h`;
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

function createUserLocationIcon() {
  const L = require("leaflet");
  return L.divIcon({
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:#2196F3;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></span>`,
    className: "user-location-marker",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const LEAFLET_CSS_ID = "leaflet-css-cdn";
const LEAFLET_CSS_HREF = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";

export default function NavigationView({
  matchedRoute,
  fullRoutePoints,
  onClose,
  onRecalculate,
  autoRecalculateOnOffRoute: _autoRecalculateOnOffRoute,
}: NavigationViewProps) {
  const colors = useColors();
  const [mapTypePreference] = useMapType();
  // Use bright orange for route line visibility on map (theme primary is near-white in dark mode)
  const primary = "#F97316";
  const { width, height } = Dimensions.get("window");
  const isDark = mapTypePreference === "dark";
  const tileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution = isDark
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);

  // Phase 1.2: Ensure Leaflet CSS is loaded when nav map is shown (idempotent).
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

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setUserPosition([pos.coords.latitude, pos.coords.longitude]),
      () => setUserPosition(null),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const matchedPositions = useMemo(
    () => matchedRoute.matchedGeometry.map((p) => [p.lat, p.lon] as [number, number]),
    [matchedRoute.matchedGeometry]
  );

  const routePositions = useMemo(() => {
    if (fullRoutePoints && fullRoutePoints.length >= 2) {
      return fullRoutePoints.map((p) => [p.lat, p.lon] as [number, number]);
    }
    return matchedPositions;
  }, [fullRoutePoints, matchedPositions]);

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

  const mapHeight = height;
  const hasMap = MapContainer && TileLayer && routePositions.length >= 2;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Full-screen map */}
      {!hasMap && routePositions.length >= 2 && (
        <View style={[styles.mapPlaceholder, styles.mapFull]}>
          <Text style={[styles.mapPlaceholderText, { color: colors.muted }]}>
            Map view unavailable.
          </Text>
        </View>
      )}
      {hasMap && (
        <View style={[styles.mapWrap, styles.mapFull]}>
          <div style={{ width: "100%", height: mapHeight, position: "relative" }}>
            <MapContainer
              bounds={bounds ?? undefined}
              boundsOptions={bounds ? { padding: [30, 30] } : undefined}
              center={bounds ? undefined : [routePositions[0][0], routePositions[0][1]]}
              zoom={bounds ? undefined : 14}
              style={{ height: mapHeight, width: "100%" }}
            >
              <TileLayer
                attribution={tileAttribution}
                url={tileUrl}
              />
              <Polyline
                positions={routePositions}
                color={primary}
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
              {userPosition != null && (
                <Marker position={userPosition} icon={createUserLocationIcon()} title="Your location" />
              )}
            </MapContainer>
          </div>
        </View>
      )}

      {/* Minimal overlay: Close + distance/duration + Recalculate from here */}
      <View style={[styles.overlay, { backgroundColor: colors.background + "E6" }]}>
        <Text style={[styles.overlayStat, { color: colors.foreground }]}>
          {formatDistance(matchedRoute.totalDistance)} · {formatDuration(matchedRoute.totalDuration)}
        </Text>
        <View style={styles.overlayActions}>
          {onRecalculate && matchedRoute.matchedGeometry.length > 1 && (
            <TouchableOpacity
              style={[styles.recalculateFromHereButton, { backgroundColor: colors.muted + "CC" }]}
              onPress={() => {
                const geom = matchedRoute.matchedGeometry;
                const getPayload = (location: { lat: number; lon: number }, segmentIndex: number) =>
                  onRecalculate({
                    location,
                    currentStepIndex: 0,
                    segmentIndex,
                    distance: 0,
                  });
                if (typeof navigator !== "undefined" && navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                      let bestIdx = 0;
                      let bestDist = Infinity;
                      for (let i = 0; i < geom.length - 1; i++) {
                        const d = haversineDistance(loc, geom[i]);
                        if (d < bestDist) {
                          bestDist = d;
                          bestIdx = i;
                        }
                      }
                      getPayload(loc, bestIdx);
                    },
                    () => {
                      getPayload(geom[0], 0);
                    },
                    { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 }
                  );
                } else {
                  getPayload(geom[0], 0);
                }
              }}
            >
              <Text style={styles.recalculateFromHereText}>Recalculate from here</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: primary }]}
            onPress={onClose}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  overlayStat: {
    fontSize: 14,
    fontWeight: "600",
  },
  overlayActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  recalculateFromHereButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  recalculateFromHereText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  closeButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
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
