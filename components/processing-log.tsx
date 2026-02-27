import { useRef, useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import type { ProcessingLogEntry } from "@/types/routing";

export function ProcessingLog() {
  const colors = useColors();
  const { state, dispatch } = useRouting();
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new entries are added
    if (scrollViewRef.current && state.processingLog.length > 0) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [state.processingLog.length]);

  const getTypeColor = (type: ProcessingLogEntry["type"]) => {
    switch (type) {
      case "success":
        return colors.success;
      case "warning":
        return colors.warning;
      case "error":
        return colors.error;
      default:
        return colors.muted;
    }
  };

  const getTypeIcon = (type: ProcessingLogEntry["type"]) => {
    switch (type) {
      case "success":
        return "✓";
      case "warning":
        return "⚠";
      case "error":
        return "✕";
      default:
        return "•";
    }
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const handleClearLog = () => {
    hapticImpact();
    dispatch({ type: "CLEAR_LOG" });
  };

  return (
    <View
      className="bg-surface rounded-2xl p-5 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-lg font-semibold text-foreground">
          Processing Log
        </Text>
        {state.processingLog.length > 0 && (
          <TouchableOpacity
            onPress={handleClearLog}
            className="active:opacity-70"
          >
            <Text className="text-sm text-muted">Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {state.isProcessing && (
        <View
          className="flex-row items-center p-3 rounded-lg mb-3"
          style={{ backgroundColor: colors.primary + "20" }}
        >
          <Text className="text-primary mr-2">⟳</Text>
          <Text className="text-primary text-sm font-medium">
            Processing route...
          </Text>
        </View>
      )}

      <View
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: colors.background,
          maxHeight: 200,
        }}
      >
        {state.processingLog.length === 0 ? (
          <View className="p-4 items-center">
            <Text className="text-muted text-sm">
              No log entries yet. Start route generation to see progress.
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollViewRef}
            className="p-3"
            style={{ maxHeight: 200 }}
            showsVerticalScrollIndicator={true}
          >
            {state.processingLog.map((entry) => (
              <View
                key={entry.id}
                className="flex-row items-start mb-2 pb-2 border-b"
                style={{ borderBottomColor: colors.border + "50" }}
              >
                <Text
                  className="text-xs font-mono mr-2"
                  style={{ color: colors.muted }}
                >
                  [{formatTimestamp(new Date(entry.timestamp))}]
                </Text>
                <Text
                  className="mr-2"
                  style={{ color: getTypeColor(entry.type) }}
                >
                  {getTypeIcon(entry.type)}
                </Text>
                <Text
                  className="flex-1 text-xs"
                  style={{ color: colors.foreground }}
                >
                  {entry.message}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {state.processingLog.length > 0 && (
        <View className="mt-3 flex-row justify-between">
          <Text className="text-xs text-muted">
            {state.processingLog.length} entries
          </Text>
          <Text className="text-xs text-muted">
            {state.processingLog.filter((e) => e.type === "error").length} errors,{" "}
            {state.processingLog.filter((e) => e.type === "warning").length} warnings
          </Text>
        </View>
      )}
    </View>
  );
}
