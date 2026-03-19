import React from "react";
import { Pressable, View, Text, StyleSheet, Platform } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import type { SidebarMenuItem } from "@/constants/sidebarConfig";
import { useColors } from "@/hooks/use-colors";

interface SidebarMenuItemProps {
  item: SidebarMenuItem;
  onPress?: () => void;
}

const styles = StyleSheet.create({
  separator: {
    height: 1,
    backgroundColor: "#333333",
    marginVertical: 8,
    marginHorizontal: 16,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  menuItemIcon: {
    width: 24,
    height: 24,
  },
  menuItemLabel: {
    fontSize: 16,
    fontWeight: "400",
    flex: 1,
  },
  chevron: {
    width: 20,
    height: 20,
  },
});

function SidebarMenuItemRowInner({ item, onPress }: SidebarMenuItemProps) {
  const colors = useColors();

  if (item.isSeparator) {
    return <View style={styles.separator} />;
  }

  const handlePress = () => {
    if (Platform.OS !== "web") hapticImpact();
    onPress?.();
  };

  return (
    <Pressable
      style={({ pressed, hovered }) => [
        styles.menuItem,
        (pressed || hovered) && { backgroundColor: colors.border + "30" },
      ]}
      onPress={handlePress}
    >
      <MaterialCommunityIcons
        name={item.icon}
        size={24}
        color={colors.primary}
        style={styles.menuItemIcon}
      />
      <Text
        style={[styles.menuItemLabel, { color: colors.text }]}
        numberOfLines={1}
      >
        {item.label}
      </Text>
      {item.showChevron && (
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={colors.muted}
          style={styles.chevron}
        />
      )}
    </Pressable>
  );
}

export const SidebarMenuItemRow = React.memo(SidebarMenuItemRowInner);
