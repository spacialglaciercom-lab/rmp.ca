import "@/global.css";
import { recordStartupComplete } from "../lib/startup-time";
import instructionManager from "@/services/InstructionManager";
import instructionsData from "@/data/deliveryInstructions.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import "react-native-reanimated";
import { LogBox, Platform, Text, View } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import { ThemedStatusBar } from "@/components/themed-status-bar";
import { SyncConflictSheet } from "@/components/SyncConflictSheet";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import {
  destroyManusRuntime,
  initManusRuntime,
  subscribeSafeAreaInsets,
} from "@/lib/_core/manus-runtime";
import { RoutingProvider } from "@/lib/routing-context";
import { ErrorBoundary } from "@/components/error-boundary";
import { recordErrorToCrashlytics } from "@/lib/crashlytics-report";
import { trackScreen } from "@/lib/analytics";
import { reportErrorToServer } from "@/lib/error-report";
import { BetaFeaturesProvider } from "@/context/BetaFeaturesContext";
import { DeliveryInstructionsProvider } from "@/context/DeliveryInstructionsContext";
import { PluginProvider } from "@/context/PluginProvider";

import { FirebaseProvider } from "@/context/FirebaseContext";
import { DatabaseProvider } from "@/lib/database/DatabaseProvider";
import { Analytics } from "@vercel/analytics/react";
import { MapTypeProvider } from "@/lib/map-type-preference";
import { MapOrientationProvider } from "@/lib/map-orientation-preference";
import { initMapbox } from "@/lib/mapbox-config";
import { initMapCache, clearMapCache } from "@/lib/map-cache";
import { initMapLibreCacheCap } from "@/lib/maplibre-cache";
import { registerPMTilesProtocol } from "@/lib/maplibre-pmtiles-protocol";
import { PowerSavingProvider } from "@/src/powerSaving";
import { WebOSMDropZoneRoot } from "@/components/web-osm-drop-zone-root";
import { WebPasswordGate } from "@/components/WebPasswordGate";
import { OSM_DATA_STORAGE_KEY } from "@/lib/osm-storage";
import type { StoredOSMData } from "@/lib/osm-storage";
import { storage } from "@/lib/storage";
import { isMockRoute, isMockCollectionPoints } from "@/lib/is-mock-route";
import type { CollectionPoint } from "@/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Register PWA service worker for offline web support
import { useServiceWorker } from "@/lib/use-service-worker";

// Import delivery instructions once at startup
instructionManager.importFromJson(instructionsData);

// Force Platform (PlatformConstants) to initialize before other code; avoids TurboModuleRegistry
// "PlatformConstants could not be found" when bridgeless/New Arch is misconfigured.
if (typeof Platform !== "undefined") void Platform.OS;

