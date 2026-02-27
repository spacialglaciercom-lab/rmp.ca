/**
 * Minimal route mode — stop list + stats strip.
 *
 * No map rendered, no GPS polling beyond what the OS provides passively.
 * Designed for active driving: large touch targets, high-contrast status colors,
 * glanceable stats bar at the top.
 */

import React, { useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { useTheme } from "@/lib/theme-provider";
import { MinimalCard } from "@/components/minimal";
import {
  useRouteDisplayData,
  formatEta,
  type RouteDisplayStats,
} from "@/hooks/useRouteDisplayData";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { storage } from "@/lib/storage";
import type { CollectionPoint } from "@/types";

function StatsBar({ data }: { data: RouteDisplayStats }) {
  const { theme } = useTheme();
  const isDark = theme.bg === "#0C0C0C";
  const statBg = isDark ? "#1C1C1C" : "#F5F5F4";

  return (
    <View style={styles.statsRow}>
      <View style={[styles.statBox, { backgroundColor: statBg }]}>
        <MaterialCommunityIcons
          name="map-marker-distance"
          size={16}
          color={theme.textTertiary}
        />
        <Text style={[styles.statValue, { color: theme.text }]}>
          {data.distanceKm} km
        </Text>
        <Text style={[styles.statLabel, { color: theme.textTertiary }]}>
          remaining
        </Text>
      </View>

      <View style={[styles.statBox, { backgroundColor: statBg }]}>
        <MaterialCommunityIcons
          name="flag-checkered"
          size={16}
          color={theme.textTertiary}
        />
        <Text style={[styles.statValue, { color: theme.text }]}>
          {data.remainingStops}
        </Text>
        <Text style={[styles.statLabel, { color: theme.textTertiary }]}>
          stops left
        </Text>
      </View>

      <View style={[styles.statBox, { backgroundColor: statBg }]}>
        <MaterialCommunityIcons
          name="clock-outline"
          size={16}
          color={theme.textTertiary}
        />
        <Text style={[styles.statValue, { color: theme.text }]}>
          {formatEta(data.etaMinutes)}
        </Text>
        <Text style={[styles.statLabel, { color: theme.textTertiary }]}>
          ETA
        </Text>
      </View>
    </View>
  );
}

function ProgressStrip({ data }: { data: RouteDisplayStats }) {
  const { theme } = useTheme();
  return (
    <View style={styles.progressContainer}>
      <View
        style={[styles.progressTrack, { backgroundColor: theme.surfaceAlt }]}
      >
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: theme.success,
              width: `${data.completionPct}%`,
            },
          ]}
        />
      </View>
      <Text style={[styles.progressText, { color: theme.textSecondary }]}>
        {data.completedStops}/{data.totalStops} completed ({data.completionPct}
        %)
      </Text>
    </View>
  );
}

export function MinimalRouteView() {
  const { theme } = useTheme();
  const router = useRouter();
  const data = useRouteDisplayData();
  const actions = useMapActions();
  const [refreshing, setRefreshing] = React.useState(false);

  useEffect(() => {
    const { loadRoute, loadImportedPoints } = useMapStateStore.getState();
    loadRoute();
    loadImportedPoints();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await actions.loadRoute();
    setRefreshing(false);
  }, [actions]);

  const handleMarkComplete = useCallback(
    async (point: CollectionPoint) => {
      hapticImpact();
      const route = await storage.loadRoute();
      if (route) {
        await storage.updateCollectionPoint(route.id, point.id, {
          status: "completed",
          lastCollectionDate: new Date().toISOString(),
        });
        await actions.loadRoute();
      }
    },
    [actions],
  );

  const handlePointPress = useCallback(
    (point: CollectionPoint) => {
      hapticImpact();
      router.push({ pathname: "/point-detail", params: { pointId: point.id } });
    },
    [router],
  );

  const renderStop = useCallback(
    ({ item, index }: { item: CollectionPoint; index: number }) => {
      const isNext = data.nextStopIndex === index;
      const isCompleted = item.status === "completed";
      const statusColor = isCompleted
        ? theme.success
        : isNext
          ? "#F97316"
          : theme.textTertiary;

      return (
        <TouchableOpacity
          onPress={() => handlePointPress(item)}
          activeOpacity={0.85}
          style={styles.stopWrap}
        >
          <MinimalCard
            style={[
              styles.stopCard,
              isNext && {
                borderColor: "#F97316",
                borderWidth: 1.5,
              },
            ]}
          >
            <View style={styles.stopRow}>
              <View
                style={[styles.indexBadge, { backgroundColor: statusColor }]}
              >
                {isCompleted ? (
                  <MaterialCommunityIcons name="check" size={14} color="#fff" />
                ) : (
                  <Text style={styles.indexText}>{index + 1}</Text>
                )}
              </View>

              <View style={styles.stopInfo}>
                <Text
                  style={[
                    styles.stopAddress,
                    { color: theme.text },
                    isCompleted && {
                      textDecorationLine: "line-through",
                      opacity: 0.5,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {item.address}
                </Text>
                {item.locationName ? (
                  <Text
                    style={[
                      styles.stopLocation,
                      { color: theme.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {item.locationName}
                  </Text>
                ) : null}
                {isNext && (
                  <Text style={[styles.nextLabel, { color: "#F97316" }]}>
                    NEXT STOP
                  </Text>
                )}
              </View>

              {!isCompleted && (
                <TouchableOpacity
                  onPress={() => handleMarkComplete(item)}
                  style={[styles.doneBtn, { backgroundColor: theme.success }]}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <MaterialCommunityIcons name="check" size={18} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          </MinimalCard>
        </TouchableOpacity>
      );
    },
    [data.nextStopIndex, theme, handlePointPress, handleMarkComplete],
  );

  if (!data.hasRoute) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.bg }]}>
        <MaterialCommunityIcons
          name="truck-outline"
          size={48}
          color={theme.textTertiary}
        />
        <Text style={[styles.emptyTitle, { color: theme.text }]}>
          No active route
        </Text>
        <Text style={[styles.emptySubtitle, { color: theme.textTertiary }]}>
          Import data in Planner to generate a route
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={data.stops}
      renderItem={renderStop}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View style={styles.listHeader}>
          <StatsBar data={data} />
          <ProgressStrip data={data} />
        </View>
      }
      contentContainerStyle={[
        styles.listContent,
        { backgroundColor: theme.bg },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  listHeader: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  progressContainer: {
    marginBottom: 8,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 6,
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: "500",
  },
  stopWrap: {
    marginBottom: 8,
  },
  stopCard: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  indexBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  indexText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  stopInfo: {
    flex: 1,
  },
  stopAddress: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  stopLocation: {
    fontSize: 13,
    marginTop: 2,
  },
  nextLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  doneBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
