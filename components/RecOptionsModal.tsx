/**
 * Shared "START TRIP RECORDING" modal: logging interval slider,
 * Remember my choice, Show REC on map when recording. Used by Map Layers and Record tab.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
} from "react-native";
import Slider from "@react-native-community/slider";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import {
  useRecordingSettingsStore,
  LOGGING_INTERVAL_SEC_MIN,
  LOGGING_INTERVAL_SEC_MAX,
} from "@/stores/recordingSettingsStore";

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  titleUnderline: {
    height: 2,
    marginBottom: 20,
    borderRadius: 1,
  },
  label: {
    fontSize: 15,
    marginBottom: 8,
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
  },
  switch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: "center",
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  buttons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 24,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});

export interface RecOptionsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function RecOptionsModal({ visible, onClose }: RecOptionsModalProps) {
  const colors = useColors();
  const loggingIntervalSeconds = useRecordingSettingsStore(
    (s) => s.loggingIntervalSeconds,
  );
  const rememberMyChoice = useRecordingSettingsStore((s) => s.rememberMyChoice);
  const showRecOnMapWhenRecording = useRecordingSettingsStore(
    (s) => s.showRecOnMapWhenRecording,
  );
  const setLoggingIntervalSeconds = useRecordingSettingsStore(
    (s) => s.setLoggingIntervalSeconds,
  );
  const setRememberMyChoice = useRecordingSettingsStore(
    (s) => s.setRememberMyChoice,
  );
  const setShowRecOnMapWhenRecording = useRecordingSettingsStore(
    (s) => s.setShowRecOnMapWhenRecording,
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.content, { backgroundColor: colors.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            START TRIP RECORDING
          </Text>
          <View
            style={[styles.titleUnderline, { backgroundColor: "#FF9800" }]}
          />

          <Text style={[styles.label, { color: colors.text }]}>
            Logging interval: {loggingIntervalSeconds} sec
          </Text>
          <Slider
            style={{ width: "100%", height: 32 }}
            minimumValue={LOGGING_INTERVAL_SEC_MIN}
            maximumValue={LOGGING_INTERVAL_SEC_MAX}
            step={1}
            value={loggingIntervalSeconds}
            onValueChange={(v) => setLoggingIntervalSeconds(v)}
            minimumTrackTintColor={colors.primary ?? "#2196F3"}
            maximumTrackTintColor={colors.border ?? "#ccc"}
            thumbTintColor={colors.primary ?? "#2196F3"}
          />

          <View style={styles.rememberRow}>
            <Text style={{ color: colors.text, fontSize: 15 }}>
              Remember my choice
            </Text>
            <TouchableOpacity
              style={[
                styles.switch,
                {
                  backgroundColor: rememberMyChoice
                    ? colors.primary
                    : colors.border,
                },
              ]}
              onPress={() => {
                if (Platform.OS !== "web") hapticImpact();
                setRememberMyChoice(!rememberMyChoice);
              }}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.switchThumb,
                  {
                    backgroundColor: "white",
                    alignSelf: rememberMyChoice ? "flex-end" : "flex-start",
                  },
                ]}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.rememberRow}>
            <Text style={{ color: colors.text, fontSize: 15 }}>
              Show REC on map when recording
            </Text>
            <TouchableOpacity
              style={[
                styles.switch,
                {
                  backgroundColor: showRecOnMapWhenRecording
                    ? colors.primary
                    : colors.border,
                },
              ]}
              onPress={() => {
                if (Platform.OS !== "web") hapticImpact();
                setShowRecOnMapWhenRecording(!showRecOnMapWhenRecording);
              }}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.switchThumb,
                  {
                    backgroundColor: "white",
                    alignSelf: showRecOnMapWhenRecording
                      ? "flex-end"
                      : "flex-start",
                  },
                ]}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: colors.border ?? "#e0e0e0" },
              ]}
              onPress={onClose}
            >
              <Text
                style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}
              >
                CANCEL
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={onClose}
            >
              <Text style={{ color: "white", fontSize: 15, fontWeight: "600" }}>
                OK
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