const IMPORTED_POINTS_KEY = "trashroute_imported_points";
const IMPORTED_DISTANCE_KEY = "trashroute_imported_distance_km";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Record startup time when root layout is ready (dev: console; native prod: Crashlytics + Perf)
  useEffect(() => {
    recordStartupComplete();
  }, []);

  // Screen view analytics (feature usage) when route changes
  const pathname = usePathname();
  useEffect(() => {
    const raw = pathname?.replace(/^\//, "") || "unknown";
    const screenName =
      raw === "(tabs)" || raw === "" ? "Home" : (raw.split("/").pop() ?? raw);
    trackScreen(screenName, raw);
  }, [pathname]);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
    return () => destroyManusRuntime();
  }, []);

  // Register PWA service worker for offline web support
  useServiceWorker();

  // Mapbox Maps SDK: set access token at startup (native only; token from EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN)
  useEffect(() => {
    initMapbox();
  }, []);

  // Register PMTiles protocol (remote + local) so Overture overlay works and R2 works offline when downloaded.
  useEffect(() => {
    registerPMTilesProtocol();
  }, []);

  // On first launch, clear only the ambient tile cache (not offline packs) to avoid
  // stale PMTiles references. Then cap ambient cache and ensure MapLibre offline is ready.
  useEffect(() => {
    (async () => {
      try {
        const key = "trashroute_maplibre_ambient_clear_v1";
        const alreadyCleared = await AsyncStorage.getItem(key);
        if (!alreadyCleared) {
          await clearMapCache();
          await AsyncStorage.setItem(key, "1");
        }
        await initMapCache(50);
        await initMapLibreCacheCap();
      } catch (e) {
        console.warn("Map cache init failed:", e);
      }
    })();
  }, []);

  // Clear any stored mock/sample data on app load so it is never shown or exported
  useEffect(() => {
    (async () => {
      try {
        const route = await storage.loadRoute();
        if (route && isMockRoute(route)) await storage.clearRoute();
        const raw = await AsyncStorage.getItem(IMPORTED_POINTS_KEY);
        if (raw) {
          try {
            const points = JSON.parse(raw) as CollectionPoint[];
            if (isMockCollectionPoints(points)) {
              await AsyncStorage.removeItem(IMPORTED_POINTS_KEY);
              await AsyncStorage.removeItem(OSM_DATA_STORAGE_KEY);
              await AsyncStorage.removeItem(IMPORTED_DISTANCE_KEY);
              await AsyncStorage.removeItem("osm_import_timestamp");
            }
          } catch (_) {}
        }
      } catch (_) {}
    })();
  }, []);

  // On native: report uncaught JS errors to Crashlytics and to server (Expo Push to devs)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const g =
      typeof globalThis !== "undefined"
        ? globalThis
        : ((typeof global !== "undefined" ? global : undefined) as
            | Record<string, unknown>
            | undefined);
    const eu = g?.ErrorUtils as
      | {
          getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
          setGlobalHandler?: (
            fn: (error: Error, isFatal?: boolean) => void,
          ) => void;
        }
      | undefined;
    if (eu?.getGlobalHandler && eu?.setGlobalHandler) {
      const orig = eu.getGlobalHandler();
      const newHandler = (error: Error, isFatal?: boolean) => {
        const err = error instanceof Error ? error : new Error(String(error));
        recordErrorToCrashlytics(err, isFatal ? "Fatal" : "GlobalHandler");
        reportErrorToServer(err, {
          name: isFatal ? "Fatal" : "GlobalHandler",
          isFatal,
        }).catch(() => {});
        if (typeof orig === "function" && orig !== newHandler) {
          try {
            orig(error, isFatal);
          } catch (e) {
            console.error("Original error handler failed:", e);
          }
        }
      };
      eu.setGlobalHandler(newHandler);
      return () => {
        eu.setGlobalHandler?.(orig);
      };
    }
  }, []);

  // Ensure dev tools show errors: do not ignore LogBox in development
  useEffect(() => {
    if (!__DEV__) return;
    // Ensure errors and warnings appear in the dev overlay (LogBox is on by default; don't call ignoreAllLogs)
    if (Platform.OS !== "web" && typeof LogBox?.ignoreLogs !== "undefined") {
      // Only ignore specific known noisy warnings if needed; leave errors visible
      // LogBox.ignoreLogs(["..."]); // add any specific warning strings to hide
    }
    // On web, ensure unhandled errors and rejections are logged
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const onError = (event: ErrorEvent) => {
        console.error(
          "[Dev] Uncaught error:",
          event.message,
          event.filename,
          event.lineno,
          event.error,
        );
      };
      const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        console.error("[Dev] Unhandled promise rejection:", event.reason);
      };
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onUnhandledRejection);
      return () => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
      };
    }
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Leaflet CSS is deferred to when a map is first shown (Phase 1.2); see route-map.web.tsx

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  const handleWebOSMImport = useCallback(
    async (
      points: CollectionPoint[],
      osmData?: StoredOSMData,
      options?: { totalDistanceKm?: number },
    ) => {
      try {
        await AsyncStorage.setItem(IMPORTED_POINTS_KEY, JSON.stringify(points));
        if (osmData) {
          try {
            await AsyncStorage.setItem(
              OSM_DATA_STORAGE_KEY,
              JSON.stringify(osmData),
            );
          } catch (osmErr) {
            // OSM data can exceed AsyncStorage per-key limit (~2MB); avoid leaving partial/corrupt data
            await AsyncStorage.removeItem(OSM_DATA_STORAGE_KEY);
            console.warn(
              "OSM data too large for storage; re-optimize will require re-import:",
              osmErr,
            );
          }
        } else {
          await AsyncStorage.removeItem(OSM_DATA_STORAGE_KEY);
        }
        if (options?.totalDistanceKm != null) {
          await AsyncStorage.setItem(
            IMPORTED_DISTANCE_KEY,
            String(options.totalDistanceKm),
          );
        } else {
          await AsyncStorage.removeItem(IMPORTED_DISTANCE_KEY);
        }
        await AsyncStorage.setItem(
          "osm_import_timestamp",
          Date.now().toString(),
        );
      } catch (err) {
        console.error("Failed to store imported points:", err);
      }
    },
    [],
  );

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? {
      insets: initialInsets,
      frame: initialFrame,
    };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  // Navigation stack (shared between web and native)
  const navigationStack = (
    <Stack screenOptions={{ headerShown: false }} initialRouteName="(tabs)">
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="oauth/callback" />
      <Stack.Screen name="contribution" />
      <Stack.Screen name="iam/approve" />
    </Stack>
  );

  const appContent = (
    // --- Preference providers (no dependencies, outermost) ---
    <MapTypeProvider>
      <MapOrientationProvider>
        <PowerSavingProvider>
          <DeliveryInstructionsProvider>
            {/* --- Feature & AI providers --- */}
            <BetaFeaturesProvider>
              {/* --- Data providers (Firebase, routing, server) --- */}
              <FirebaseProvider>
                <RoutingProvider>
                  <trpc.Provider client={trpcClient} queryClient={queryClient}>
                    <PluginProvider trpcClient={trpcClient}>
                      <QueryClientProvider client={queryClient}>
                        <ErrorBoundary>
                          {Platform.OS === "web" ? (
                            <WebOSMDropZoneRoot
                              onImportComplete={handleWebOSMImport}
                            >
                              {navigationStack}
                            </WebOSMDropZoneRoot>
                          ) : (
                            navigationStack
                          )}
                        </ErrorBoundary>
                        <ThemedStatusBar />
                      </QueryClientProvider>
                    </PluginProvider>
                  </trpc.Provider>
                </RoutingProvider>
              </FirebaseProvider>
            </BetaFeaturesProvider>
          </DeliveryInstructionsProvider>
        </PowerSavingProvider>
      </MapOrientationProvider>
    </MapTypeProvider>
  );

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {Platform.OS === "web" ? (
        <WebPasswordGate style={{ flex: 1 }}>
          {appContent}
        </WebPasswordGate>
      ) : (
        <KeyboardProvider>{appContent}</KeyboardProvider>
      )}
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <DatabaseProvider
          onError={(err) => console.error("Database error:", err)}
        >
          <SafeAreaProvider initialMetrics={providerInitialMetrics}>
            <SafeAreaFrameContext.Provider value={frame}>
              <SafeAreaInsetsContext.Provider value={insets}>
                {content}
                <SyncConflictSheet />
              </SafeAreaInsetsContext.Provider>
            </SafeAreaFrameContext.Provider>
          </SafeAreaProvider>
          {Platform.OS === "web" && <Analytics />}
        </DatabaseProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <DatabaseProvider
        onError={(err) => console.error("Database error:", err)}
      >
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          {content}
          <SyncConflictSheet />
        </SafeAreaProvider>
        {Platform.OS === "web" && <Analytics />}
      </DatabaseProvider>
    </ThemeProvider>
  );
}
