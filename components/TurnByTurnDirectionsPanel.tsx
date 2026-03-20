/**
 * Turn-by-turn directions panel — pre-navigation route overview.
 * Shows the full list of route steps (maneuver icon, distance, street name,
 * cumulative distance/time) before navigation starts, similar to OsmAnd/organic maps.
 */

import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import type { MatchedRoute, MatchedStep } from "@/lib/mapMatching";

let MaterialCommunityIcons: React.ComponentType<{
  name: string;
  size: number;
  color: string;
}> | null = null;
try {
  MaterialCommunityIcons =
    require("@expo/vector-icons/MaterialCommunityIcons").default;
} catch {
  // optional
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function formatMetric(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatCumTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTotalDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${m} m`;
  return `${m} min`;
}

function getEtaString(durationSeconds: number): string {
  const now = new Date();
  const eta = new Date(now.getTime() + durationSeconds * 1000);
  const hh = String(eta.getHours()).padStart(2, "0");
  const mm = String(eta.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ─── Maneuver helpers ──────────────────────────────────────────────────────────

function getManeuverIcon(type?: string, modifier?: string): string {
  if (type === "arrive") return "flag-checkered";
  if (type === "depart") return "navigation";
  if (type === "roundabout" || type === "rotary") return "rotate-right";
  const m = (modifier ?? "").toLowerCase();
  if (m.includes("left")) {
    if (m.includes("sharp")) return "arrow-bottom-left";
    if (m.includes("slight")) return "arrow-top-left";
    return "arrow-left";
  }
  if (m.includes("right")) {
    if (m.includes("sharp")) return "arrow-bottom-right";
    if (m.includes("slight")) return "arrow-top-right";
    return "arrow-right";
  }
  return "arrow-up";
}

function getStepVerb(type?: string, modifier?: string): string {
  if (type === "arrive") return "Arrive";
  if (type === "depart") return "Depart";
  if (type === "roundabout" || type === "rotary") return "Enter roundabout";
  if (type === "merge") return "Merge";
  if (type === "fork") return "Keep";
  const m = (modifier ?? "").toLowerCase();
  if (m.includes("uturn")) return "U-turn";
  if (m.includes("sharp left")) return "Sharp left";
  if (m.includes("slight left")) return "Bear left";
  if (m.includes("left")) return "Turn left";
  if (m.includes("sharp right")) return "Sharp right";
  if (m.includes("slight right")) return "Bear right";
  if (m.includes("right")) return "Turn right";
  return "Head";
}

// ─── Step row ─────────────────────────────────────────────────────────────────

interface StepRowProps {
  step: MatchedStep;
  cumDistance: number;
  cumDuration: number;
}

function StepRow({ step, cumDistance, cumDuration }: StepRowProps) {
  const colors = useColors();
  const iconName = getManeuverIcon(step.maneuver.type, step.maneuver.modifier);
  const verb = getStepVerb(step.maneuver.type, step.maneuver.modifier);
  const label = step.name ? `${verb} ${step.name}` : verb;

  return (
    <View style={[styles.stepRow, { borderBottomColor: colors.border }]}>
      {/* Maneuver icon */}
      <View style={styles.stepIconWrap}>
        {MaterialCommunityIcons ? (
          <MaterialCommunityIcons
            name={iconName}
            size={30}
            color={colors.text}
          />
        ) : (
          <Text style={[styles.stepIconFallback, { color: colors.text }]}>
            ↑
          </Text>
        )}
      </View>

      {/* Distance + street */}
      <View style={styles.stepMain}>
        <Text style={[styles.stepDistance, { color: colors.text }]}>
          {formatMetric(step.distance)}
        </Text>
        <Text
          style={[styles.stepStreet, { color: colors.muted ?? "#6B7280" }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>

      {/* Cumulative stats */}
      <Text style={[styles.stepCumulative, { color: colors.muted ?? "#9CA3AF" }]}>
        {formatMetric(cumDistance)} • {formatCumTime(cumDuration)}
      </Text>
    </View>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export interface TurnByTurnDirectionsPanelProps {
  matchedRoute: MatchedRoute;
  simulationMode: boolean;
  onSimulationModeChange: (value: boolean) => void;
  simSpeed: number;
  onSimSpeedChange: (speed: number) => void;
  onCancel: () => void;
  onStart: () => void;
  isStarting: boolean;
}

const SIM_SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;

export function TurnByTurnDirectionsPanel({
  matchedRoute,
  simulationMode,
  onSimulationModeChange,
  simSpeed,
  onSimSpeedChange,
  onCancel,
  onStart,
  isStarting,
}: TurnByTurnDirectionsPanelProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"instructions" | "analysis">(
    "instructions",
  );

  const primary = "#F97316";

  // Pre-compute cumulative distance/time per step
  const stepsWithCumulative = useMemo(() => {
    let cumDist = 0;
    let cumDur = 0;
    return matchedRoute.steps.map((step) => {
      cumDist += step.distance;
      cumDur += step.duration;
      return { step, cumDistance: cumDist, cumDuration: cumDur };
    });
  }, [matchedRoute.steps]);

  const totalDist = matchedRoute.totalDistance;
  const totalDur = matchedRoute.totalDuration;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.headerBack} onPress={onCancel}>
          <Text style={[styles.headerBackText, { color: primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Route</Text>
        <View style={styles.headerRight} />
      </View>

      {/* ── Route summary ── */}
      <View style={[styles.summary, { borderBottomColor: colors.border }]}>
        <Text style={[styles.summaryMain, { color: colors.text }]}>
          <Text style={styles.summaryBold}>
            {formatMetric(totalDist)}
          </Text>
          {"  ·  "}
          <Text style={styles.summaryBold}>
            {formatTotalDuration(totalDur)}
          </Text>
          {"  "}
          <Text style={[styles.summaryEta, { color: primary }]}>
            ({getEtaString(totalDur)})
          </Text>
        </Text>
      </View>

      {/* ── Instructions / Analysis tabs ── */}
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === "instructions" && {
              borderBottomColor: colors.text,
              borderBottomWidth: 2,
            },
          ]}
          onPress={() => setActiveTab("instructions")}
        >
          <Text
            style={[
              styles.tabText,
              {
                color:
                  activeTab === "instructions"
                    ? colors.text
                    : (colors.muted ?? "#6B7280"),
                fontWeight: activeTab === "instructions" ? "600" : "400",
              },
            ]}
          >
            Instructions
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === "analysis" && {
              borderBottomColor: colors.text,
              borderBottomWidth: 2,
            },
          ]}
          onPress={() => setActiveTab("analysis")}
        >
          <Text
            style={[
              styles.tabText,
              {
                color:
                  activeTab === "analysis"
                    ? colors.text
                    : (colors.muted ?? "#6B7280"),
                fontWeight: activeTab === "analysis" ? "600" : "400",
              },
            ]}
          >
            Analysis
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "instructions" ? (
        <>
          {/* ── Section label ── */}
          <View
            style={[
              styles.sectionLabel,
              { backgroundColor: colors.surface ?? colors.background },
            ]}
          >
            <Text
              style={[
                styles.sectionLabelText,
                { color: colors.muted ?? "#9CA3AF" },
              ]}
            >
              TURN-BY-TURN
            </Text>
          </View>

          {/* ── Steps list ── */}
          <FlatList
            data={stepsWithCumulative}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <StepRow
                step={item.step}
                cumDistance={item.cumDistance}
                cumDuration={item.cumDuration}
              />
            )}
            style={styles.list}
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        <View style={styles.analysisPlaceholder}>
          <Text style={[styles.analysisText, { color: colors.muted ?? "#9CA3AF" }]}>
            Route analysis coming soon.
          </Text>
        </View>
      )}

      {/* ── Bottom controls ── */}
      <View
        style={[
          styles.bottom,
          {
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: colors.background,
          },
        ]}
      >
        {/* Simulation toggle */}
        <View style={styles.simRow}>
          <Text style={[styles.simLabel, { color: colors.text }]}>
            Simulation Mode
          </Text>
          <Switch
            value={simulationMode}
            onValueChange={onSimulationModeChange}
            trackColor={{ false: "#767577", true: primary }}
            thumbColor={
              Platform.OS === "ios" ? "#fff" : simulationMode ? primary : "#f4f3f4"
            }
          />
        </View>

        {simulationMode && (
          <View style={styles.speedRow}>
            <Text style={[styles.speedLabel, { color: colors.text }]}>
              Speed
            </Text>
            <View style={styles.speedChips}>
              {SIM_SPEED_OPTIONS.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.speedChip,
                    {
                      borderColor:
                        simSpeed === s ? primary : (colors.muted ?? "#71717a"),
                    },
                    simSpeed === s && { backgroundColor: primary },
                  ]}
                  onPress={() => onSimSpeedChange(s)}
                >
                  <Text
                    style={[
                      styles.speedChipText,
                      { color: simSpeed === s ? "#fff" : colors.text },
                    ]}
                  >
                    {s}x
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Cancel / Start buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[
              styles.cancelButton,
              { backgroundColor: colors.surface ?? "#F3F4F6" },
            ]}
            onPress={onCancel}
          >
            <Text style={[styles.cancelText, { color: colors.text }]}>
              Cancel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.startButton,
              { backgroundColor: primary },
              isStarting && { opacity: 0.7 },
            ]}
            onPress={onStart}
            disabled={isStarting}
          >
            {MaterialCommunityIcons && (
              <MaterialCommunityIcons
                name="navigation"
                size={20}
                color="#fff"
              />
            )}
            <Text style={styles.startText}>
              {isStarting ? "Starting…" : "Start"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: {
    width: 40,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerBackText: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: "300",
    marginTop: -2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  headerRight: {
    width: 40,
  },
  summary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryMain: {
    fontSize: 16,
  },
  summaryBold: {
    fontWeight: "700",
    fontSize: 18,
  },
  summaryEta: {
    fontWeight: "600",
    fontSize: 16,
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
  },
  tabText: {
    fontSize: 15,
  },
  sectionLabel: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionLabelText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.8,
  },
  list: {
    flex: 1,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepIconWrap: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  stepIconFallback: {
    fontSize: 24,
  },
  stepMain: {
    flex: 1,
    justifyContent: "center",
  },
  stepDistance: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 2,
  },
  stepStreet: {
    fontSize: 13,
    fontWeight: "400",
  },
  stepCumulative: {
    fontSize: 12,
    textAlign: "right",
    marginLeft: 8,
    minWidth: 80,
  },
  analysisPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  analysisText: {
    fontSize: 15,
  },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  simRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  simLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
  speedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  speedLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  speedChips: {
    flexDirection: "row",
    gap: 6,
  },
  speedChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  speedChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 28,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
  },
  startButton: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 28,
  },
  startText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
});
