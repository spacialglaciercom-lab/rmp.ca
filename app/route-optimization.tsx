import { useState, useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity, Switch } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  impactAsync as hapticImpact,
  notificationAsync as hapticNotification,
  NotificationFeedbackType,
} from "@/lib/safe-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

const ROAD_CLOSURE_HANDLING_KEY = "trashroute_road_closure_handling";

interface OptimizationSettings {
  capacityConstraints: boolean;
  serviceTimes: boolean;
  turnPenalties: boolean;

  // Temporal Settings
  timeWindows: boolean;
  stochasticTravelTimes: boolean;
  congestionSampling: boolean;
  robustOptimization: "mean" | "worst95" | "worst99";

  // Multi-objective
  multiObjective: boolean;
  objectives: {
    distance: boolean;
    leftTurns: boolean;
    uTurns: boolean;
    risk: boolean;
  };
  paretoEnabled: boolean;

  // Online Re-optimization
  warmStartEnabled: boolean;
  roadClosureHandling: boolean;
  eulerianBalancing: boolean;
  vehicleBreakdown: boolean;
  emergencyStopInsertion: boolean;
  realTimeTrafficFeed: boolean;

  // Fallbacks
  fallbackToLNS: boolean;
  rollingHorizon: boolean;
  subgraphSize: number;
}

const defaultSettings: OptimizationSettings = {
  capacityConstraints: true,
  serviceTimes: true,
  turnPenalties: true,
  timeWindows: false,
  stochasticTravelTimes: false,
  congestionSampling: false,
  robustOptimization: "mean",
  multiObjective: true,
  objectives: {
    distance: true,
    leftTurns: true,
    uTurns: true,
    risk: false,
  },
  paretoEnabled: true,
  warmStartEnabled: true,
  roadClosureHandling: true,
  eulerianBalancing: true,
  vehicleBreakdown: false,
  emergencyStopInsertion: false,
  realTimeTrafficFeed: false,
  fallbackToLNS: true,
  rollingHorizon: false,
  subgraphSize: 500,
};

