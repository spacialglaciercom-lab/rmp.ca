/**
 * GeneralChatButton — Entry card for the general-purpose AI chat.
 *
 * Displayed on the Record tab. Tapping opens the GeneralChatOverlay.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useGeneralChat } from "@/context/GeneralChatContext";
import { useColors } from "@/hooks/use-colors";
import { glassStyle } from "@/lib/_core/theme";

export const GeneralChatButton: React.FC = () => {
  const colors = useColors();
  const { state, toggleOverlay } = useGeneralChat();

  return (
    <TouchableOpacity
      style={[
        styles.container,
        glassStyle,
        { borderColor: colors.primary, borderWidth: 1 },
      ]}
      onPress={() => toggleOverlay(true)}
      activeOpacity={0.75}
    >
      <View style={[styles.iconContainer, { backgroundColor: colors.primary + "20" }]}>
        <MaterialCommunityIcons
          name="chat-processing-outline"
          size={24}
          color={colors.primary}
        />
      </View>
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          AI Chat
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {state.messages.length > 0
            ? `${state.messages.length} messages • Tap to continue`
            : "General-purpose chat • OpenRouter & Mistral"}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={24}
        color={colors.muted}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
});
