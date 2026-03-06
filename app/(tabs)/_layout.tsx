/**
 * Tab layout: Home, Route, Planner, Map, Record, Settings. Minimalist tab bar.
 * OSM Extractor sheet is rendered here so it works on all maps (Map, Record, etc.).
 */
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, View, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

import { useTheme } from "@/lib/theme-provider";
import { OvertureExtractorGlobalSheet } from "@/components/mapTab/overture/OvertureExtractorGlobalSheet";

export default function TabLayout() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 64 + bottomPadding;

  return (
    <View style={styles.container}>
    <Tabs
      initialRouteName="map"
      screenOptions={{
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarInactiveOpacity: 0.35,
        headerShown: false,
        tabBarShowLabel: true,
        /** So Planner and all tab content use theme background (fixes Planner staying white in dark mode). */
        sceneStyle: { backgroundColor: theme.bg },
        tabBarStyle: {
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: bottomPadding,
          backgroundColor: theme.surface,
          borderTopWidth: 1,
          borderTopColor: theme.border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "400",
        },
        tabBarActiveLabelStyle: {
          fontWeight: "600",
        },
        tabBarIconStyle: { marginBottom: 2 },
        tabBarItemStyle: { paddingVertical: 4, minWidth: 64 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="home" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="route"
        options={{
          title: "Route",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="truck-delivery-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: "Planner",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="map-marker-path" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="map" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="zones"
        options={{
          title: "Zones",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="vector-polygon" size={20} color={color} />,
        }}
      />
      {/* map-content is the screen component loaded by map.tsx; hide from tab bar so it doesn't show as a second Map tab. */}
      <Tabs.Screen
        name="map-content"
        options={{
          href: null,
          tabBarItemStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: "Extract",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="earth" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <MaterialCommunityIcons name="cog" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="help"
        options={{
          href: null,
          tabBarItemStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="map-layers"
        options={{
          href: null,
          tabBarItemStyle: { display: "none" },
        }}
      />
    </Tabs>
    <OvertureExtractorGlobalSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