export default function RouteOptimizationScreen() {
  const colors = useColors();
  const router = useRouter();
  const [settings, setSettings] =
    useState<OptimizationSettings>(defaultSettings);
  const [expandedSection, setExpandedSection] = useState<string | null>("core");

  useEffect(() => {
    AsyncStorage.getItem(ROAD_CLOSURE_HANDLING_KEY).then((stored) => {
      if (stored !== null) {
        const v = stored === "true";
        setSettings((prev) => ({ ...prev, roadClosureHandling: v }));
      }
    });
  }, []);

  const updateSetting = <K extends keyof OptimizationSettings>(
    key: K,
    value: OptimizationSettings[K],
  ) => {
    hapticImpact();
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (key === "roadClosureHandling") {
      AsyncStorage.setItem(ROAD_CLOSURE_HANDLING_KEY, String(value));
    }
  };

  const updateObjective = (
    key: keyof OptimizationSettings["objectives"],
    value: boolean,
  ) => {
    hapticImpact();
    setSettings((prev) => ({
      ...prev,
      objectives: { ...prev.objectives, [key]: value },
    }));
  };

  const toggleSection = (section: string) => {
    hapticImpact();
    setExpandedSection(expandedSection === section ? null : section);
  };

  const Section = ({
    id,
    title,
    subtitle,
    children,
  }: {
    id: string;
    title: string;
    subtitle: string;
    children: React.ReactNode;
  }) => (
    <View className="mb-4">
      <TouchableOpacity
        onPress={() => toggleSection(id)}
        style={{ backgroundColor: colors.surface }}
        className="p-4 rounded-t-xl active:opacity-80"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {title}
            </Text>
            <Text className="text-xs text-muted mt-1">{subtitle}</Text>
          </View>
          <Text className="text-muted text-lg">
            {expandedSection === id ? "▼" : "▶"}
          </Text>
        </View>
      </TouchableOpacity>
      {expandedSection === id && (
        <View
          style={{ backgroundColor: colors.surface }}
          className="p-4 rounded-b-xl border-t border-border"
        >
          {children}
        </View>
      )}
    </View>
  );

  const SettingRow = ({
    label,
    description,
    value,
    onToggle,
  }: {
    label: string;
    description?: string;
    value: boolean;
    onToggle: (value: boolean) => void;
  }) => (
    <View className="flex-row items-center justify-between py-3 border-b border-border">
      <View className="flex-1 mr-4">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        {description && (
          <Text className="text-xs text-muted mt-1">{description}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.muted + "40", true: colors.primary + "80" }}
        thumbColor={value ? colors.primary : colors.muted}
      />
    </View>
  );

  return (
    <ScreenContainer>
      <ScrollView className="flex-1 p-4">
        {/* Header */}
        <View className="flex-row items-center mb-6">
          <TouchableOpacity
            onPress={() => router.back()}
            className="mr-4 active:opacity-70"
          >
            <Text className="text-primary text-lg">← Back</Text>
          </TouchableOpacity>
          <View>
            <Text className="text-2xl font-bold text-foreground">
              Route Optimization
            </Text>
            <Text className="text-sm text-muted">
              Advanced algorithm configuration
            </Text>
          </View>
        </View>

        {/* Core Algorithm Section */}
        <Section
          id="core"
          title="Core Algorithm"
          subtitle="Constraints and options"
        >
          <View>
            <View
              className="mb-2 px-3 py-2 rounded-lg"
              style={{ backgroundColor: colors.background }}
            >
              <Text className="text-xs text-muted italic">
                Features to come
              </Text>
            </View>
            <SettingRow
              label="Capacity Constraints"
              description="Respect truck/crew capacity limits"
              value={settings.capacityConstraints}
              onToggle={(v) => updateSetting("capacityConstraints", v)}
            />
            <SettingRow
              label="Service Times"
              description="Include collection time at each stop"
              value={settings.serviceTimes}
              onToggle={(v) => updateSetting("serviceTimes", v)}
            />
            <SettingRow
              label="Turn Penalties"
              description="Penalize left turns and U-turns in optimization"
              value={settings.turnPenalties}
              onToggle={(v) => updateSetting("turnPenalties", v)}
            />
          </View>
        </Section>

        {/* Temporal Optimization Section */}
        <Section
          id="temporal"
          title="Temporal Optimization"
          subtitle="Time windows + stochastic travel times"
        >
          <View
            className="mb-2 px-3 py-2 rounded-lg"
            style={{ backgroundColor: colors.background }}
          >
            <Text className="text-xs text-muted italic">Features to come</Text>
          </View>
          <SettingRow
            label="Time Windows"
            description="Overlay collection time constraints"
            value={settings.timeWindows}
            onToggle={(v) => updateSetting("timeWindows", v)}
          />
          <SettingRow
            label="Stochastic Travel Times"
            description="Sample congestion patterns for realistic estimates"
            value={settings.stochasticTravelTimes}
            onToggle={(v) => updateSetting("stochasticTravelTimes", v)}
          />
          <SettingRow
            label="Congestion Sampling"
            description="Use historical traffic data"
            value={settings.congestionSampling}
            onToggle={(v) => updateSetting("congestionSampling", v)}
          />

          <View className="mt-4">
            <Text className="text-xs text-muted mb-2">
              Robust Optimization Target
            </Text>
            <View className="flex-row gap-2">
              {(["mean", "worst95", "worst99"] as const).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => updateSetting("robustOptimization", opt)}
                  style={{
                    backgroundColor:
                      settings.robustOptimization === opt
                        ? colors.primary
                        : colors.background,
                  }}
                  className="flex-1 py-2 rounded-lg items-center active:opacity-80"
                >
                  <Text
                    style={{
                      color:
                        settings.robustOptimization === opt
                          ? "#fff"
                          : colors.foreground,
                    }}
                    className="text-xs font-medium"
                  >
                    {opt === "mean"
                      ? "Mean"
                      : opt === "worst95"
                        ? "Worst 95%"
                        : "Worst 99%"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="text-xs text-muted mt-2">
              Scenario-robust CPP optimizes for selected percentile
            </Text>
          </View>
        </Section>

        {/* Multi-objective Section */}
        <Section
          id="multiobjective"
          title="Multi-objective Layer"
          subtitle="Lexicographic solve with Pareto pruning"
        >
          <View
            className="mb-2 px-3 py-2 rounded-lg"
            style={{ backgroundColor: colors.background }}
          >
            <Text className="text-xs text-muted italic">Features to come</Text>
          </View>
          <SettingRow
            label="Multi-objective Optimization"
            description="Optimize multiple objectives simultaneously"
            value={settings.multiObjective}
            onToggle={(v) => updateSetting("multiObjective", v)}
          />

          {settings.multiObjective && (
            <>
              <Text className="text-xs text-muted mt-4 mb-2">
                Objectives (in priority order)
              </Text>
              <SettingRow
                label="1. Distance"
                description="Minimize total route distance"
                value={settings.objectives.distance}
                onToggle={(v) => updateObjective("distance", v)}
              />
              <SettingRow
                label="2. Left Turns"
                description="Minimize left turn maneuvers"
                value={settings.objectives.leftTurns}
                onToggle={(v) => updateObjective("leftTurns", v)}
              />
              <SettingRow
                label="3. U-Turns"
                description="Minimize U-turn maneuvers"
                value={settings.objectives.uTurns}
                onToggle={(v) => updateObjective("uTurns", v)}
              />
              <SettingRow
                label="4. Risk"
                description="Minimize high-risk road segments"
                value={settings.objectives.risk}
                onToggle={(v) => updateObjective("risk", v)}
              />
              <SettingRow
                label="Pareto Pruning"
                description="Post-CPP local arc swaps for Pareto efficiency"
                value={settings.paretoEnabled}
                onToggle={(v) => updateSetting("paretoEnabled", v)}
              />
            </>
          )}
        </Section>

        {/* Online Re-optimization Section */}
        <Section
          id="online"
          title="Online Re-optimization"
          subtitle="Warm-start CPP with dynamic updates"
        >
          <SettingRow
            label="Warm-start CPP"
            description="Edge insertion/deletion for road closures"
            value={settings.warmStartEnabled}
            onToggle={(v) => updateSetting("warmStartEnabled", v)}
          />
          <SettingRow
            label="Road Closure Handling"
            description="Automatically re-route around closures"
            value={settings.roadClosureHandling}
            onToggle={(v) => updateSetting("roadClosureHandling", v)}
          />
          <SettingRow
            label="Eulerian Balancing"
            description="Maintain balance via minimal matching deltas"
            value={settings.eulerianBalancing}
            onToggle={(v) => updateSetting("eulerianBalancing", v)}
          />
          <SettingRow
            label="Vehicle Breakdown Rerouting"
            description="Re-solve remaining stops when a truck goes out of service"
            value={settings.vehicleBreakdown}
            onToggle={(v) => updateSetting("vehicleBreakdown", v)}
          />
          <SettingRow
            label="Emergency Stop Insertion"
            description="Insert unscheduled pickups at lowest-cost position in active circuit"
            value={settings.emergencyStopInsertion}
            onToggle={(v) => updateSetting("emergencyStopInsertion", v)}
          />
          <SettingRow
            label="Real-time Traffic Feed"
            description="Adjust edge weights from live traffic speeds before CPP solve"
            value={settings.realTimeTrafficFeed}
            onToggle={(v) => updateSetting("realTimeTrafficFeed", v)}
          />
        </Section>

        {/* Fallbacks Section */}
        <Section
          id="fallbacks"
          title="Fallbacks (Reversible)"
          subtitle="Graceful degradation strategies"
        >
          <View
            className="mb-2 px-3 py-2 rounded-lg"
            style={{ backgroundColor: colors.background }}
          >
            <Text className="text-xs text-muted italic">Features to come</Text>
          </View>
          <View
            className="p-3 rounded-lg mb-4"
            style={{ backgroundColor: colors.warning + "15" }}
          >
            <Text className="text-xs" style={{ color: colors.warning }}>
              These fallbacks activate automatically when constraints cause CPP
              to explode
            </Text>
          </View>

          <SettingRow
            label="Route Inspection + LNS"
            description="Relax to Large Neighborhood Search if CPP fails"
            value={settings.fallbackToLNS}
            onToggle={(v) => updateSetting("fallbackToLNS", v)}
          />
          <SettingRow
            label="Rolling-horizon CPP"
            description="Switch to subgraph optimization for real-time flags"
            value={settings.rollingHorizon}
            onToggle={(v) => updateSetting("rollingHorizon", v)}
          />

          {settings.rollingHorizon && (
            <View className="mt-3">
              <Text className="text-xs text-muted mb-2">
                Subgraph Size: {settings.subgraphSize} nodes
              </Text>
              <View className="flex-row gap-2">
                {[250, 500, 1000].map((size) => (
                  <TouchableOpacity
                    key={size}
                    onPress={() => updateSetting("subgraphSize", size)}
                    style={{
                      backgroundColor:
                        settings.subgraphSize === size
                          ? colors.primary
                          : colors.background,
                    }}
                    className="flex-1 py-2 rounded-lg items-center active:opacity-80"
                  >
                    <Text
                      style={{
                        color:
                          settings.subgraphSize === size
                            ? "#fff"
                            : colors.foreground,
                      }}
                      className="text-xs font-medium"
                    >
                      {size}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </Section>

        {/* Save Button */}
        <TouchableOpacity
          onPress={() => {
            hapticNotification(NotificationFeedbackType.Success);
            router.back();
          }}
          style={{ backgroundColor: colors.primary }}
          className="py-4 rounded-xl items-center mb-8 active:opacity-80"
        >
          <Text className="text-white text-lg font-semibold">
            Save Configuration
          </Text>
        </TouchableOpacity>

        <View className="h-8" />
      </ScrollView>
    </ScreenContainer>
  );
}
