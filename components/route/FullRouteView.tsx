/**
 * Full route mode — react-native-maps with the route polyline,
 * current truck position (live GPS), and the next pending stop highlighted.
 *
 * Used for planning and overview. Consumes the same route data as MinimalRouteView.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useTheme } from "@/lib/theme-provider";
import { useRouteDisplayData, formatEta } from "@/hooks/useRouteDisplayData";
import { RouteMap, type RouteMapRef } from "@/components/route-map";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import type { CollectionPoint } from "@/types";

export function FullRouteView() {
  const { theme } = useTheme();
  const data = useRouteDisplayData();
  const actions = useMapActions();
  const mapRef = useRef<RouteMapRef>(null);

  const showAerial = useMapStateStore((s) => s.showAerial);
  const userBearing = useMapStateStore((s) => s.userBearing);

  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [statsBarHeight, setStatsBarHeight] = useState(68);

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) {
        setContainerSize({ width, height });
      }
    },
    [],
  );

  const handleStatsLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const { height } = e.nativeEvent.layout;
      if (height > 0) {
        setStatsBarHeight(height);
      }
    },
    [],
  );

  useEffect(() => {
    const { loadRoute, loadImportedPoints } = useMapStateStore.getState();
    loadRoute();
    loadImportedPoints();
  }, []);

  // Watch truck position when Full mode is active
  useEffect(() => {
    if (Platform.OS === "web") return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const Location = await import("expo-location");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 20,
            timeInterval: 5000,
          },
          (loc) => {
            const h = loc.coords?.heading;
            if (h != null && !Number.isNaN(h) && h >= 0 && h < 360) {
              actions.setUserBearing(h);
            }
          },
        );
        if (cancelled) {
          subscription.remove();
        } else {
          sub = subscription;
        }
      } catch {
        // location unavailable
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove?.();
      actions.setUserBearing(null);
    };
  }, [actions]);

  const collectionPointsForMap: CollectionPoint[] = useMemo(() => {
    if (!data.stops.length) return [];
    return data.stops.filter((s) => s.status !== "completed");
  }, [data.stops]);

  const handlePointClick = useCallback(
    (point: CollectionPoint) => {
      actions.setSelectedPoint(point);
    },
    [actions],
  );

  const handleMapLoad = useCallback(() => {
    actions.setMapLoading(false);
    actions.setMapError(null);
  }, [actions]);

  const mapWidth = containerSize?.width ?? Dimensions.get("window").width;
  const mapHeight =
    (containerSize?.height ?? Dimensions.get("window").height) - statsBarHeight;

  const isDark = theme.bg === "#0C0C0C";
  const statBg = isDark ? "#1C1C1C" : "#F5F5F4";

  if (!data.hasRoute) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.textTertiary} />
        <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
          No route loaded
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.bg }]}
      onLayout={handleLayout}
    >
      {/* Compact stats overlay at top */}
      <View
        onLayout={handleStatsLayout}
        style={[
          styles.statsOverlay,
          {
            backgroundColor: isDark
              ? "rgba(12, 12, 12, 0.92)"
              : "rgba(250, 250, 249, 0.92)",
            borderBottomColor: theme.border,
          },
        ]}
      >
        <View style={styles.statsRow}>
          <View style={[styles.statChip, { backgroundColor: statBg }]}>
            <Text style={[styles.statChipValue, { color: theme.text }]}>
              {data.distanceKm} km
            </Text>
            <Text style={[styles.statChipLabel, { color: theme.textTertiary }]}>
              dist
            </Text>
          </View>
          <View style={[styles.statChip, { backgroundColor: statBg }]}>
            <Text style={[styles.statChipValue, { color: theme.text }]}>
              {data.remainingStops}
            </Text>
            <Text style={[styles.statChipLabel, { color: theme.textTertiary }]}>
              stops
            </Text>
          </View>
          <View style={[styles.statChip, { backgroundColor: statBg }]}>
            <Text style={[styles.statChipValue, { color: theme.text }]}>
              {formatEta(data.etaMinutes)}
            </Text>
            <Text style={[styles.statChipLabel, { color: theme.textTertiary }]}>
              ETA
            </Text>
          </View>
          <View style={[styles.statChip, { backgroundColor: statBg }]}>
            <Text style={[styles.statChipValue, { color: theme.success }]}>
              {data.completionPct}%
            </Text>
            <Text style={[styles.statChipLabel, { color: theme.textTertiary }]}>
              done
            </Text>
          </View>
        </View>

        {data.nextStop && (
          <View style={styles.nextStopRow}>
            <View style={styles.nextDot} />
            <Text
              style={[styles.nextStopText, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              Next: {data.nextStop.address}
            </Text>
          </View>
        )}
      </View>

      {/* Map fills remaining space */}
      <View style={styles.mapContainer}>
        <RouteMap
          ref={mapRef}
          collectionPoints={collectionPointsForMap}
          routePoints={data.routeCoords}
          height={Math.max(mapHeight, 200)}
          width={Math.max(mapWidth, 200)}
          onPointClick={handlePointClick}
          onLoad={handleMapLoad}
          userBearing={userBearing}
          showAerial={showAerial}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statsOverlay: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  statsRow: {
    flexDirection: "row",
    gap: 6,
  },
  statChip: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  statChipValue: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  statChipLabel: {
    fontSize: 10,
    fontWeight: "500",
    marginTop: 1,
  },
  nextStopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  nextDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F97316",
  },
  nextStopText: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  mapContainer: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
  },
});
