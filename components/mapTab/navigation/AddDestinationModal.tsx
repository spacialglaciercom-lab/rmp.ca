/**
 * Enhanced Add Destination Modal with multiple input methods
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import { useFavoritesStore } from "@/stores/favoritesStore";
import {
  useEnhancedQuickDestinationsStore,
  type QuickDestination,
} from "@/stores/enhancedQuickDestinationsStore";
import { searchAddress } from "@/lib/geocode";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TECH_NAV } from "./navigationTechStyle";

export type AddDestinationMethod =
  | "current"
  | "map"
  | "favorites"
  | "address"
  | "coordinates";

interface AddDestinationModalProps {
  visible: boolean;
  onClose: () => void;
  onAddDestination: (destination: QuickDestination) => void;
  destinationType: "home" | "work" | "custom";
  currentLocation?: { lat: number; lon: number } | null;
}

const ADD_METHODS = [
  {
    id: "current" as const,
    title: "Use Current Location",
    description: "Set your current GPS location",
    icon: "crosshairs-gps",
    color: "#4ECDC4",
  },
  {
    id: "map" as const,
    title: "Pick on Map",
    description: "Long-press on the map to select",
    icon: "map-marker",
    color: "#FF6B6B",
  },
  {
    id: "favorites" as const,
    title: "From Favorites",
    description: "Choose from saved places",
    icon: "star",
    color: "#FFD700",
  },
  {
    id: "address" as const,
    title: "Enter Address",
    description: "Type an address or place name",
    icon: "home-city-outline",
    color: "#95E1D3",
  },
  {
    id: "coordinates" as const,
    title: "Enter Coordinates",
    description: "Input lat/lon coordinates",
    icon: "map-marker-radius",
    color: "#A8E6CF",
  },
];

export function AddDestinationModal({
  visible,
  onClose,
  onAddDestination,
  destinationType,
  currentLocation,
}: AddDestinationModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selectedMethod, setSelectedMethod] =
    useState<AddDestinationMethod | null>(null);
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [locationFetching, setLocationFetching] = useState(false);

  const { favorites } = useFavoritesStore();

  const destinationTypeLabel =
    destinationType === "home"
      ? "Home"
      : destinationType === "work"
        ? "Work"
        : "Custom Destination";

  const effectiveCurrentLocation = currentLocation ?? resolvedLocation;

  useEffect(() => {
    if (visible) {
      setSelectedMethod(null);
      setAddress("");
      setLat("");
      setLon("");
      setLabel("");
      setLoading(false);
      setResolvedLocation(null);
      setLocationFetching(false);
    }
  }, [visible]);

  const handleMethodSelect = (method: AddDestinationMethod) => {
    hapticImpact();
    setSelectedMethod(method);
  };

  const fetchCurrentLocation = useCallback(async () => {
    setLocationFetching(true);
    setResolvedLocation(null);
    try {
      if (
        Platform.OS === "web" &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (p) => {
              setResolvedLocation({
                lat: p.coords.latitude,
                lon: p.coords.longitude,
              });
              resolve();
            },
            () => {
              reject(new Error("Location not found"));
            },
            { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 },
          );
        });
        return;
      }
      const Loc = await import("expo-location");
      const { status } = await Loc.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location not found",
          "Allow location access in settings to use your current position.",
        );
        return;
      }
      const getPos = (
        Loc as {
          getCurrentPositionAsync?: (
            opts: object,
          ) => Promise<{ coords: { latitude: number; longitude: number } }>;
        }
      ).getCurrentPositionAsync;
      if (!getPos) {
        Alert.alert(
          "Location not found",
          "Location is not available on this device.",
        );
        return;
      }
      const pos = await getPos({});
      setResolvedLocation({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      });
    } catch (e) {
      Alert.alert(
        "Location not found",
        "Enable location services and try again.",
      );
    } finally {
      setLocationFetching(false);
    }
  }, []);

  const handleUseCurrentLocation = () => {
    if (!effectiveCurrentLocation) {
      Alert.alert(
        "Location not found",
        'Enable location services and try again, or tap "Get my location" to retry.',
      );
      return;
    }

    const destination: QuickDestination = {
      id: `current-${Date.now()}`,
      label: label || `Current Location`,
      coords: effectiveCurrentLocation,
      type: destinationType,
      icon: "crosshairs-gps",
      color: "#4ECDC4",
    };

    onAddDestination(destination);
    onClose();
  };

  const handlePickFromMap = () => {
    Alert.alert(
      "Pick on Map",
      'Close this modal and long-press anywhere on the map, then select "Save to Quick Destinations" from the context menu.',
      [{ text: "OK", onPress: onClose }],
    );
  };

  const handleSelectFromFavorites = (favorite: any) => {
    const destination: QuickDestination = {
      id: `fav-${favorite.id}`,
      label: label || favorite.name,
      coords: favorite.coords,
      type: destinationType,
      icon: "star",
      color: "#FFD700",
    };

    onAddDestination(destination);
    onClose();
  };

  const handleSearchAddress = async () => {
    if (!address.trim()) {
      Alert.alert("Address Required", "Please enter an address or place name.");
      return;
    }

    setLoading(true);
    try {
      const results = await searchAddress(address.trim());
      const first = results[0];
      if (!first) {
        Alert.alert("No results", "No address found. Try a different search.");
        return;
      }
      const destination: QuickDestination = {
        id: `address-${Date.now()}`,
        label:
          label.trim() || (first?.displayName ?? `${first.lat}, ${first.lon}`),
        coords: { lat: first.lat, lon: first.lon },
        type: destinationType,
        icon: "home-city-outline",
        color: "#95E1D3",
      };
      onAddDestination(destination);
      onClose();
    } catch (e) {
      Alert.alert(
        "Search failed",
        e instanceof Error
          ? e.message
          : "Could not look up address. Check your connection.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleUseCoordinates = () => {
    if (!lat.trim() || !lon.trim()) {
      Alert.alert(
        "Coordinates Required",
        "Please enter both latitude and longitude.",
      );
      return;
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (isNaN(latNum) || isNaN(lonNum)) {
      Alert.alert(
        "Invalid Coordinates",
        "Please enter valid numeric coordinates.",
      );
      return;
    }

    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      Alert.alert(
        "Invalid Range",
        "Latitude must be between -90 and 90, longitude between -180 and 180.",
      );
      return;
    }

    const destination: QuickDestination = {
      id: `coords-${Date.now()}`,
      label: label || `${latNum.toFixed(6)}, ${lonNum.toFixed(6)}`,
      coords: { lat: latNum, lon: lonNum },
      type: destinationType,
      icon: "map-marker-radius",
      color: "#A8E6CF",
    };

    onAddDestination(destination);
    onClose();
  };

  const renderMethodSelection = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Add {destinationTypeLabel}
      </Text>
      <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
        Choose how to set the location
      </Text>

      <View style={styles.methodsContainer}>
        {ADD_METHODS.map((method) => (
          <TouchableOpacity
            key={method.id}
            style={[
              styles.methodCard,
              {
                backgroundColor: colors.surface,
                borderColor: TECH_NAV.inputBorder,
                borderRadius: TECH_NAV.radiusInput,
              },
            ]}
            onPress={() => handleMethodSelect(method.id)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={method.icon as any}
              size={32}
              color={method.color}
            />
            <View style={styles.methodText}>
              <Text style={[styles.methodTitle, { color: colors.text }]}>
                {method.title}
              </Text>
              <Text style={[styles.methodDescription, { color: colors.muted }]}>
                {method.description}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={colors.muted}
            />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );

  const renderSelectedMethod = () => {
    if (!selectedMethod) return null;

    return (
      <View style={{ flex: 1 }}>
        <View style={styles.methodHeader}>
          <TouchableOpacity
            onPress={() => setSelectedMethod(null)}
            style={styles.backButton}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {ADD_METHODS.find((m) => m.id === selectedMethod)?.title}
          </Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          {selectedMethod === "current" && (
            <View style={styles.methodContent}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: TECH_NAV.inputBorder,
                    backgroundColor: colors.surface,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                value={label}
                onChangeText={setLabel}
                placeholder="Enter a name for this location"
                placeholderTextColor={colors.muted}
              />
              {!effectiveCurrentLocation && (
                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    { borderColor: TECH_NAV.blue },
                  ]}
                  onPress={fetchCurrentLocation}
                  disabled={locationFetching}
                >
                  {locationFetching ? (
                    <ActivityIndicator size="small" color={TECH_NAV.blue} />
                  ) : (
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: TECH_NAV.blue },
                      ]}
                    >
                      Get my location
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: TECH_NAV.blue,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                onPress={handleUseCurrentLocation}
                disabled={!effectiveCurrentLocation}
              >
                <Text style={styles.primaryButtonText}>
                  {effectiveCurrentLocation
                    ? "Use Current Location"
                    : "Location not found"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {selectedMethod === "map" && (
            <View style={styles.methodContent}>
              <Text style={[styles.instructions, { color: colors.muted }]}>
                Close this modal and long-press on the map to select a location.
              </Text>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: TECH_NAV.blue,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                onPress={handlePickFromMap}
              >
                <Text style={styles.primaryButtonText}>Got it</Text>
              </TouchableOpacity>
            </View>
          )}

          {selectedMethod === "favorites" && (
            <View style={styles.methodContent}>
              {favorites.length > 0 ? (
                favorites.map((favorite) => (
                  <TouchableOpacity
                    key={favorite.id}
                    style={[
                      styles.favoriteItem,
                      {
                        backgroundColor: colors.surface,
                        borderColor: TECH_NAV.inputBorder,
                        borderRadius: TECH_NAV.radiusInput,
                      },
                    ]}
                    onPress={() => handleSelectFromFavorites(favorite)}
                  >
                    <MaterialCommunityIcons
                      name="star"
                      size={20}
                      color="#FFD700"
                    />
                    <View style={styles.favoriteText}>
                      <Text
                        style={[styles.favoriteName, { color: colors.text }]}
                      >
                        {favorite.name}
                      </Text>
                      <Text
                        style={[styles.favoriteCoords, { color: colors.muted }]}
                      >
                        {favorite.coords.lat.toFixed(5)},{" "}
                        {favorite.coords.lon.toFixed(5)}
                      </Text>
                    </View>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={20}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons
                    name="star-outline"
                    size={48}
                    color={colors.muted}
                  />
                  <Text style={[styles.emptyText, { color: colors.muted }]}>
                    No favorites yet
                  </Text>
                  <Text style={[styles.emptySubtext, { color: colors.muted }]}>
                    Long-press on the map to save locations
                  </Text>
                </View>
              )}
            </View>
          )}

          {selectedMethod === "address" && (
            <View style={styles.methodContent}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: TECH_NAV.inputBorder,
                    backgroundColor: colors.surface,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                value={address}
                onChangeText={setAddress}
                placeholder="Enter address or place name"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
              />
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: TECH_NAV.inputBorder,
                    backgroundColor: colors.surface,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                value={label}
                onChangeText={setLabel}
                placeholder="Custom name (optional)"
                placeholderTextColor={colors.muted}
              />
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: TECH_NAV.blue,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                onPress={handleSearchAddress}
                disabled={loading}
              >
                <Text style={styles.primaryButtonText}>
                  {loading ? "Searching..." : "Search Address"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {selectedMethod === "coordinates" && (
            <View style={styles.methodContent}>
              <View style={styles.coordinateInputs}>
                <TextInput
                  style={[
                    styles.coordinateInput,
                    {
                      color: colors.text,
                      borderColor: TECH_NAV.inputBorder,
                      backgroundColor: colors.surface,
                      borderRadius: TECH_NAV.radiusInput,
                    },
                  ]}
                  value={lat}
                  onChangeText={setLat}
                  placeholder="Latitude"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                />
                <TextInput
                  style={[
                    styles.coordinateInput,
                    {
                      color: colors.text,
                      borderColor: TECH_NAV.inputBorder,
                      backgroundColor: colors.surface,
                      borderRadius: TECH_NAV.radiusInput,
                    },
                  ]}
                  value={lon}
                  onChangeText={setLon}
                  placeholder="Longitude"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                />
              </View>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: TECH_NAV.inputBorder,
                    backgroundColor: colors.surface,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                value={label}
                onChangeText={setLabel}
                placeholder="Custom name (optional)"
                placeholderTextColor={colors.muted}
              />
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: TECH_NAV.blue,
                    borderRadius: TECH_NAV.radiusInput,
                  },
                ]}
                onPress={handleUseCoordinates}
              >
                <Text style={styles.primaryButtonText}>Use Coordinates</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <View
          style={[
            styles.modalContent,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: TECH_NAV.radiusPanel,
              borderTopRightRadius: TECH_NAV.radiusPanel,
            },
          ]}
        >
          <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={colors.text}
              />
            </TouchableOpacity>
          </View>

          {selectedMethod ? renderSelectedMethod() : renderMethodSelection()}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingBottom: 16,
  },
  closeButton: {
    padding: 8,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 16,
    marginBottom: 24,
  },
  methodsContainer: {
    gap: 12,
  },
  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderWidth: 1,
  },
  methodText: {
    flex: 1,
    marginLeft: 16,
  },
  methodTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  methodDescription: {
    fontSize: 14,
    marginTop: 2,
  },
  methodHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  methodContent: {
    gap: 16,
  },
  input: {
    borderWidth: 1,
    padding: 16,
    fontSize: 16,
  },
  coordinateInputs: {
    flexDirection: "row",
    gap: 12,
  },
  coordinateInput: {
    flex: 1,
    borderWidth: 1,
    padding: 16,
    fontSize: 16,
  },
  primaryButton: {
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  primaryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 2,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  instructions: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  favoriteItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  favoriteText: {
    flex: 1,
    marginLeft: 12,
  },
  favoriteName: {
    fontSize: 16,
    fontWeight: "600",
  },
  favoriteCoords: {
    fontSize: 14,
    marginTop: 2,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
});
