import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useHelpStore } from "@/stores/helpStore";
import { useColors } from "@/hooks/use-colors";
import { Fonts } from "@/lib/_core/theme";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

interface HelpPromptProps {
  // Delay before showing the prompt (in milliseconds)
  delay?: number;
  // Whether to show the prompt automatically
  autoShow?: boolean;
}

export function HelpPrompt({ delay = 5000, autoShow = true }: HelpPromptProps) {
  const colors = useColors();
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  
  // Help store state
  const hasSeenTutorial = useHelpStore((s) => s.hasSeenTutorial);
  const hasDismissedHelpPrompt = useHelpStore((s) => s.hasDismissedHelpPrompt);
  const setHasDismissedHelpPrompt = useHelpStore((s) => s.setHasDismissedHelpPrompt);
  const setLastHelpAccess = useHelpStore((s) => s.setLastHelpAccess);

  useEffect(() => {
    if (!autoShow || hasSeenTutorial || hasDismissedHelpPrompt) {
      return;
    }

    // Show prompt after delay
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [autoShow, hasSeenTutorial, hasDismissedHelpPrompt, delay]);

  const handleHelpPress = () => {
    hapticImpact();
    setIsVisible(false);
    setLastHelpAccess(Date.now());
    router.push("/(tabs)/help");
  };

  const handleDismiss = () => {
    hapticImpact();
    setIsVisible(false);
    setHasDismissedHelpPrompt(true);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface + "E6" }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="help-circle" size={24} color={colors.primary} />
          <Text style={[Fonts.body, { color: colors.text, fontWeight: "600", marginLeft: 8 }]}>
            Need Help?
          </Text>
        </View>
        
        <Text style={[Fonts.caption, { color: colors.muted, marginVertical: 8, lineHeight: 18 }]}>
          New to RouteMasterPro? Check out our help section to learn how to plan efficient routes and use all features.
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.dismissButton, { borderColor: colors.border }]}
            onPress={handleDismiss}
          >
            <Text style={[Fonts.caption, { color: colors.muted }]}>
              Dismiss
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.helpButton, { backgroundColor: colors.primary }]}
            onPress={handleHelpPress}
          >
            <Text style={[Fonts.caption, { color: "white", fontWeight: "600" }]}>
              Get Help
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 1000,
    borderRadius: 12,
    margin: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  content: {
    padding: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  dismissButton: {
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  helpButton: {
    borderWidth: 0,
  },
});