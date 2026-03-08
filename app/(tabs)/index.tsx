/**
 * Home tab — Minimalist Route OS. No cyberpunk styling.
 */
import { useState, useEffect, Suspense } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import Constants from "expo-constants";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";

import { useTheme } from "@/lib/theme-provider";
import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
import { VRPPlanner } from "@/components/VRPPlanner";
import { MinimalCard, MinimalButton, SectionLabel } from "@/components/minimal";
import { HeaderWeather } from "@/components/HeaderWeather";
import type { Route, CollectionPoint } from "@/types";
import { storage } from "@/lib/storage";
import { isMockRoute } from "@/lib/is-mock-route";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { MapillaryAuthService } from "@/lib/mapillary-auth";
import { getPlugin } from "@/lib/plugins/registry";
import { usePluginStore } from "@/stores/pluginStore";

const useKeyboardAwareScroll = () =>
  Platform.OS !== "web" && Constants.appOwnership !== "expo";

/** Max stops shown in the Processing Queue list to avoid UI/performance issues. Use Map tab for the rest. */
const MAX_PROCESSING_QUEUE_DISPLAY = 500;

/** Renders the weather dashboard section only when the weather plugin is enabled. */
function HomeWeatherSectionIfPlugin() {
  const { theme } = useTheme();
  usePluginStore((s) => s.enabledPlugins); // subscribe so we re-render when plugin toggles change
  const weatherPlugin = getPlugin("weather");
  const enabled = usePluginStore((s) => s.isPluginEnabled("weather", true));
  if (!weatherPlugin || !enabled) return null;
  const Widget = weatherPlugin.getFeatures().widget as React.ComponentType | undefined;
  if (!Widget) return null;
  return (
    <Suspense
      fallback={
        <MinimalCard style={{ marginHorizontal: 16, marginBottom: 16, padding: 16 }}>
          <ActivityIndicator size="small" color={theme.text} />
        </MinimalCard>
      }
    >
      <Widget />
    </Suspense>
  );
}

/** Renders header weather only when the weather plugin is enabled. */
function HeaderWeatherIfPlugin({ textColor }: { textColor: string }) {
  usePluginStore((s) => s.enabledPlugins); // subscribe so we re-render when plugin toggles change
  const enabled = usePluginStore((s) => s.isPluginEnabled("weather", true));
  if (!enabled) return null;
  return <HeaderWeather textColor={textColor} />;
}

