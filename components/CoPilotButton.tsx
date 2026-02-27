/**
 * CoPilotButton — Floating mic/chat button for the AI driving companion.
 *
 * States:
 * - idle: mic icon (tap to open overlay, long-press for push-to-talk)
 * - recording: pulsing red circle
 * - processing: spinner
 * - speaking: wave/sound icon (tap to stop)
 */
import React, { useRef, useCallback, useEffect } from "react";
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from "react-native";
import { useCoPilot } from "@/context/CoPilotContext";
import { useColors } from "@/hooks/use-colors";

interface CoPilotButtonProps {
  /** Compact mode for inline placement in bottom bars. */
  compact?: boolean;
}

const CoPilotButtonInner: React.FC<CoPilotButtonProps> = ({ compact = false }) => {
  const colors = useColors();
  const { state, startRecording, stopRecording, toggleOverlay, stopSpeaking } = useCoPilot();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);

  // Pulse animation for recording state
  React.useEffect(() => {
    if (state.status === "recording") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state.status, pulseAnim]);

  // Clear long-press timer on unmount so it does not fire after component is gone
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };
  }, []);

  const handlePressIn = useCallback(() => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      startRecording();
    }, 400);
  }, [startRecording]);

  const handlePressOut = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (isLongPress.current && state.status === "recording") {
      stopRecording();
      isLongPress.current = false;
    }
  }, [state.status, stopRecording]);

  const handlePress = useCallback(() => {
    if (isLongPress.current) return; // Handled by pressOut

    switch (state.status) {
      case "idle":
        toggleOverlay(true);
        break;
      case "speaking":
        stopSpeaking();
        break;
      case "recording":
        stopRecording();
        break;
      default:
        break;
    }
  }, [state.status, toggleOverlay, stopSpeaking, stopRecording]);

  const size = compact ? 44 : 56;

  const getIcon = () => {
    switch (state.status) {
      case "recording":
        return "●";
      case "processing":
        return null; // spinner
      case "speaking":
        return "◉";
      default:
        return "🎙";
    }
  };

  const getBackground = () => {
    switch (state.status) {
      case "recording":
        return "#EF4444"; // red
      case "processing":
        return colors.primary;
      case "speaking":
        return colors.accentCyan ?? "#06B6D4";
      default:
        return colors.primary;
    }
  };

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <TouchableOpacity
        style={[
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: getBackground(),
          },
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={
          state.status === "idle"
            ? "Open co-pilot chat"
            : state.status === "recording"
              ? "Stop recording"
              : state.status === "speaking"
                ? "Stop speaking"
                : "Co-pilot is thinking"
        }
      >
        {state.status === "processing" ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={[styles.icon, { fontSize: compact ? 18 : 22 }]}>
            {getIcon()}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  button: {
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  icon: {
    color: "#fff",
  },
});

export const CoPilotButton = React.memo(CoPilotButtonInner);
