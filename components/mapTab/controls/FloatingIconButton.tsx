import React from "react";
import {
  Pressable,
  StyleSheet,
  ViewStyle,
  Platform,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

interface FloatingIconButtonProps {
  icon: IconName;
  onPress: () => void;
  size?: number;
  style?: ViewStyle;
  disabled?: boolean;
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#2A2A2A",
    borderWidth: 1,
    borderColor: "#444444",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  icon: {
    color: "#FFFFFF",
  },
});

function FloatingIconButtonInner({
  icon,
  onPress,
  size = 44,
  style,
  disabled = false,
}: FloatingIconButtonProps) {
  const colors = useColors();

  const handlePress = () => {
    if (Platform.OS !== "web") {
      hapticImpact();
    }
    onPress();
  };

  return (
    <Pressable
      style={({ pressed, hovered }) => [
        styles.button,
        { width: size, height: size },
        style,
        disabled && { opacity: 0.5 },
        (pressed || hovered) && !disabled && { opacity: 0.85 },
      ]}
      onPress={handlePress}
      disabled={disabled}
    >
      <MaterialCommunityIcons
        name={icon}
        size={size * 0.45}
        color={colors.text}
        style={styles.icon}
      />
    </Pressable>
  );
}

export const FloatingIconButton = React.memo(FloatingIconButtonInner);
