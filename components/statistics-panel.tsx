import { View, Text } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";

export function StatisticsPanel() {
  const colors = useColors();
  const { state } = useRouting();
  const stats = state.statistics;

  if (!stats) {
    return (
      <View
        className="bg-surface rounded-2xl p-5 mb-4"
        style={{ backgroundColor: colors.surface }}
      >
        <Text className="text-lg font-semibold text-foreground mb-2">
          Route Statistics
        </Text>
        <Text className="text-muted text-sm">
          Statistics will appear here after route generation
        </Text>
      </View>
    );
  }

  const formatTime = (minutes: number) => {
    const capped = Math.min(minutes, 24 * 60); // never show > 24h (fixes stale 100+ hour values)
    const hours = Math.floor(capped / 60);
    const mins = capped % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  return (
    <View
      className="bg-surface rounded-2xl p-5 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-4">
        Route Statistics
      </Text>

      {/* Main Stats */}
      <View className="flex-row justify-between mb-4">
        <View className="items-center flex-1">
          <Text className="text-2xl font-bold text-primary">
            {stats.totalDistance.toFixed(1)}
          </Text>
          <Text className="text-xs text-muted">km Distance</Text>
        </View>
        <View className="items-center flex-1">
          <Text className="text-2xl font-bold text-primary">
            {formatTime(Math.min(stats.estimatedTime, 24 * 60))}
          </Text>
          <Text className="text-xs text-muted">Est. Time</Text>
        </View>
        <View className="items-center flex-1">
          <Text className="text-2xl font-bold text-primary">
            {stats.totalTraversals}
          </Text>
          <Text className="text-xs text-muted">Traversals</Text>
        </View>
      </View>

      {/* Turn Statistics */}
      <View
        className="p-4 rounded-xl mb-4"
        style={{ backgroundColor: colors.background }}
      >
        <Text className="text-sm font-semibold text-foreground mb-3">
          Turn Statistics
        </Text>

        <View className="gap-2">
          {/* Right Turns */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: colors.success }}
              />
              <Text className="text-sm text-foreground">Right Turns</Text>
            </View>
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.success }}
            >
              {stats.turns.rightTurns}
            </Text>
          </View>

          {/* Left Turns */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: colors.warning }}
              />
              <Text className="text-sm text-foreground">Left Turns</Text>
            </View>
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.warning }}
            >
              {stats.turns.leftTurns}
            </Text>
          </View>

          {/* U-Turns */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{
                  backgroundColor:
                    stats.turns.uTurns === 0 ? colors.success : colors.error,
                }}
              />
              <Text className="text-sm text-foreground">U-Turns</Text>
            </View>
            <Text
              className="text-sm font-semibold"
              style={{
                color: stats.turns.uTurns === 0 ? colors.success : colors.error,
              }}
            >
              {stats.turns.uTurns}
            </Text>
          </View>

          {/* Straight Ahead */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: colors.primary }}
              />
              <Text className="text-sm text-foreground">Straight</Text>
            </View>
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.primary }}
            >
              {stats.turns.straightAhead}
            </Text>
          </View>
        </View>
      </View>

      {/* Segment Stats */}
      <View className="flex-row justify-between">
        <View className="flex-1 items-center">
          <Text className="text-lg font-bold" style={{ color: colors.success }}>
            {stats.segmentsRouted}
          </Text>
          <Text className="text-xs text-muted">Segments Routed</Text>
        </View>
        <View className="flex-1 items-center">
          <Text className="text-lg font-bold" style={{ color: colors.muted }}>
            {stats.segmentsExcluded}
          </Text>
          <Text className="text-xs text-muted">Segments Excluded</Text>
        </View>
      </View>

      {/* Backend Optimizer Stats */}
      {(stats.efficiency !== undefined ||
        stats.deadEndsIdentified !== undefined ||
        stats.onewayViolations !== undefined ||
        stats.uTurnsAvoided !== undefined) && (
        <View
          className="p-4 rounded-xl mt-4"
          style={{ backgroundColor: colors.background }}
        >
          <Text className="text-sm font-semibold text-foreground mb-3">
            Optimizer Details
          </Text>

          <View className="gap-2">
            {stats.efficiency !== undefined && (
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-foreground">Efficiency</Text>
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.primary }}
                >
                  {stats.efficiency.toFixed(1)}%
                </Text>
              </View>
            )}

            {stats.deadEndsIdentified !== undefined && (
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-foreground">Dead Ends</Text>
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.warning }}
                >
                  {stats.deadEndsIdentified}
                </Text>
              </View>
            )}

            {stats.onewayViolations !== undefined && (
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-foreground">Oneway Violations</Text>
                <Text
                  className="text-sm font-semibold"
                  style={{
                    color: stats.onewayViolations === 0 ? colors.success : colors.error,
                  }}
                >
                  {stats.onewayViolations}
                </Text>
              </View>
            )}

            {stats.uTurnsAvoided !== undefined && (
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-foreground">U-Turns Avoided</Text>
                <Text
                  className="text-sm font-semibold"
                  style={{ color: colors.success }}
                >
                  {stats.uTurnsAvoided}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
