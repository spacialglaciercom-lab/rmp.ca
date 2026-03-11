import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  Pressable,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { FeedbackSheet } from "@/components/settings/FeedbackSheet";
import { useColors } from "@/hooks/use-colors";
import { useTheme } from "@/lib/theme-provider";
import { Fonts } from "@/lib/_core/theme";
import { clearAllAppCache } from "@/lib/clear-all-cache";
import { clearMapCache } from "@/lib/map-cache";
import { confirmDestructive } from "@/lib/confirmDestructive";
import { ExportButton } from "@/components/export-button";
import { BetaFeaturesSection } from "@/components/settings/BetaFeaturesSection";
import { OpenRouterApiKeySection } from "@/components/settings/OpenRouterApiKeySection";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { OfflineMapDownloadSection } from "@/components/settings/OfflineMapDownloadSection";
import { OfflineTilePackSection } from "@/components/settings/OfflineTilePackSection";
import { MinimalCard, SectionLabel } from "@/components/minimal";
import { MapOrientationSection } from "@/components/settings/MapOrientationSection";
import { MapWebPluginsSection } from "@/components/settings/MapWebPluginsSection";
import { NavigationProviderSection } from "@/components/settings/NavigationProviderSection";
import { PowerSavingSettingsSection } from "@/components/PowerSavingSettings/PowerSavingSettingsSection";

export default function SettingsContent() {
  const colors = useColors();
  const { theme, colorScheme, setColorScheme } = useTheme();
  const router = useRouter();
  const isDark = colorScheme === "dark";
  const [feedbackVisible, setFeedbackVisible] = useState(false);
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
      "Clear all",
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
      title: "Plugins",
      items: [
        {
          label: "",
          value: "",
          component: PluginsSection,
          isComponent: true,
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
    {
      title: "AI / Co-Pilot",
      items: [
        {
          label: "",
          value: "",
          component: OpenRouterApiKeySection,
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
            Alert.alert(
              "Coming Soon",
              "Notification settings will be available in a future update",
            );
          },
        },
        {
          label: "Map style",
          value: "Map tab → Maps & Resources",
          onPress: () => {
            hapticImpact();
            router.push("/(tabs)/map");
          },
          description:
            "Configure map source (Dark/Standard) in Map tab sidebar",
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
            title: "Offline map tiles (MapLibre)",
            items: [
              {
                label: "",
                value: "",
                component: OfflineTilePackSection,
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
    {
      title: "Support",
      items: [
        {
          label: "Help and Support",
          value: "→",
          onPress: () => {
            hapticImpact();
            router.push("/(tabs)/help");
          },
          description: "Topics, battery modes, contact support",
        },
      ],
    },
    {
      title: "About",
      items: [
        {
          label: "Version",
          value: "1.0.9",
          onPress: () => {},
        },
        {
          label: "Algorithm",
          value: "CPP → MC-CARP Hybrid",
          onPress: () => {
            hapticImpact();
            Alert.alert(
              "Algorithm Info",
              "Using CPP → MC-CARP hybrid (2025 ref) with capacity constraints, service times, and turn penalties. Solved as Capacitated Arc Routing with Lagrangian relaxation.\n\nBeta: Turn-aware CPP with learned penalties (Q1 '26)",
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
              "A mobile application for optimizing trash collection routes with advanced CPP/MC-CARP algorithms, real-time tracking, and schedule management.",
            );
          },
        },
      ],
    },
  ];

  return (
    <ScreenContainer style={{ backgroundColor: theme.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontSize: 28,
            fontWeight: "400",
            letterSpacing: -0.02,
            color: theme.text,
            marginTop: 20,
            marginBottom: 24,
          }}
        >
          Settings
        </Text>

        {settingsSections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={{ marginBottom: 24 }}>
            <SectionLabel>{section.title}</SectionLabel>
            <MinimalCard
              style={{
                paddingVertical: 0,
                paddingHorizontal: 20,
                overflow: "hidden",
              }}
            >
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
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: "500",
                            color: theme.text,
                          }}
                        >
                          {item.label}
                        </Text>
                        {"description" in item && item.description && (
                          <Text
                            style={{
                              fontSize: 13,
                              color: theme.textSecondary,
                              marginTop: 2,
                            }}
                          >
                            {item.description}
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        style={{
                          width: 44,
                          height: 26,
                          borderRadius: 13,
                          backgroundColor: item.toggleValue
                            ? theme.accent
                            : theme.border,
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
                      onPress={
                        "onPress" in item && item.onPress
                          ? item.onPress
                          : () => {}
                      }
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingVertical: 14,
                        backgroundColor:
                          "highlight" in item && item.highlight
                            ? theme.accentSoft
                            : "transparent",
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: "500",
                            color:
                              "destructive" in item && item.destructive
                                ? colors.warning
                                : theme.text,
                          }}
                        >
                          {item.label}
                        </Text>
                        {"description" in item && item.description && (
                          <Text
                            style={{
                              fontSize: 12,
                              color: theme.textTertiary,
                              marginTop: 4,
                            }}
                          >
                            {item.description}
                          </Text>
                        )}
                      </View>
                      {item.value ? (
                        <Text
                          style={{ fontSize: 14, color: theme.textTertiary }}
                        >
                          {item.value}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  )}

                  {itemIndex < section.items.length - 1 && (
                    <View
                      style={{ height: 1, backgroundColor: theme.borderLight }}
                    />
                  )}
                </View>
              ))}
            </MinimalCard>
          </View>
        ))}

        <View style={{ alignItems: "center", paddingVertical: 24 }}>
          <Text
            style={{
              fontSize: 12,
              color: theme.textTertiary,
              textAlign: "center",
              letterSpacing: 0.08,
            }}
          >
            Route OS
          </Text>
          <Text
            style={{
              fontSize: 11,
              color: theme.textTertiary,
              textAlign: "center",
              marginTop: 4,
            }}
          >
            CPP → MC-CARP Hybrid · Beta: Turn-aware CPP (Q1 &apos;26)
          </Text>
          <TouchableOpacity
            onPress={() => {
              hapticImpact();
              setFeedbackVisible(true);
            }}
            style={{ marginTop: 16 }}
          >
            <Text
              style={{ fontSize: 13, color: theme.accent, textAlign: "center" }}
            >
              Send Product Feedback
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              hapticImpact();
              Linking.openURL("https://www.routemasterpro.ca/privacy");
            }}
            style={{ marginTop: 12 }}
          >
            <Text
              style={{ fontSize: 13, color: theme.accent, textAlign: "center" }}
            >
              Privacy Policy
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <FeedbackSheet
        visible={feedbackVisible}
        onClose={() => setFeedbackVisible(false)}
      />
    </ScreenContainer>
  );
}
