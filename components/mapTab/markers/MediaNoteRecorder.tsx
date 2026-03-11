/**
 * MediaNoteRecorder - Modal for recording audio/video notes attached to markers.
 * Uses expo-av for audio recording and expo-camera for video.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";

interface MediaNoteRecorderProps {
  visible: boolean;
  onSave: (uri: string, type: "audio" | "video", duration?: number) => void;
  onCancel: () => void;
}

type RecordingMode = "idle" | "audio" | "video";

export function MediaNoteRecorder({
  visible,
  onSave,
  onCancel,
}: MediaNoteRecorderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<RecordingMode>("idle");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [loading, setLoading] = useState(false);
  const audioRecordingRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) {
      setMode("idle");
      setIsRecording(false);
      setRecordingTime(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [visible]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const startAudioRecording = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Audio recording is not available on web.");
      return;
    }

    try {
      setLoading(true);
      const { Audio } = await import("expo-av");

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Permission Required",
          "Microphone access is required to record audio notes.",
        );
        setLoading(false);
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      audioRecordingRef.current = recording;
      setIsRecording(true);
      setRecordingTime(0);
      setMode("audio");

      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch (error) {
      console.error("Failed to start recording:", error);
      Alert.alert("Error", "Failed to start audio recording.");
    } finally {
      setLoading(false);
    }
  }, []);

  const stopAudioRecording = useCallback(async () => {
    if (!audioRecordingRef.current) return;

    try {
      setLoading(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      await audioRecordingRef.current.stopAndUnloadAsync();
      const uri = audioRecordingRef.current.getURI();
      const duration = recordingTime;

      audioRecordingRef.current = null;
      setIsRecording(false);
      setMode("idle");

      if (uri) {
        onSave(uri, "audio", duration);
      }
    } catch (error) {
      console.error("Failed to stop recording:", error);
      Alert.alert("Error", "Failed to save audio recording.");
    } finally {
      setLoading(false);
    }
  }, [recordingTime, onSave]);

  const cancelRecording = useCallback(async () => {
    if (audioRecordingRef.current) {
      try {
        await audioRecordingRef.current.stopAndUnloadAsync();
      } catch (e) {
        // Ignore errors when canceling
      }
      audioRecordingRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    setMode("idle");
    onCancel();
  }, [onCancel]);

  const startVideoRecording = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Video recording is not available on web.");
      return;
    }

    Alert.alert(
      "Video Notes",
      "Video recording will be available in a future update. For now, please use audio notes.",
      [{ text: "OK" }],
    );
  }, []);

  const handleClose = () => {
    if (Platform.OS !== "web") hapticImpact();
    if (isRecording) {
      Alert.alert(
        "Recording in Progress",
        "Do you want to discard the current recording?",
        [
          { text: "Continue Recording", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: cancelRecording },
        ],
      );
    } else {
      onCancel();
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: colors.surface,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>
              {isRecording ? "Recording..." : "Add Note"}
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={colors.muted}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.muted }]}>
                  {isRecording ? "Saving..." : "Starting..."}
                </Text>
              </View>
            ) : isRecording ? (
              <View style={styles.recordingContainer}>
                <View
                  style={[
                    styles.recordingIndicator,
                    { backgroundColor: "#E53935" },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={mode === "audio" ? "microphone" : "video"}
                    size={48}
                    color="#fff"
                  />
                </View>
                <Text style={[styles.timer, { color: colors.text }]}>
                  {formatTime(recordingTime)}
                </Text>
                <Text style={[styles.hint, { color: colors.muted }]}>
                  Tap stop when finished
                </Text>
                <TouchableOpacity
                  style={[styles.stopButton, { backgroundColor: "#E53935" }]}
                  onPress={stopAudioRecording}
                >
                  <MaterialCommunityIcons name="stop" size={32} color="#fff" />
                  <Text style={styles.stopButtonText}>Stop & Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.optionsContainer}>
                <Text style={[styles.subtitle, { color: colors.muted }]}>
                  Choose note type
                </Text>
                <View style={styles.options}>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor: colors.primary + "20",
                        borderColor: colors.primary,
                      },
                    ]}
                    onPress={startAudioRecording}
                  >
                    <MaterialCommunityIcons
                      name="microphone"
                      size={40}
                      color={colors.primary}
                    />
                    <Text style={[styles.optionText, { color: colors.text }]}>
                      Audio Note
                    </Text>
                    <Text style={[styles.optionHint, { color: colors.muted }]}>
                      Record voice memo
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.optionButton,
                      {
                        backgroundColor: colors.muted + "20",
                        borderColor: colors.muted,
                      },
                    ]}
                    onPress={startVideoRecording}
                  >
                    <MaterialCommunityIcons
                      name="video"
                      size={40}
                      color={colors.muted}
                    />
                    <Text style={[styles.optionText, { color: colors.text }]}>
                      Video Note
                    </Text>
                    <Text style={[styles.optionHint, { color: colors.muted }]}>
                      Coming soon
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  container: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeBtn: {
    padding: 4,
  },
  content: {
    padding: 24,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
  },
  recordingContainer: {
    alignItems: "center",
    paddingVertical: 20,
  },
  recordingIndicator: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  timer: {
    fontSize: 48,
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    marginBottom: 24,
  },
  stopButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  stopButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  optionsContainer: {
    alignItems: "center",
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 20,
  },
  options: {
    flexDirection: "row",
    gap: 16,
  },
  optionButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  optionText: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 12,
  },
  optionHint: {
    fontSize: 12,
    marginTop: 4,
  },
});
