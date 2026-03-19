/**
 * RouteMaster Constraint Parser — UI for dispatchers to type natural language
 * constraints and have Gemini parse them into structured optimization rules.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { parseConstraint } from "@/lib/firebase/ai";
import type {
  ParsedConstraint,
  ParsedConstraintResult,
  ConstraintType,
} from "@/types/routeMasterConstraint";

interface ConstraintParserProps {
  /** Called when user confirms a parsed constraint. */
  onConstraintConfirmed?: (constraint: ParsedConstraint) => void;
  /** Called to dismiss the parser. */
  onClose?: () => void;
}

const CONSTRAINT_TYPE_LABELS: Record<ConstraintType, string> = {
  skip: "Skip",
  avoid: "Avoid",
  time_window: "Time Window",
  direction: "Direction",
  priority: "Priority",
  delay: "Delay",
  frequency: "Frequency",
  vehicle: "Vehicle",
  crew: "Crew",
  seasonal: "Seasonal",
  temporary: "Temporary",
  permanent: "Permanent",
  capacity: "Capacity",
  special_instruction: "Special",
};

function ConstraintCard({
  constraint,
  colors,
  onConfirm,
}: {
  constraint: ParsedConstraint;
  colors: ReturnType<typeof useColors>;
  onConfirm?: (c: ParsedConstraint) => void;
}) {
  const needsReview = constraint.confidence < 0.7;
  const typeLabel = CONSTRAINT_TYPE_LABELS[constraint.type] ?? constraint.type;

  // Target description
  const target =
    constraint.target.street ??
    constraint.target.zone ??
    constraint.target.area ??
    "Unknown target";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {/* Header: type badge + target */}
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.typeBadge,
            {
              backgroundColor: "rgba(0, 217, 255, 0.15)",
              borderColor: "rgba(0, 217, 255, 0.3)",
            },
          ]}
        >
          <Text style={[styles.typeBadgeText, { color: "#00D9FF" }]}>
            {typeLabel}
          </Text>
        </View>
        {constraint.permanent && (
          <View
            style={[
              styles.typeBadge,
              {
                backgroundColor: "rgba(255, 107, 74, 0.15)",
                borderColor: "rgba(255, 107, 74, 0.3)",
              },
            ]}
          >
            <Text style={[styles.typeBadgeText, { color: "#ff6b4a" }]}>
              Permanent
            </Text>
          </View>
        )}
      </View>

      {/* Target */}
      <Text style={[styles.cardTarget, { color: colors.foreground }]}>
        {target}
      </Text>

      {/* Reason */}
      {constraint.reason && (
        <Text style={[styles.cardReason, { color: colors.muted }]}>
          {constraint.reason}
        </Text>
      )}

      {/* Schedule */}
      {(constraint.schedule.days || constraint.schedule.time_start) && (
        <View style={styles.scheduleRow}>
          {constraint.schedule.days && (
            <Text style={[styles.scheduleText, { color: colors.muted }]}>
              {constraint.schedule.days.join(", ")}
            </Text>
          )}
          {constraint.schedule.time_start && (
            <Text style={[styles.scheduleText, { color: colors.muted }]}>
              {constraint.schedule.time_start}
              {constraint.schedule.time_end
                ? ` - ${constraint.schedule.time_end}`
                : "+"}
            </Text>
          )}
        </View>
      )}

      {/* Confidence bar */}
      <View style={styles.confidenceRow}>
        <Text style={[styles.confidenceLabel, { color: colors.muted }]}>
          Confidence
        </Text>
        <Text
          style={[
            styles.confidenceValue,
            { color: needsReview ? "#ff6b4a" : "#00D9FF" },
          ]}
        >
          {(constraint.confidence * 100).toFixed(0)}%
        </Text>
      </View>
      <View
        style={[
          styles.confidenceBar,
          { backgroundColor: "rgba(255, 255, 255, 0.1)" },
        ]}
      >
        <View
          style={[
            styles.confidenceFill,
            {
              width: `${constraint.confidence * 100}%`,
              backgroundColor: needsReview ? "#ff6b4a" : "#00D9FF",
            },
          ]}
        />
      </View>

      {/* Review warning */}
      {needsReview && (
        <View
          style={[
            styles.warningBox,
            {
              backgroundColor: "rgba(255, 107, 74, 0.1)",
              borderColor: "rgba(255, 107, 74, 0.3)",
            },
          ]}
        >
          <Text style={[styles.warningText, { color: "#ff6b4a" }]}>
            Low confidence — please review before confirming
          </Text>
        </View>
      )}

      {/* Ambiguities */}
      {constraint.ambiguities.length > 0 && (
        <View style={styles.ambiguitySection}>
          <Text
            style={[
              styles.ambiguityTitle,
              { color: colors.warning ?? "#ff6b4a" },
            ]}
          >
            Ambiguities:
          </Text>
          {constraint.ambiguities.map((a, i) => (
            <Text
              key={i}
              style={[styles.ambiguityItem, { color: colors.muted }]}
            >
              {a}
            </Text>
          ))}
        </View>
      )}

      {/* Confirm button */}
      {onConfirm && (
        <Pressable
          style={[
            styles.confirmButton,
            {
              backgroundColor: "rgba(0, 217, 255, 0.15)",
              borderColor: "rgba(0, 217, 255, 0.3)",
            },
          ]}
          onPress={() => onConfirm(constraint)}
        >
          <Text style={[styles.confirmText, { color: "#00D9FF" }]}>
            Confirm Constraint
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function ConstraintParser({
  onConstraintConfirmed,
  onClose,
}: ConstraintParserProps) {
  const colors = useColors();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedConstraintResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleParse = useCallback(async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const parsed = await parseConstraint(input);
      setResult(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [input]);

  return (
    <View
      style={[styles.container, { backgroundColor: "rgba(0, 0, 0, 0.95)" }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: "#00D9FF" }]}>
          RouteMaster Constraints
        </Text>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.closeButton, { color: colors.muted }]}>
              Close
            </Text>
          </Pressable>
        )}
      </View>

      <Text style={[styles.subtitle, { color: colors.muted }]}>
        Type a constraint in plain English and Gemini will parse it into
        structured rules.
      </Text>

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.foreground,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
          value={input}
          onChangeText={setInput}
          placeholder='e.g. "Skip Elm Street on Tuesdays — school zone"'
          placeholderTextColor={colors.muted}
          multiline
          editable={!loading}
          returnKeyType="done"
          onSubmitEditing={handleParse}
        />
        <Pressable
          style={[
            styles.parseButton,
            {
              backgroundColor: loading ? colors.surface : "#00D9FF",
              opacity: !input.trim() || loading ? 0.5 : 1,
            },
          ]}
          onPress={handleParse}
          disabled={!input.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#00D9FF" />
          ) : (
            <Text style={styles.parseButtonText}>Parse</Text>
          )}
        </Pressable>
      </View>

      {/* Error */}
      {error && (
        <View
          style={[styles.errorBox, { borderColor: "rgba(255, 107, 74, 0.3)" }]}
        >
          <Text style={{ color: "#ff6b4a", fontSize: 13 }}>{error}</Text>
        </View>
      )}

      {/* Results */}
      {result && (
        <ScrollView style={styles.results} showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <Text style={[styles.summaryText, { color: colors.foreground }]}>
            {result.summary}
          </Text>

          {/* Constraint cards */}
          {result.parsed_constraints.map((c, i) => (
            <ConstraintCard
              key={c.id || i}
              constraint={c}
              colors={colors}
              onConfirm={onConstraintConfirmed}
            />
          ))}

          {/* Conflicts */}
          {result.conflicts_detected.length > 0 && (
            <View
              style={[
                styles.conflictsSection,
                { borderColor: "rgba(255, 107, 74, 0.3)" },
              ]}
            >
              <Text style={[styles.conflictsTitle, { color: "#ff6b4a" }]}>
                Potential Conflicts
              </Text>
              {result.conflicts_detected.map((c, i) => (
                <Text
                  key={i}
                  style={[styles.conflictItem, { color: colors.muted }]}
                >
                  {c.conflicts_with} — {c.resolution_suggestion}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeButton: {
    fontSize: 14,
    fontWeight: "500",
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
    maxHeight: 100,
  },
  parseButton: {
    borderRadius: 10,
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 72,
  },
  parseButtonText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "700",
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "rgba(255, 107, 74, 0.08)",
  },
  results: {
    flex: 1,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  cardTarget: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  cardReason: {
    fontSize: 13,
    marginBottom: 8,
  },
  scheduleRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  scheduleText: {
    fontSize: 12,
  },
  confidenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  confidenceLabel: {
    fontSize: 12,
  },
  confidenceValue: {
    fontSize: 12,
    fontWeight: "600",
  },
  confidenceBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  confidenceFill: {
    height: "100%",
    borderRadius: 3,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  warningText: {
    fontSize: 12,
    fontWeight: "500",
  },
  ambiguitySection: {
    marginBottom: 8,
  },
  ambiguityTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 2,
  },
  ambiguityItem: {
    fontSize: 12,
    marginLeft: 8,
  },
  confirmButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  confirmText: {
    fontSize: 13,
    fontWeight: "700",
  },
  conflictsSection: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "rgba(255, 107, 74, 0.05)",
  },
  conflictsTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },
  conflictItem: {
    fontSize: 12,
    marginBottom: 4,
  },
});
