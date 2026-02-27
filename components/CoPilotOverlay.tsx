/**
 * CoPilotOverlay — Slide-up chat overlay for the AI driving companion.
 *
 * Shows conversation bubbles, text input, and mic button.
 * Works both during active navigation and when stationary.
 */
import React, { useRef, useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCoPilot, type CoPilotStatus } from "@/context/CoPilotContext";
import { useColors } from "@/hooks/use-colors";
import { CoPilotButton } from "./CoPilotButton";

export const CoPilotOverlay: React.FC = () => {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, sendMessage, toggleOverlay, clearMessages } = useCoPilot();
  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (state.messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [state.messages.length]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || state.status === "processing") return;
    setInputText("");
    sendMessage(text);
  }, [inputText, state.status, sendMessage]);

  const statusLabel = (status: CoPilotStatus): string => {
    switch (status) {
      case "recording": return "Listening...";
      case "processing": return "Thinking...";
      case "speaking": return "Speaking...";
      default: return "";
    }
  };

  return (
    <Modal
      visible={state.isOverlayOpen}
      transparent
      animationType="slide"
      onRequestClose={() => toggleOverlay(false)}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Backdrop */}
        <Pressable style={styles.backdrop} onPress={() => toggleOverlay(false)} />

        {/* Chat panel */}
        <View
          style={[
            styles.panel,
            {
              backgroundColor: colors.background,
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerLeft}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                Co-Pilot
              </Text>
              {state.status !== "idle" && (
                <Text style={[styles.statusText, { color: colors.accentCyan ?? colors.primary }]}>
                  {statusLabel(state.status)}
                </Text>
              )}
            </View>
            <View style={styles.headerRight}>
              {state.messages.length > 0 && (
                <TouchableOpacity onPress={clearMessages} style={styles.clearButton}>
                  <Text style={[styles.clearText, { color: colors.muted }]}>Clear</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => toggleOverlay(false)}
                style={styles.closeButton}
              >
                <Text style={[styles.closeText, { color: colors.foreground }]}>X</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Messages */}
          <FlatList
            ref={flatListRef}
            data={state.messages}
            keyExtractor={(_, i) => `msg-${i}`}
            style={styles.messageList}
            contentContainerStyle={styles.messageContent}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.role === "user"
                    ? [styles.userBubble, { backgroundColor: colors.primary }]
                    : [styles.assistantBubble, { backgroundColor: colors.surface }],
                ]}
              >
                <Text
                  style={[
                    styles.bubbleText,
                    {
                      color: item.role === "user" ? "#fff" : colors.foreground,
                    },
                  ]}
                >
                  {item.content}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  Hey! I'm your co-pilot
                </Text>
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  Type a message or hold the mic button to talk.{"\n"}
                  I know your route, the weather, and I'm here to keep you company.
                </Text>
              </View>
            }
          />

          {/* Error */}
          {state.error && (
            <View style={[styles.errorBar, { backgroundColor: colors.error + "20" }]}>
              <Text style={[styles.errorText, { color: colors.error }]} numberOfLines={2}>
                {state.error}
              </Text>
            </View>
          )}

          {/* Input bar */}
          <View style={[styles.inputBar, { borderTopColor: colors.border }]}>
            <View style={styles.micButtonContainer}>
              <CoPilotButton compact />
            </View>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surface,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              placeholder="Type a message..."
              placeholderTextColor={colors.muted}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              editable={state.status !== "processing"}
              multiline={false}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    inputText.trim() && state.status !== "processing"
                      ? colors.primary
                      : colors.muted + "40",
                },
              ]}
              onPress={handleSend}
              disabled={!inputText.trim() || state.status === "processing"}
            >
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  panel: {
    maxHeight: "70%",
    minHeight: 320,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  statusText: {
    fontSize: 13,
    fontWeight: "500",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  clearButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearText: {
    fontSize: 13,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  closeText: {
    fontSize: 18,
    fontWeight: "600",
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    padding: 16,
    gap: 10,
  },
  bubble: {
    maxWidth: "80%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20,
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  errorBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 13,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  micButtonContainer: {
    // Container for the compact CoPilotButton
  },
  textInput: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 16,
    fontSize: 15,
    borderWidth: 1,
  },
  sendButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  sendText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
});
