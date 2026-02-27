import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, FlatList } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import { generateRouteId } from "@/lib/utils";
import { RouteStatistics, TurnPenalties } from "@/types/routing";

interface SavedRoute {
  id: string;
  name: string;
  timestamp: Date;
  penalties: TurnPenalties;
  statistics: RouteStatistics;
}

interface RouteComparisonProps {
  onSelectRoute?: (route: SavedRoute) => void;
}

export function RouteComparison({ onSelectRoute }: RouteComparisonProps) {
  const colors = useColors();
  const { state } = useRouting();
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);

  const handleSaveCurrentRoute = () => {
    if (!state.statistics) return;

    hapticImpact();

    const newRoute: SavedRoute = {
      id: generateRouteId(),
      name: `Route ${savedRoutes.length + 1}`,
      timestamp: new Date(),
      penalties: JSON.parse(JSON.stringify(state.configuration.turnPenalties)),
      statistics: JSON.parse(JSON.stringify(state.statistics)),
    };

    setSavedRoutes((prev) => [...prev, newRoute]);
  };

  const toggleRouteSelection = (routeId: string) => {
    hapticImpact();
    setSelectedRoutes((prev) => {
      if (prev.includes(routeId)) {
        return prev.filter((id) => id !== routeId);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), routeId];
      }
      return [...prev, routeId];
    });
  };

  const clearSelection = () => {
    hapticImpact();
    setSelectedRoutes([]);
  };

  const getComparisonRoutes = () => {
    return savedRoutes.filter((r) => selectedRoutes.includes(r.id));
  };

  const formatDuration = (minutes: number) => {
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  const formatDistance = (km: number) => {
    return `${km.toFixed(2)} km`;
  };

  const getBestValue = (
    routes: SavedRoute[],
    getValue: (r: SavedRoute) => number,
    lowerIsBetter = true
  ) => {
    if (routes.length === 0) return null;
    const values = routes.map(getValue);
    return lowerIsBetter ? Math.min(...values) : Math.max(...values);
  };

  const comparisonRoutes = getComparisonRoutes();

  return (
    <View
      className="bg-surface rounded-2xl p-4 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-2">
        Route Comparison
      </Text>
      <Text className="text-sm text-muted mb-4">
        Save and compare routes with different optimization settings
      </Text>

      {/* Save Current Route */}
      <TouchableOpacity
        onPress={handleSaveCurrentRoute}
        disabled={!state.statistics}
        className="py-3 px-4 rounded-xl items-center mb-4"
        style={{
          backgroundColor: state.statistics ? colors.primary : colors.muted + "40",
          opacity: state.statistics ? 1 : 0.5,
        }}
      >
        <Text className="font-semibold" style={{ color: "#fff" }}>
          Save Current Route for Comparison
        </Text>
      </TouchableOpacity>

      {/* Saved Routes List */}
      {savedRoutes.length > 0 && (
        <View className="mb-4">
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-sm font-medium text-foreground">
              Saved Routes ({savedRoutes.length})
            </Text>
            {selectedRoutes.length > 0 && (
              <TouchableOpacity onPress={clearSelection}>
                <Text className="text-sm" style={{ color: colors.primary }}>
                  Clear Selection
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={savedRoutes}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const isSelected = selectedRoutes.includes(item.id);
              return (
                <TouchableOpacity
                  onPress={() => toggleRouteSelection(item.id)}
                  className="mr-3 p-3 rounded-xl"
                  style={{
                    backgroundColor: isSelected
                      ? colors.primary + "20"
                      : colors.background,
                    borderWidth: 2,
                    borderColor: isSelected ? colors.primary : colors.border,
                    minWidth: 140,
                  }}
                >
                  <Text
                    className="text-sm font-semibold mb-1"
                    style={{ color: isSelected ? colors.primary : colors.foreground }}
                  >
                    {item.name}
                  </Text>
                  <Text className="text-xs text-muted">
                    {formatDistance(item.statistics.totalDistance)}
                  </Text>
                  <Text className="text-xs text-muted">
                    L:{item.penalties.leftTurn} U:{item.penalties.uTurn}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* Comparison Table */}
      {comparisonRoutes.length >= 2 && (
        <View>
          <Text className="text-sm font-medium text-foreground mb-3">
            Comparison ({comparisonRoutes.length} routes)
          </Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {/* Header Row */}
              <View className="flex-row border-b border-border pb-2 mb-2">
                <View style={{ width: 100 }}>
                  <Text className="text-xs font-semibold text-muted">Metric</Text>
                </View>
                {comparisonRoutes.map((route) => (
                  <View key={route.id} style={{ width: 100 }}>
                    <Text
                      className="text-xs font-semibold"
                      style={{ color: colors.primary }}
                    >
                      {route.name}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Distance Row */}
              <ComparisonRow
                label="Distance"
                routes={comparisonRoutes}
                getValue={(r) => r.statistics.totalDistance}
                formatValue={formatDistance}
                bestValue={getBestValue(comparisonRoutes, (r) => r.statistics.totalDistance)}
                colors={colors}
              />

              {/* Time Row */}
              <ComparisonRow
                label="Est. Time"
                routes={comparisonRoutes}
                getValue={(r) => r.statistics.estimatedTime}
                formatValue={formatDuration}
                bestValue={getBestValue(comparisonRoutes, (r) => r.statistics.estimatedTime)}
                colors={colors}
              />

              {/* Left Turns Row */}
              <ComparisonRow
                label="Left Turns"
                routes={comparisonRoutes}
                getValue={(r) => r.statistics.turns.leftTurns}
                formatValue={(v) => v.toString()}
                bestValue={getBestValue(comparisonRoutes, (r) => r.statistics.turns.leftTurns)}
                colors={colors}
              />

              {/* U-Turns Row */}
              <ComparisonRow
                label="U-Turns"
                routes={comparisonRoutes}
                getValue={(r) => r.statistics.turns.uTurns}
                formatValue={(v) => v.toString()}
                bestValue={getBestValue(comparisonRoutes, (r) => r.statistics.turns.uTurns)}
                colors={colors}
              />

              {/* Right Turns Row */}
              <ComparisonRow
                label="Right Turns"
                routes={comparisonRoutes}
                getValue={(r) => r.statistics.turns.rightTurns}
                formatValue={(v) => v.toString()}
                bestValue={getBestValue(
                  comparisonRoutes,
                  (r) => r.statistics.turns.rightTurns,
                  false
                )}
                colors={colors}
                higherIsBetter
              />

              {/* Penalty Settings Row */}
              <View className="flex-row py-2 border-t border-border mt-2">
                <View style={{ width: 100 }}>
                  <Text className="text-xs text-muted">Left Penalty</Text>
                </View>
                {comparisonRoutes.map((route) => (
                  <View key={route.id} style={{ width: 100 }}>
                    <Text className="text-xs text-foreground">
                      {route.penalties.leftTurn}
                    </Text>
                  </View>
                ))}
              </View>

              <View className="flex-row py-2">
                <View style={{ width: 100 }}>
                  <Text className="text-xs text-muted">U-Turn Penalty</Text>
                </View>
                {comparisonRoutes.map((route) => (
                  <View key={route.id} style={{ width: 100 }}>
                    <Text className="text-xs text-foreground">
                      {route.penalties.uTurn}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      )}

      {/* Empty State */}
      {savedRoutes.length === 0 && (
        <View
          className="p-4 rounded-xl items-center"
          style={{ backgroundColor: colors.background }}
        >
          <Text className="text-sm text-muted text-center">
            Generate routes with different settings and save them to compare
          </Text>
        </View>
      )}

      {savedRoutes.length > 0 && selectedRoutes.length < 2 && (
        <View
          className="p-3 rounded-xl"
          style={{ backgroundColor: colors.warning + "15" }}
        >
          <Text className="text-xs text-center" style={{ color: colors.warning }}>
            Select at least 2 routes to compare (max 3)
          </Text>
        </View>
      )}
    </View>
  );
}

interface ComparisonRowProps {
  label: string;
  routes: SavedRoute[];
  getValue: (route: SavedRoute) => number;
  formatValue: (value: number) => string;
  bestValue: number | null;
  colors: ReturnType<typeof useColors>;
  higherIsBetter?: boolean;
}

function ComparisonRow({
  label,
  routes,
  getValue,
  formatValue,
  bestValue,
  colors,
  higherIsBetter = false,
}: ComparisonRowProps) {
  return (
    <View className="flex-row py-2">
      <View style={{ width: 100 }}>
        <Text className="text-xs text-muted">{label}</Text>
      </View>
      {routes.map((route) => {
        const value = getValue(route);
        const isBest = bestValue !== null && value === bestValue;
        return (
          <View key={route.id} style={{ width: 100 }}>
            <Text
              className="text-xs font-medium"
              style={{
                color: isBest ? colors.success : colors.foreground,
              }}
            >
              {formatValue(value)}
              {isBest && " ✓"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
