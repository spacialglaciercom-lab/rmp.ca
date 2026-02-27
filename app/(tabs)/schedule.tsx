import { useState, useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import type { Route } from "@/types";
import { storage } from "@/lib/storage";

export default function ScheduleScreen() {
  const colors = useColors();
  const [history, setHistory] = useState<Route[]>([]);
  const [currentRoute, setCurrentRoute] = useState<Route | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const route = await storage.loadRoute();
    const routeHistory = await storage.loadHistory();
    setCurrentRoute(route);
    setHistory(routeHistory);
  };

  const getDayOfWeek = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { weekday: "short" });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getRouteStatusColor = (status: Route["status"]) => {
    switch (status) {
      case "completed":
        return colors.success;
      case "in_progress":
        return colors.warning;
      case "not_started":
        return colors.muted;
      default:
        return colors.muted;
    }
  };

  const getRouteStatusLabel = (status: Route["status"]) => {
    switch (status) {
      case "completed":
        return "Completed";
      case "in_progress":
        return "In Progress";
      case "not_started":
        return "Not Started";
      default:
        return "Unknown";
    }
  };

  const handleRoutePress = (route: Route) => {
    hapticImpact();
    // In a real app, this would navigate to route details
  };

  const totalCollections = history.reduce(
    (sum, route) => sum + route.totalPoints,
    0
  );
  const totalCompleted = history.reduce(
    (sum, route) => sum + route.completedPoints,
    0
  );

  return (
    <ScreenContainer>
      <ScrollView className="flex-1 p-4">
        <Text className="text-3xl font-bold text-foreground mb-4">
          Schedule
        </Text>

        {/* Statistics Card */}
        <View
          className="bg-primary rounded-2xl p-5 mb-6"
          style={{ backgroundColor: colors.primary }}
        >
          <Text className="text-white text-lg font-semibold mb-4">
            Collection Statistics
          </Text>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-white text-sm opacity-90">
                Total Routes
              </Text>
              <Text className="text-white text-2xl font-bold">
                {history.length + (currentRoute ? 1 : 0)}
              </Text>
            </View>
            <View>
              <Text className="text-white text-sm opacity-90">
                Total Points
              </Text>
              <Text className="text-white text-2xl font-bold">
                {totalCollections + (currentRoute?.totalPoints || 0)}
              </Text>
            </View>
            <View>
              <Text className="text-white text-sm opacity-90">Completed</Text>
              <Text className="text-white text-2xl font-bold">
                {totalCompleted + (currentRoute?.completedPoints || 0)}
              </Text>
            </View>
          </View>
        </View>

        {/* Current Route */}
        {currentRoute && (
          <>
            <Text className="text-lg font-semibold text-foreground mb-3">
              Current Route
            </Text>
            <TouchableOpacity
              onPress={() => handleRoutePress(currentRoute)}
              className="mb-6 active:opacity-70"
            >
              <View
                className="bg-surface rounded-2xl p-5 border-2"
                style={{
                  backgroundColor: colors.surface,
                  borderColor: colors.primary,
                }}
              >
                <View className="flex-row items-center justify-between mb-3">
                  <View>
                    <Text className="text-sm text-muted mb-1">
                      {getDayOfWeek(currentRoute.date)}
                    </Text>
                    <Text className="text-xl font-bold text-foreground">
                      {formatDate(currentRoute.date)}
                    </Text>
                  </View>
                  <View
                    className="px-3 py-1 rounded-full"
                    style={{
                      backgroundColor:
                        getRouteStatusColor(currentRoute.status) + "20",
                    }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{
                        color: getRouteStatusColor(currentRoute.status),
                      }}
                    >
                      {getRouteStatusLabel(currentRoute.status)}
                    </Text>
                  </View>
                </View>

                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-sm text-muted">Collection Points</Text>
                    <Text className="text-lg font-semibold text-foreground">
                      {currentRoute.completedPoints} / {currentRoute.totalPoints}
                    </Text>
                  </View>
                  <View>
                    <Text className="text-sm text-muted">Progress</Text>
                    <Text className="text-lg font-semibold text-foreground">
                      {currentRoute.totalPoints > 0
                        ? Math.round(
                            (currentRoute.completedPoints /
                              currentRoute.totalPoints) *
                              100
                          )
                        : 0}
                      %
                    </Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* Route History */}
        {history.length > 0 && (
          <>
            <Text className="text-lg font-semibold text-foreground mb-3">
              Route History
            </Text>
            {history.map((route) => (
              <TouchableOpacity
                key={route.id}
                onPress={() => handleRoutePress(route)}
                className="mb-3 active:opacity-70"
              >
                <View
                  className="bg-surface rounded-xl p-4 border border-border"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  }}
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <View>
                      <Text className="text-xs text-muted mb-1">
                        {getDayOfWeek(route.date)}
                      </Text>
                      <Text className="text-base font-semibold text-foreground">
                        {formatDate(route.date)}
                      </Text>
                    </View>
                    <View
                      className="px-3 py-1 rounded-full"
                      style={{
                        backgroundColor:
                          getRouteStatusColor(route.status) + "20",
                      }}
                    >
                      <Text
                        className="text-xs font-medium"
                        style={{ color: getRouteStatusColor(route.status) }}
                      >
                        {getRouteStatusLabel(route.status)}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-4">
                    <Text className="text-sm text-muted">
                      {route.completedPoints} / {route.totalPoints} points
                    </Text>
                    <Text className="text-sm text-muted">
                      {route.totalPoints > 0
                        ? Math.round(
                            (route.completedPoints / route.totalPoints) * 100
                          )
                        : 0}
                      % complete
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {history.length === 0 && !currentRoute && (
          <View className="items-center justify-center py-12">
            <Text className="text-muted text-center">
              No route history available yet
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
