import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useDeviceType } from "@/hooks/useDeviceType";
import { TransportModeSelector, type TransportMode } from "./TransportModeSelector";
import { RouteFieldInput, type RoutePoint } from "./RouteFieldInput";
import { EnhancedQuickDestinations } from "./EnhancedQuickDestinations";
import { useQuickDestinations } from "@/stores/enhancedQuickDestinationsStore";
import { AddDestinationModal } from "./AddDestinationModal";
import { AddressSearchModal } from "./AddressSearchModal";
import { getRoutingConfigAsync } from "@/lib/routing-config";
import { routeBetweenPoints, buildOfflineMatchedRoute } from "@/lib/mapMatching";
import { getRouteOptionsForRouting } from "@/stores/routeParametersStore";
import { useRouting } from "@/lib/routing-context";
import { TECH_NAV } from "./navigationTechStyle";

const PANEL_WIDTH_IPAD = 400;

interface NavigationPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Pre-filled destination when user tapped map before opening panel */
  tapDestination?: { lat: number; lon: number } | null;
  /** Callback when route is ready to display on map (e.g. after Start pressed) */
  onRouteReady?: (points: Array<{ lat: number; lon: number }>) => void;
}

export function NavigationPanel({
  visible,
  onClose,
  tapDestination,
  onRouteReady,
}: NavigationPanelProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const deviceType = useDeviceType();
  const { dispatch } = useRouting();

  const [transportMode, setTransportMode] = useState<TransportMode>("car");
  const [from, setFrom] = useState<RoutePoint>({
    label: "My Position",
    coords: null,
    useGPS: true,
  });
  const [to, setTo] = useState<RoutePoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addModalType, setAddModalType] = useState<"home" | "work" | "custom">("custom");
  const [addressSearchVisible, setAddressSearchVisible] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);

  const { home, work, custom, recent, addRecent, setHome, setWork, addCustom, updateCustom, deleteCustom } = useQuickDestinations();

  // Fetch current location when panel is visible so "Use Current Location" (e.g. set Home) works
  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            if (!cancelled) setCurrentLocation({ lat: p.coords.latitude, lon: p.coords.longitude });
          },
          () => { if (!cancelled) setCurrentLocation(null); },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
        return;
      }
      try {
        const Loc = await import("expo-location");
        const { status } = await Loc.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          setCurrentLocation(null);
          return;
        }
        const getPos = (Loc as { getCurrentPositionAsync?: (opts: object) => Promise<{ coords: { latitude: number; longitude: number } }> }).getCurrentPositionAsync;
        if (!getPos) return;
        const pos = await getPos({});
        if (!cancelled) setCurrentLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {
        if (!cancelled) setCurrentLocation(null);
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // Sync tapDestination into "to" when panel opens
  React.useEffect(() => {
    if (visible && tapDestination) {
      setTo({
        label: `${tapDestination.lat.toFixed(5)}, ${tapDestination.lon.toFixed(5)}`,
        coords: tapDestination,
        useGPS: false,
      });
    }
  }, [visible, tapDestination]);

  const handleSwap = useCallback(() => {
    hapticImpact();
    setFrom(to ?? { label: "My Position", coords: null, useGPS: true });
    setTo(from.label === "My Position" && from.useGPS ? null : from);
  }, [from, to]);

  const handleStart = useCallback(async () => {
    if (!to?.coords) {
      Alert.alert(
        "Select destination",
        "Tap the To field and choose or search for a destination."
      );
      return;
    }

    let fromCoords = from.coords;
    if (from.useGPS || !fromCoords) {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
        fromCoords = await new Promise<{ lat: number; lon: number } | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
          );
        });
      } else {
        try {
          const Loc = await import("expo-location");
          const { status } = await Loc.requestForegroundPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Location", "Allow location access to use My Position as start.");
            return;
          }
          const getPos = (Loc as {
            getCurrentPositionAsync?: (opts: object) => Promise<{
              coords: { latitude: number; longitude: number };
            }>;
          }).getCurrentPositionAsync;
          if (!getPos) return;
          const pos = await getPos({});
          fromCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        } catch {
          Alert.alert("Location", "Could not get your position.");
          return;
        }
      }
    }

    if (!fromCoords) {
      Alert.alert("Location", "Could not get start position.");
      return;
    }

    hapticImpact();
    setLoading(true);
    try {
      const routingConfig = await getRoutingConfigAsync();
      let matched = null;
      if (routingConfig.baseUrl) {
        matched = await routeBetweenPoints(
          fromCoords,
          to.coords,
          routingConfig,
          getRouteOptionsForRouting()
        );
      }
      if (!matched) {
        matched = buildOfflineMatchedRoute([fromCoords, to.coords]);
      }
      
      // Add destination to recent if it has coordinates
      if (to.coords) {
        const recentDest = {
          id: `recent-${Date.now()}`,
          label: to.label,
          coords: to.coords,
          type: "recent" as const,
          icon: "history",
          color: "#6C5CE7",
          timestamp: Date.now(),
        };
        addRecent(recentDest);
      }
      
      const geometry = matched.matchedGeometry.map((p) => ({ lat: p.lat, lon: p.lon }));
      dispatch({ type: "SET_PREVIEW_ROUTE", payload: geometry });
      onRouteReady?.(geometry);
      onClose();
    } catch (e) {
      console.warn("Navigation start failed:", e);
      Alert.alert("Navigation", "Could not get route. Try again.");
    } finally {
      setLoading(false);
    }
  }, [from, to, dispatch, onRouteReady, onClose]);

  const handleClose = useCallback(() => {
    hapticImpact();
    onClose();
  }, [onClose]);

  const handleQuickSelect = useCallback(
    (destination: any) => {
      setTo({
        label: destination.label,
        coords: destination.coords,
        useGPS: false,
      });
      
      // Add to recent destinations
      addRecent(destination);
    },
    [addRecent]
  );

  const handleQuickAdd = useCallback((type: "home" | "work" | "custom") => {
    setAddModalType(type);
    setAddModalVisible(true);
  }, []);

  const handleAddDestination = useCallback((destination: any) => {
    switch (destination.type) {
      case "home":
        setHome(destination);
        break;
      case "work":
        setWork(destination);
        break;
      case "custom":
        addCustom(destination);
        break;
    }
  }, [setHome, setWork, addCustom]);

  const handleEditDestination = useCallback((destination: any) => {
    if (destination.type === "custom") {
      updateCustom(destination.id, destination);
    }
  }, [updateCustom]);

  const handleDeleteDestination = useCallback((destinationId: string) => {
    if (destinationId.startsWith("custom-")) {
      deleteCustom(destinationId);
    }
  }, [deleteCustom]);

  if (!visible) return null;

  const isIpad = deviceType === "ipad";
  const panelHeightIphone = Math.round(windowHeight * 0.7);
  const panelStyle = isIpad
    ? [
        styles.panelIpad,
        {
          width: PANEL_WIDTH_IPAD,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          backgroundColor: colors.surface,
          borderRightColor: TECH_NAV.glassBorderBlue,
          borderRightWidth: 1,
        },
      ]
    : [
        styles.panelIphone,
        {
          height: panelHeightIphone,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
          backgroundColor: colors.surface,
          borderTopColor: TECH_NAV.glassBorderBlue,
          borderTopWidth: 1,
          borderTopLeftRadius: TECH_NAV.radiusPanel,
          borderTopRightRadius: TECH_NAV.radiusPanel,
        },
      ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View
          style={[
            isIpad ? styles.panelWrapperIpad : styles.panelWrapperIphone,
            panelStyle,
          ]}
        >
          <View style={[styles.header, { borderBottomColor: TECH_NAV.glassBorder }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Navigation
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={colors.muted}
              />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            style={styles.keyboardAvoid}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
          >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TransportModeSelector
              value={transportMode}
              onChange={setTransportMode}
            />

            <View style={{ marginTop: 20 }}>
              <RouteFieldInput
                label="From"
                point={from}
                placeholder="My Position"
                onPress={() => {
                  setFrom({ label: "My Position", coords: null, useGPS: true });
                }}
                showSwap={!!to}
                onSwap={handleSwap}
              />
              <RouteFieldInput
                label="To"
                point={to}
                placeholder="Select destination"
                onPress={() => setAddressSearchVisible(true)}
                showAdd
                onAdd={() => {
                  setAddModalType("custom");
                  setAddModalVisible(true);
                }}
              />
            </View>

            <EnhancedQuickDestinations
              destinations={[...(home ? [home] : []), ...(work ? [work] : []), ...(custom ?? [])]}
              onSelect={handleQuickSelect}
              onAdd={handleQuickAdd}
              onEdit={handleEditDestination}
              onDelete={handleDeleteDestination}
              recentDestinations={recent}
              showFavorites={true}
              maxRecent={3}
            />

            <AddDestinationModal
              visible={addModalVisible}
              onClose={() => setAddModalVisible(false)}
              onAddDestination={handleAddDestination}
              destinationType={addModalType}
              currentLocation={currentLocation}
            />

            <AddressSearchModal
              visible={addressSearchVisible}
              onClose={() => setAddressSearchVisible(false)}
              onSelect={({ lat, lon, label }) => {
                setTo({ label, coords: { lat, lon }, useGPS: false });
              }}
            />

            <View style={[styles.footer, { marginTop: 24 }]}>
              <TouchableOpacity
                style={[
                  styles.footerButton,
                  { backgroundColor: colors.muted + "30", borderColor: TECH_NAV.glassBorder },
                ]}
                onPress={handleClose}
              >
                <Text style={[styles.footerButtonText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.footerButton,
                  styles.footerButtonPrimary,
                  {
                    backgroundColor: TECH_NAV.blue,
                    borderColor: TECH_NAV.blue,
                    shadowColor: TECH_NAV.shadowBlue,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.5,
                    shadowRadius: 10,
                    elevation: 6,
                  },
                  loading && styles.footerButtonDisabled,
                ]}
                onPress={handleStart}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name="navigation"
                      size={20}
                      color="#fff"
                    />
                    <Text
                      style={[
                        styles.footerButtonText,
                        styles.footerButtonTextPrimary,
                        { color: "#fff" },
                      ]}
                    >
                      Start
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  panelWrapperIpad: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    borderRightWidth: 1,
  },
  panelWrapperIphone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  panelIpad: {
    flex: 1,
  },
  panelIphone: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeButton: {
    padding: 4,
  },
  keyboardAvoid: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {},
  footer: {
    flexDirection: "row",
    gap: 12,
  },
  footerButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: TECH_NAV.radiusInput,
    borderWidth: 1,
  },
  footerButtonPrimary: {},
  footerButtonDisabled: {
    opacity: 0.6,
  },
  footerButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  footerButtonTextPrimary: {},
});
