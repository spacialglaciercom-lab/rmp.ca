/**
 * AIChatBubble — Minimal floating AI chat button with expandable bubble.
 *
 * - Tiny floating button (like Gemini)
 * - Tap to expand chat bubble
 * - Press and hold for voice input
 * - Text input when expanded
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
  ScrollView,
  Platform,
  Keyboard,
  AppState,
  InteractionManager,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useBetaFeatures } from "@/context/BetaFeaturesContext";
import { createLogger } from "@/lib/logger";

const log = createLogger("AIChatBubble");

type Status = "idle" | "recording" | "processing" | "speaking";

/** On web, render as <form> so Enter key submit can be caught with preventDefault (avoids full page reload). On native, render as View. */
function InputBarWrapper({
  children,
  style,
  onSubmit,
}: {
  children: React.ReactNode;
  style: Record<string, unknown> | unknown[];
  onSubmit?: () => void;
}) {
  if (Platform.OS === "web") {
    const flatStyle = StyleSheet.flatten([styles.inputBar, style]) as React.CSSProperties;
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
        style={flatStyle}
      >
        {children}
      </form>
    );
  }
  return <View style={[styles.inputBar, style]}>{children}</View>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

// Web Speech Recognition
let _webRecognition: any = null;
let _webRecognitionResolve: ((text: string | null) => void) | null = null;
let _webRecognitionResult: string | null = null;

function startWebSpeechRecognition(): boolean {
  if (Platform.OS !== "web") return false;
  const SpeechRecognition =
    (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
  if (!SpeechRecognition) return false;

  _webRecognitionResult = null;
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: any) => {
    let text = "";
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        text += event.results[i][0].transcript + " ";
      }
    }
    _webRecognitionResult = text.trim() || null;
  };

  recognition.onerror = () => {
    if (_webRecognitionResolve) {
      _webRecognitionResolve(null);
      _webRecognitionResolve = null;
    }
  };

  recognition.onend = () => {
    if (_webRecognitionResolve) {
      _webRecognitionResolve(_webRecognitionResult);
      _webRecognitionResolve = null;
    }
  };

  recognition.start();
  _webRecognition = recognition;
  return true;
}

function stopWebSpeechRecognition(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!_webRecognition) {
      resolve(null);
      return;
    }
    _webRecognitionResolve = resolve;
    _webRecognition.stop();
    _webRecognition = null;
    setTimeout(() => {
      if (_webRecognitionResolve) {
        _webRecognitionResolve(_webRecognitionResult);
        _webRecognitionResolve = null;
      }
    }, 3000);
  });
}