export default function HomeScreen() {
  const { theme } = useTheme();
  const colors = useColors();
  const router = useRouter();
  const useKeyboardAware = useKeyboardAwareScroll();
  const [route, setRoute] = useState<Route | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [contributingLoading, setContributingLoading] = useState(false);

  useEffect(() => {
    loadRoute();
  }, []);

  const loadRoute = async () => {
    try {
      const currentRoute = await storage.loadRoute();
      if (!currentRoute || isMockRoute(currentRoute)) {
        if (currentRoute && isMockRoute(currentRoute)) await storage.clearRoute();
        setRoute(null);
        return;
      }
      setRoute(currentRoute);
    } catch {
      setRoute(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRoute();
    setRefreshing(false);
  };

  const handleMarkComplete = async (point: CollectionPoint) => {
    if (!route) return;
    hapticImpact();
    await storage.updateCollectionPoint(route.id, point.id, {
      status: "completed",
      lastCollectionDate: new Date().toISOString(),
    });
    await loadRoute();
  };

  const handlePointPress = (point: CollectionPoint) => {
    hapticImpact();
    router.push({ pathname: "/point-detail", params: { pointId: point.id } });
  };

  const handleStartContributing = async () => {
    hapticImpact();
    setContributingLoading(true);
    try {
      const loggedIn = await MapillaryAuthService.getAccessToken();
      if (!loggedIn) {
        if (Constants.appOwnership === "expo") {
          const redirectUri = MapillaryAuthService.getRedirectUri();
          Alert.alert(
            "Expo Go: Add redirect URI in Mapillary",
            `In Mapillary Developer Applications, add this exact Redirect URI:\n\n${redirectUri}\n\nThen tap OK to open the Mapillary login.`,
            [
              { text: "Cancel", style: "cancel", onPress: () => setContributingLoading(false) },
              {
                text: "OK",
                onPress: async () => {
                  setContributingLoading(true);
                  try {
                    const token = await MapillaryAuthService.login();
                    if (token) router.push("/contribution");
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Could not connect to Mapillary.";
                    Alert.alert("Mapillary sign-in failed", msg);
                  } finally {
                    setContributingLoading(false);
                  }
                },
              },
            ]
          );
          return;
        }
        const token = await MapillaryAuthService.login();
        if (!token) return;
      }
      router.push("/contribution");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not connect to Mapillary.";
      if (__DEV__) console.warn("[Home] Mapillary login error:", e);
      Alert.alert("Mapillary sign-in failed", message);
    } finally {
      setContributingLoading(false);
    }
  };

  const isVrpRoute = route?.routeSource === "vrp";
  const subtitle = route
    ? isVrpRoute
      ? `${route.completedPoints}/${route.totalPoints} stops · ${Math.round(((route.completedPoints ?? 0) / (route.totalPoints || 1)) * 100)}%`
      : "Route ready · Use Map tab to navigate"
    : "";

  const header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: theme.text }]}>Route OS</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: theme.textTertiary }]}>{subtitle}</Text> : null}
        </View>
        <HeaderWeatherIfPlugin textColor={theme.text} />
      </View>


      <HomeWeatherSectionIfPlugin />

      <MinimalCard style={styles.card}>
        <VRPPlanner nestedInScrollView={Platform.OS !== "web"} />
      </MinimalCard>
    </View>
  );

  const renderPoint = ({ item }: { item: CollectionPoint }) => {
    const statusColor =
      item.status === "completed" ? colors.success : item.status === "pending" ? colors.warning : theme.textTertiary;
    return (
      <TouchableOpacity onPress={() => handlePointPress(item)} activeOpacity={0.85} style={styles.pointWrap}>
        <MinimalCard style={styles.pointCard}>
          <View style={styles.pointRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pointAddress, { color: theme.text }]}>{item.address}</Text>
              {item.locationName && (
                <Text style={[styles.pointLocation, { color: theme.textSecondary }]}>{item.locationName}</Text>
              )}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: theme.surfaceAlt }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {item.status === "completed" ? "Completed" : item.status === "pending" ? "Pending" : item.status === "skipped" ? "Skipped" : "Issue"}
              </Text>
            </View>
          </View>
          {item.status === "pending" && (
            <TouchableOpacity
              onPress={() => handleMarkComplete(item)}
              style={[styles.processBtn, { backgroundColor: theme.accent }]}
            >
              <Text style={[styles.processBtnText, { color: theme.bg === "#0C0C0C" ? "#0C0C0C" : "#fff" }]}>
                Mark complete
              </Text>
            </TouchableOpacity>
          )}
        </MinimalCard>
      </TouchableOpacity>
    );
  };

  const scrollProps = {
    style: { flex: 1 } as const,
    contentContainerStyle: [styles.scrollContent, { paddingBottom: 24 }] as const,
    keyboardShouldPersistTaps: "handled" as const,
    showsVerticalScrollIndicator: false,
  };

  if (!route) {
    return (
      <ScreenContainer style={{ backgroundColor: theme.bg }}>
        {Platform.OS === "web" ? (
          <ScrollView
            style={styles.webScroll}
            contentContainerStyle={styles.webScrollContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.webHeader}>
              <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                  <Text style={[styles.title, { color: theme.text }]}>Route OS</Text>
                  {subtitle ? <Text style={[styles.subtitle, { color: theme.textTertiary }]}>{subtitle}</Text> : null}
                </View>
                <HeaderWeatherIfPlugin textColor={theme.text} />
              </View>
              <HomeWeatherSectionIfPlugin />
            </View>
            <View style={styles.webContentWrap}>
              <MinimalCard style={styles.webCardFill}>
                <VRPPlanner nestedInScrollView={true} />
              </MinimalCard>
            </View>
          </ScrollView>
        ) : !useKeyboardAware ? (
          <ScrollView {...scrollProps}>{header}</ScrollView>
        ) : (
          <KeyboardAwareScrollView {...scrollProps} bottomOffset={20}>
            {header}
          </KeyboardAwareScrollView>
        )}
      </ScreenContainer>
    );
  }

  // Processing Queue (stops list) only for VRP routes; OSM/Planner routes are navigation-only
  if (!isVrpRoute) {
    return (
      <ScreenContainer style={{ backgroundColor: theme.bg }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: 16, paddingBottom: 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {header}
          <MinimalCard style={styles.navOnlyCard}>
            <Text style={[styles.navOnlyText, { color: theme.textTertiary }]}>
              This route is for navigation. Use the Map tab to drive it.
            </Text>
          </MinimalCard>
        </ScrollView>
      </ScreenContainer>
    );
  }

  const allPoints = route.points ?? [];
  const displayedPoints = allPoints.slice(0, MAX_PROCESSING_QUEUE_DISPLAY);
  const isTruncated = allPoints.length > MAX_PROCESSING_QUEUE_DISPLAY;

  return (
    <ScreenContainer style={{ backgroundColor: theme.bg }}>
      <FlatList
        data={displayedPoints}
        renderItem={renderPoint}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            {header}
            <SectionLabel>Processing Queue</SectionLabel>
            {isTruncated && (
              <Text style={[styles.truncatedNotice, { color: theme.textTertiary }]}>
                Showing first {MAX_PROCESSING_QUEUE_DISPLAY} of {allPoints.length} stops. Use the Map tab to navigate and mark the rest.
              </Text>
            )}
          </>
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: 20, paddingBottom: 24, paddingHorizontal: 16 },
  webScroll: {
    flex: 1,
  },
  webScrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  webHeader: {
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  webContentWrap: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  webCardFill: {
    marginBottom: 0,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  headerLeft: { flex: 1 },
  title: { fontSize: 28, fontWeight: "400", letterSpacing: -0.02 },
  subtitle: { fontSize: 14, marginTop: 4 },
  primaryCta: { marginTop: 20 },
  secondaryCta: { marginTop: 10 },
  helper: { fontSize: 12, textAlign: "center", marginTop: 8 },
  card: { marginBottom: 12 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  pointWrap: { marginBottom: 12 },
  pointCard: {},
  pointRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pointAddress: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  pointLocation: { fontSize: 14 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 12, fontWeight: "500" },
  processBtn: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignSelf: "flex-start" },
  processBtnText: { fontSize: 14, fontWeight: "500" },
  truncatedNotice: { fontSize: 13, marginBottom: 12, lineHeight: 18 },
  navOnlyCard: { padding: 16 },
  navOnlyText: { fontSize: 14, lineHeight: 20 },
});
