import { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Alert, Platform, Modal, Pressable, Share } from "react-native";
import { useRouter } from "expo-router";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useTheme } from "@/lib/theme-provider";
import { Fonts } from "@/lib/_core/theme";
import { clearAllAppCache } from "@/lib/clear-all-cache";
import { clearMapCache } from "@/lib/map-cache";
import { confirmDestructive } from "@/lib/confirmDestructive";
import { ExportButton } from "@/components/export-button";
import { AccountSection } from "@/components/settings/AccountSection";
import { BetaFeaturesSection } from "@/components/settings/BetaFeaturesSection";
import { OfflineMapDownloadSection } from "@/components/settings/OfflineMapDownloadSection";
import { RouteMapDownloadSection } from "@/components/settings/RouteMapDownloadSection";
import { MinimalCard, SectionLabel } from "@/components/minimal";
import { MapOrientationSection } from "@/components/settings/MapOrientationSection";
import { MapWebPluginsSection } from "@/components/settings/MapWebPluginsSection";
import { NavigationProviderSection } from "@/components/settings/NavigationProviderSection";
import { PowerSavingSettingsSection } from "@/components/PowerSavingSettings/PowerSavingSettingsSection";
import { registerForPushNotificationsAsync } from "@/lib/registerPushToken";

export default function SettingsContent() {
  const colors = useColors();
  const { theme, colorScheme, setColorScheme } = useTheme();
  const router = useRouter();
  const isDark = colorScheme === "dark";
  const handleClearCache = () => {
    hapticImpact();

    const doClear = async () => {
      try {
        await clearAllAppCache();
        if (Platform.OS === "web") {
          window.alert("All cache cleared successfully.");
        } else {
          Alert.alert("Success", "All cache cleared successfully.");
        }
      } catch (e) {
        console.error("Clear cache failed:", e);
        if (Platform.OS === "web") {
          window.alert("Failed to clear cache. Please try again.");
        } else {
          Alert.alert("Error", "Failed to clear cache. Please try again.");
        }
      }
    };

    confirmDestructive(
      "Clear All Cache",
      "This will remove ALL local data: current route, history, favorites, imported OSM/GPX, recovery state, weather cache, map preferences, saved tracks, and cached files. This cannot be undone.",
      doClear,
      "Clear all"
    );
  };

  const handleClearMapCache = () => {
    hapticImpact();
    confirmDestructive(
      "Clear Map Cache",
      "This will remove all cached map tiles. Tiles will be re-downloaded as needed.",
      async () => {
        await clearMapCache();
        if (Platform.OS === "web") {
          window.alert("Map tile cache cleared.");
        } else {
          Alert.alert("Success", "Map tile cache cleared.");
        }
      },
      "Clear",
    );
  };

  const handleRouteOptimization = () => {
    hapticImpact();
    router.push("/route-optimization");
  };

  const settingsSections = [
    ...(Platform.OS !== "web"
      ? [
          {
            title: "Account",
            items: [
              {
                label: "",
                value: "",
                component: AccountSection,
                isComponent: true,
              },
            ],
          },
        ]
      : []),
    {
      title: "Route Configuration",
      items: [
        {
          label: "Route Optimization",
          value: "Advanced →",
          onPress: handleRouteOptimization,
          highlight: true,
          description: "CPP, MC-CARP, temporal, multi-objective",
        },
      ],
    },
    {
      title: "Beta",
      items: [
        {
          label: "",
          value: "",
          component: BetaFeaturesSection,
          isComponent: true,
        },
      ],
    },
    ...(Platform.OS !== "web"
      ? [
          {
            title: "Power Saving",
            items: [
              {
                label: "",
                value: "",
                component: PowerSavingSettingsSection,
                isComponent: true,
              },
            ],
          },
        ]
      : []),
    {
      title: "Preferences",
      items: [
        {
          label: "Dark app style",
          description: "Switch to dark color scheme",
          isToggle: true,
          toggleValue: isDark,
          onToggle: () => {
            hapticImpact();
            setColorScheme(isDark ? "light" : "dark");
          },
        },
        {
          label: "Notifications",
          value: "Enabled",
          onPress: () => {
            hapticImpact();
            Alert.alert("Coming Soon", "Notification settings will be available in a future update");
          },
        },
        {
          label: "Map style",
          value: "Map tab → Maps & Resources",
          onPress: () => {
            hapticImpact();
            router.push("/(tabs)/map");
          },
          description: "Configure map source (Dark/Standard) in Map tab sidebar",
        },
        {
          label: "",
          value: "",
          component: MapOrientationSection,
          isComponent: true,
        },
        ...(Platform.OS === "web"
          ? [
              {
                label: "",
                value: "",
                component: MapWebPluginsSection,
                isComponent: true,
              },
            ]
          : []),
        {
          label: "",
          value: "",
          component: NavigationProviderSection,
          isComponent: true,
        },
      ],
    },
    ...(Platform.OS !== "web"
      ? [
          {
            title: "Offline maps (Overture)",
            items: [
              {
                label: "",
                value: "",
                component: OfflineMapDownloadSection,
                isComponent: true,
              },
            ],
          },
          {
            title: "Route map tiles",
            items: [
              {
                label: "",
                value: "",
                component: RouteMapDownloadSection,
                isComponent: true,
              },
            ],
          },
        ]
      : []),
    {
      title: "Data",
      items: [
        {
          label: "Export Route",
          value: "",
          component: ExportButton,
          isComponent: true,
        },
        {
          label: "Clear Cache",
          value: "",
          onPress: handleClearCache,
          destructive: true,
        },
        {
          label: "Clear Map Cache",
          value: "",
          onPress: handleClearMapCache,
          destructive: true,
          description: "Remove cached map tiles",
        },
      ],
    },
    ...(Platform.OS !== "web"
      ? [
          {
            title: "Developer",
            items: [
              {
                label: "Register for error alerts",
                value: "Push token",
                onPress: async () => {
                  hapticImpact();
                  try {
                    const token = await registerForPushNotificationsAsync();
                    if (!token) {
                      Alert.alert("Permission needed", "Enable notifications to receive error alerts on this device.");
                      return;
                    }
                    Alert.alert(
                      "Registered",
                      "This device is now registered for error alerts. You can also share the token to add it to EXPO_ERROR_PUSH_TOKENS on another server.",
                      [
                        { text: "OK" },
                        {
                          text: "Share token",
                          onPress: () => Share.share({ message: token, title: "Expo push token" }),
                        },
                      ]
                    );
                  } catch (e) {
                    Alert.alert("Error", e instanceof Error ? e.message : "Could not register push token");
                  }
                },
                description: "Register this device with the API to receive error push notifications",
              },
            ],
          },
        ]
      : []),
    {
      title: "About",
      items: [
        {
          label: "Version",
          value: "1.0.8",
          onPress: () => {},
        },
        {
          label: "Algorithm",
          value: "CPP → MC-CARP Hybrid",
          onPress: () => {
            hapticImpact();
            Alert.alert(
              "Algorithm Info",
              "Using CPP → MC-CARP hybrid (2025 ref) with capacity constraints, service times, and turn penalties. Solved as Capacitated Arc Routing with Lagrangian relaxation.\n\nBeta: Turn-aware CPP with learned penalties (Q1 '26)"
            );
          },
        },
        {
          label: "App Info",
          value: "",
          onPress: () => {
            hapticImpact();
            Alert.alert(
              "RouteMasterPro",
              "A mobile application for optimizing trash collection routes with advanced CPP/MC-CARP algorithms, real-time tracking, and schedule management."
            );
          },
        },
      ],
    },
  ];

  return (
    <ScreenContainer style={{ backgroundColor: theme.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 28, fontWeight: "400", letterSpacing: -0.02, color: theme.text, marginTop: 20, marginBottom: 24 }}>
          Settings
        </Text>

        {settingsSections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={{ marginBottom: 24 }}>
            <SectionLabel>{section.title}</SectionLabel>
            <MinimalCard style={{ paddingVertical: 0, paddingHorizontal: 20, overflow: "hidden" }}>
              {section.items.map((item, itemIndex) => (
                <View key={itemIndex}>
                  {"isToggle" in item && item.isToggle ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingVertical: 14,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: "500", color: theme.text }}>{item.label}</Text>
                        {"description" in item && item.description && (
                          <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }}>{item.description}</Text>
                        )}
                      </View>
                      <TouchableOpacity
                        style={{
                          width: 44,
                          height: 26,
                          borderRadius: 13,
                          backgroundColor: item.toggleValue ? theme.accent : theme.border,
                          justifyContent: "center",
                        }}
                        onPress={item.onToggle}
                        activeOpacity={0.9}
                      >
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: "#fff",
                            marginLeft: item.toggleValue ? 22 : 2,
                            shadowColor: "#000",
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.12,
                            shadowRadius: 3,
                            elevation: 2,
                          }}
                        />
                      </TouchableOpacity>
                    </View>
                  ) : "isComponent" in item && item.isComponent ? (
                    <View style={{ paddingVertical: 12 }}>
                      {item.component && <item.component />}
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={"onPress" in item && item.onPress ? item.onPress : () => {}}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingVertical: 14,
                        backgroundColor: "highlight" in item && item.highlight ? theme.accentSoft : "transparent",
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: "500",
                            color: "destructive" in item && item.destructive ? colors.warning : theme.text,
                          }}
                        >
                          {item.label}
                        </Text>
                        {"description" in item && item.description && (
                          <Text style={{ fontSize: 12, color: theme.textTertiary, marginTop: 4 }}>{item.description}</Text>
                        )}
                      </View>
                      {item.value ? (
                        <Text style={{ fontSize: 14, color: theme.textTertiary }}>{item.value}</Text>
                      ) : null}
                    </TouchableOpacity>
                  )}

                  {itemIndex < section.items.length - 1 && (
                    <View style={{ height: 1, backgroundColor: theme.borderLight }} />
                  )}
                </View>
              ))}
            </MinimalCard>
          </View>
        ))}

        <View style={{ alignItems: "center", paddingVertical: 24 }}>
          <Text style={{ fontSize: 12, color: theme.textTertiary, textAlign: "center", letterSpacing: 0.08 }}>
            Route OS
          </Text>
          <Text style={{ fontSize: 11, color: theme.textTertiary, textAlign: "center", marginTop: 4 }}>
            CPP → MC-CARP Hybrid · Beta: Turn-aware CPP (Q1 '26)
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}