function AIChatBubbleInner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const expandAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  // Expand/collapse animation
  useEffect(() => {
    Animated.spring(expandAnim, {
      toValue: isExpanded ? 1 : 0,
      useNativeDriver: false,
      friction: 8,
    }).start();
  }, [isExpanded, expandAnim]);

  // Pulse animation for recording
  useEffect(() => {
    if (status === "recording") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 400, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setStatus("processing");
    setError(null);

    try {
      const { getApiBaseUrl } = await import("@/shared/oauth");
      const { getOpenRouterApiKey } = await import("@/lib/openrouter-api-key");
      const base = getApiBaseUrl();
      const clientGatewayApiKey = await getOpenRouterApiKey();
      log.debug("AIChatBubble request", { hasGatewayKey: !!clientGatewayApiKey });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45_000);
      const res = await fetch(`${base}/api/voice/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          history: messages.slice(-10),
          ...(clientGatewayApiKey ? { clientGatewayApiKey } : {}),
        }),
      });
      clearTimeout(timeoutId);

      const resText = await res.text();
      let data: { ok?: boolean; reply?: string; error?: string };
      try {
        data = resText ? (JSON.parse(resText) as { ok?: boolean; reply?: string; error?: string }) : {};
      } catch {
        data = {};
      }
      if (!res.ok || !data?.ok) {
        const msg =
          res.status === 404
            ? "Voice API not found (404). Redeploy your backend with the latest server code so it includes POST /api/voice/transcribe and /api/voice/chat."
            : typeof data?.error === "string"
              ? data.error
              : `Server error ${res.status}`;
        throw new Error(msg);
      }
      const reply = typeof data.reply === "string" ? data.reply : "Sorry, I couldn't process that.";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);

      // TTS response
      setStatus("speaking");
      try {
        const { speakText } = await import("@/services/elevenLabsTtsService");
        await speakText(reply);
      } catch {
        // Fallback to expo-speech
        try {
          const Speech = await import("expo-speech");
          await Speech.speak(reply, { rate: 1.0, volume: 1.0 });
        } catch {}
      }
      setStatus("idle");
    } catch (err) {
      log.error("sendMessage failed", err instanceof Error ? err : new Error(String(err)));
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Request timed out. Check your connection or try again."
          : err instanceof Error
            ? err.message
            : "Failed to send message";
      setError(message);
      setStatus("idle");
    }
  }, [messages]);

  const startRecording = useCallback(async () => {
    setError(null);
    if (Platform.OS === "web") {
      const started = startWebSpeechRecognition();
      if (!started) {
        setError("Speech recognition not supported");
        return;
      }
      setStatus("recording");
    } else {
      // iOS only allows activating the audio session when the app is in the foreground.
      if (AppState.currentState !== "active") {
        setError("Bring the app to the foreground to use the microphone.");
        return;
      }
      const runRecording = async () => {
        try {
          const { Audio } = await import("expo-av");
          const existing = (globalThis as any).__aiChatRecording;
          if (existing) {
            try {
              await existing.stopAndUnloadAsync();
            } catch (_) {}
            (globalThis as any).__aiChatRecording = null;
          }
          const { status: permStatus } = await Audio.requestPermissionsAsync();
          if (permStatus !== "granted") {
            setError("Microphone permission denied");
            return;
          }
          if (AppState.currentState !== "active") {
            setError("Bring the app to the foreground to use the microphone.");
            return;
          }
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
          });
          const { recording } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY,
          );
          (globalThis as any).__aiChatRecording = recording;
          setStatus("recording");
        } catch (err) {
          log.warn("startRecording failed", err instanceof Error ? err : new Error(String(err)));
          const msg = err instanceof Error ? err.message : "Could not start recording";
          if (msg.includes("background") && msg.includes("audio session")) {
            setError("Bring the app to the foreground to use the microphone.");
          } else {
            setError(msg);
          }
        }
      };
      // Defer so the modal/UI is fully in foreground and iOS treats the experience as active.
      InteractionManager.runAfterInteractions(() => {
        runRecording();
      });
    }
  }, []);

  const stopRecording = useCallback(async () => {
    setStatus("processing");

    if (Platform.OS === "web") {
      const text = await stopWebSpeechRecognition();
      if (text) {
        await sendMessage(text);
      } else {
        setError("Couldn't understand that");
        setStatus("idle");
      }
    } else {
      try {
        const recording = (globalThis as any).__aiChatRecording;
        if (!recording) {
          setStatus("idle");
          return;
        }
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        (globalThis as any).__aiChatRecording = null;

        if (!uri) {
          setError("No audio recorded");
          setStatus("idle");
          return;
        }

        // Transcribe: use server first (Moonshine when configured, else Whisper), then ElevenLabs fallback
        const FileSystem = await import("expo-file-system/legacy");
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        let transcribedText: string | null = null;
        let serverError: string | null = null;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60_000);
        try {
          const baseUrl = (await import("@/shared/oauth")).getApiBaseUrl();
          const res = await fetch(`${baseUrl}/api/voice/transcribe`, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mimeType: "audio/m4a" }),
          });
          clearTimeout(timeoutId);
          const text = await res.text();
          let data: { ok?: boolean; text?: string; error?: string };
          try {
            data = text ? (JSON.parse(text) as { ok?: boolean; text?: string; error?: string }) : {};
          } catch {
            data = {};
          }
          if (res.ok && data?.ok && typeof data.text === "string") {
            transcribedText = data.text;
          } else {
            if (res.status === 404) {
              serverError =
                "Voice API not found (404). Redeploy your backend with the latest server code so it includes POST /api/voice/transcribe and /api/voice/chat.";
            } else {
              const rawError = typeof data?.error === "string" ? data.error : `Server error ${res.status}`;
              if (rawError.toLowerCase().includes("transcription") && rawError.toLowerCase().includes("not configured")) {
                serverError =
                  "Voice transcription isn’t set up on your backend. On the server (or in Railway), set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY (Whisper API), or MOONSHINE_SIDECAR_URL and MOONSHINE_STT_ENABLED=true.";
              } else {
                serverError = rawError;
              }
            }
            log.warn("voice/transcribe request error", { status: res.status, error: serverError, baseUrl });
          }
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          serverError =
            fetchErr instanceof Error && fetchErr.name === "AbortError"
              ? "Transcription timed out"
              : fetchErr instanceof Error
                ? fetchErr.message
                : "Request failed";
          log.warn("voice/transcribe request error", { error: serverError });
        }

        if (!transcribedText && !serverError) {
          try {
            const { transcribeWithElevenLabs } = await import("@/services/elevenLabsTtsService");
            const result = await transcribeWithElevenLabs(base64, "audio/m4a");
            if (result?.text) transcribedText = result.text;
          } catch {}
        }

        if (transcribedText) {
          await sendMessage(transcribedText);
        } else {
          setError(serverError || "Couldn't understand that");
          setStatus("idle");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Recording failed";
        log.error("stopRecording failed", err instanceof Error ? err : new Error(String(err)));
        setError(message);
        setStatus("idle");
      }
    }
  }, [sendMessage]);

  const handlePressIn = useCallback(() => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      startRecording();
    }, 350);
  }, [startRecording]);

  const handlePressOut = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (isLongPress.current && status === "recording") {
      stopRecording();
      isLongPress.current = false;
    }
  }, [status, stopRecording]);

  const handlePress = useCallback(() => {
    if (isLongPress.current) return;
    if (status === "speaking") {
      // Stop speaking
      import("expo-speech").then((Speech) => Speech.stop()).catch(() => {});
      setStatus("idle");
    } else if (!isExpanded) {
      setIsExpanded(true);
    }
  }, [isExpanded, status]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    setIsExpanded(false);
  }, []);

  const handleSend = useCallback(() => {
    if (inputText.trim() && status !== "processing") {
      sendMessage(inputText);
    }
  }, [inputText, status, sendMessage]);

  // Button colors
  const buttonBg = status === "recording" ? "#EF4444" : status === "processing" ? colors.primary : colors.accentCyan ?? "#06B6D4";
  const buttonIcon = status === "recording" ? "●" : status === "processing" ? null : "✦";

  // Animated dimensions
  const bubbleWidth = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [48, 300],
  });
  const bubbleHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [48, 380],
  });
  const bubbleRadius = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [24, 20],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: insets.bottom + 80,
          right: 16,
          width: bubbleWidth,
          height: bubbleHeight,
          borderRadius: bubbleRadius,
          backgroundColor: isExpanded ? colors.background : buttonBg,
          shadowColor: "#000",
        },
      ]}
    >
      {isExpanded ? (
        // Expanded chat view
        <View style={styles.expandedContent}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>AI Chat</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={[styles.closeBtnText, { color: colors.muted }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={styles.messageList}
            contentContainerStyle={styles.messageContent}
          >
            {messages.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                Hold the mic to talk, or type below
              </Text>
            ) : (
              messages.map((msg, i) => (
                <View
                  key={i}
                  style={StyleSheet.flatten([
                    styles.bubble,
                    msg.role === "user"
                      ? [styles.userBubble, { backgroundColor: colors.primary }]
                      : [styles.assistantBubble, { backgroundColor: colors.surface }],
                  ])}
                >
                  <Text style={{ color: msg.role === "user" ? "#fff" : colors.foreground, fontSize: 14 }}>
                    {msg.content}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>

          {/* Error */}
          {error && (
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          )}

          {/* Input bar — on web wrap in form so Enter doesn't trigger full page reload */}
          <InputBarWrapper
            style={[styles.inputBar, { borderTopColor: colors.border }]}
            onSubmit={() => {
              if (inputText.trim() && status !== "processing") sendMessage(inputText);
            }}
          >
            {/* Mic button */}
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={[styles.micBtn, { backgroundColor: buttonBg }]}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                activeOpacity={0.7}
              >
                {status === "processing" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.micIcon}>{status === "recording" ? "●" : "🎙"}</Text>
                )}
              </TouchableOpacity>
            </Animated.View>

            <TextInput
              style={[
                styles.textInput,
                { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border },
              ]}
              placeholder="Type..."
              placeholderTextColor={colors.muted}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              editable={status !== "processing"}
            />

            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: inputText.trim() ? colors.primary : colors.muted + "40" }]}
              onPress={handleSend}
              disabled={!inputText.trim() || status === "processing"}
            >
              <Text style={styles.sendText}>→</Text>
            </TouchableOpacity>
          </InputBarWrapper>
        </View>
      ) : (
        // Collapsed button
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={styles.collapsedBtn}
            onPress={handlePress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={0.8}
          >
            {status === "processing" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.collapsedIcon}>{buttonIcon}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    overflow: "hidden",
  },
  collapsedBtn: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  collapsedIcon: {
    fontSize: 20,
    color: "#fff",
  },
  expandedContent: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  closeBtn: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  closeBtnText: {
    fontSize: 16,
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    padding: 10,
    gap: 8,
  },
  emptyText: {
    textAlign: "center",
    fontSize: 13,
    marginTop: 40,
  },
  bubble: {
    maxWidth: "85%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  errorText: {
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 6,
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  micIcon: {
    fontSize: 16,
    color: "#fff",
  },
  textInput: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    fontSize: 14,
    borderWidth: 1,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  sendText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

// Wrapper component that handles the feature flag check
// This prevents the inner component from re-rendering when other beta features change
export const AIChatBubble: React.FC = React.memo(() => {
  const { features } = useBetaFeatures();
  const isEnabled = features.enabled && features.voiceCoPilot;

  if (!isEnabled) {
    return null;
  }

  return <AIChatBubbleInner />;
});
