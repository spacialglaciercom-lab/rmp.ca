import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  impactAsync as hapticImpact,
  notificationAsync as hapticNotification,
  NotificationFeedbackType,
} from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import {
  useRouting,
  validateCoordinates,
  generateLogEntry,
} from "@/lib/routing-context";
import type { RouteConfiguration } from "@/types/routing";

// --- Presenter (Pure UI) ---

export interface StartPointConfigUIProps {
  // State
  latInput: string;
  lonInput: string;
  nameInput: string;
  error: string | null;
  latError: string | null;
  lonError: string | null;
  locationLoading: boolean;
  locationError: string | null;
  hasInputErrors: boolean;
  isValid: boolean | undefined;
  startPointConfig: RouteConfiguration['startPoint'];
  colors: ReturnType<typeof useColors>;

  // Handlers
  onLatChange: (value: string) => void;
  onLonChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onValidate: () => void;
  onClear: () => void;
  onUseCurrentLocation: () => void;
}

export function StartPointConfigUI({
  latInput,
  lonInput,
  nameInput,
  error,
  latError,
  lonError,
  locationLoading,
  locationError,
  hasInputErrors,
  isValid,
  startPointConfig,
  colors,
  onLatChange,
  onLonChange,
  onNameChange,
  onValidate,
  onClear,
  onUseCurrentLocation
}: StartPointConfigUIProps) {
  return (
    <View
      className="bg-surface rounded-2xl p-5 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-2">
        Start Point Configuration
      </Text>

      <Text className="text-sm text-muted mb-3">
        Optional: Set a custom starting point for the route. Leave empty to use
        the graph centroid.
      </Text>
      <Text
        className="text-xs font-medium mb-3"
        style={{ color: colors.primary }}
      >
        ⚠️ Important: Click &quot;Validate & Set&quot; after entering
        coordinates — your start point is only used when this step is done.
      </Text>

      <TouchableOpacity
        onPress={onUseCurrentLocation}
        disabled={locationLoading}
        className="mb-3 py-2 px-3 rounded-lg self-start flex-row items-center"
        style={{
          backgroundColor:
            (locationLoading ? colors.muted : colors.primary) + "20",
        }}
      >
        {locationLoading ? (
          <ActivityIndicator
            size="small"
            color={colors.primary}
            style={{ marginRight: 8 }}
          />
        ) : null}
        <Text style={{ color: colors.primary }} className="text-sm font-medium">
          📍 Use current location
        </Text>
      </TouchableOpacity>
      {locationError && (
        <Text style={{ color: colors.error }} className="text-xs mb-3">
          {locationError}
        </Text>
      )}

      <View className="mb-3">
        <Text className="text-sm text-muted mb-1">
          Location Name (Optional)
        </Text>
        <TextInput
          value={nameInput}
          onChangeText={onNameChange}
          placeholder="e.g., Depot, Starting Location"
          placeholderTextColor={colors.muted}
          className="bg-background rounded-lg p-3 text-foreground"
          style={{
            backgroundColor: colors.background,
            color: colors.foreground,
          }}
        />
      </View>

      <View className="flex-row gap-3 mb-1">
        <View className="flex-1">
          <Text className="text-sm text-muted mb-1">Latitude</Text>
          <TextInput
            value={latInput}
            onChangeText={onLatChange}
            placeholder="e.g., 40.7128"
            placeholderTextColor={colors.muted}
            keyboardType="numbers-and-punctuation"
            returnKeyType="done"
            className="bg-background rounded-lg p-3 text-foreground"
            style={{
              backgroundColor: colors.background,
              color: colors.foreground,
              borderWidth: latError ? 1 : 0,
              borderColor: colors.error,
            }}
          />
          {latError && (
            <Text style={{ color: colors.error }} className="text-xs mt-1">
              {latError}
            </Text>
          )}
        </View>
        <View className="flex-1">
          <Text className="text-sm text-muted mb-1">Longitude</Text>
          <TextInput
            value={lonInput}
            onChangeText={onLonChange}
            placeholder="e.g., -74.0060"
            placeholderTextColor={colors.muted}
            keyboardType="numbers-and-punctuation"
            returnKeyType="done"
            className="bg-background rounded-lg p-3 text-foreground"
            style={{
              backgroundColor: colors.background,
              color: colors.foreground,
              borderWidth: lonError ? 1 : 0,
              borderColor: colors.error,
            }}
          />
          {lonError && (
            <Text style={{ color: colors.error }} className="text-xs mt-1">
              {lonError}
            </Text>
          )}
        </View>
      </View>

      <Text className="text-xs text-muted mb-3">
        Format: Decimal degrees (e.g., 40.7128, -74.0060)
      </Text>

      {error && (
        <View
          className="p-3 rounded-lg mb-3"
          style={{ backgroundColor: colors.error + "20" }}
        >
          <Text style={{ color: colors.error }} className="text-sm">
            ⚠️ {error}
          </Text>
        </View>
      )}

      {isValid && startPointConfig && (
        <View
          className="p-3 rounded-lg mb-3"
          style={{ backgroundColor: colors.success + "20" }}
        >
          <Text
            style={{ color: colors.success }}
            className="text-sm font-medium"
          >
            ✓ Valid coordinates set
          </Text>
          <Text style={{ color: colors.success }} className="text-xs mt-1">
            Lat:{" "}
            {startPointConfig.coordinates.latitude.toFixed(6)},
            Lon:{" "}
            {startPointConfig.coordinates.longitude.toFixed(6)}
          </Text>
        </View>
      )}

      <View className="flex-row gap-3">
        <TouchableOpacity
          onPress={onValidate}
          disabled={hasInputErrors}
          style={{
            backgroundColor: hasInputErrors ? colors.muted : colors.primary,
            opacity: hasInputErrors ? 0.5 : 1,
          }}
          className="flex-1 py-3 rounded-lg items-center active:opacity-70"
        >
          <Text className="text-white font-semibold">Validate & Set</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onClear}
          style={{ backgroundColor: colors.muted + "30" }}
          className="flex-1 py-3 rounded-lg items-center active:opacity-70"
        >
          <Text className="text-foreground font-semibold">Clear</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// --- Container (Logic & State) ---

export function StartPointConfig() {
  const colors = useColors();
  const { state, dispatch } = useRouting();
  const [latInput, setLatInput] = useState(
    state.configuration.startPoint?.coordinates.latitude.toString() || "",
  );
  const [lonInput, setLonInput] = useState(
    state.configuration.startPoint?.coordinates.longitude.toString() || "",
  );
  const [nameInput, setNameInput] = useState(
    state.configuration.startPoint?.name || "",
  );
  const [error, setError] = useState<string | null>(null);
  const [latError, setLatError] = useState<string | null>(null);
  const [lonError, setLonError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const validateLatitude = (value: string): boolean => {
    if (!value.trim()) {
      setLatError(null);
      return true;
    }

    if (value === "-" || value === "." || value === "-.") {
      setLatError(null);
      return true;
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
      setLatError("Must be a number");
      return false;
    }
    if (num < -90 || num > 90) {
      setLatError("Must be between -90 and 90");
      return false;
    }
    setLatError(null);
    return true;
  };

  const validateLongitude = (value: string): boolean => {
    if (!value.trim()) {
      setLonError(null);
      return true;
    }

    if (value === "-" || value === "." || value === "-.") {
      setLonError(null);
      return true;
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
      setLonError("Must be a number");
      return false;
    }
    if (num < -180 || num > 180) {
      setLonError("Must be between -180 and 180");
      return false;
    }
    setLonError(null);
    return true;
  };

  const handleLatChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    setLatInput(cleaned);
    validateLatitude(cleaned);
  };

  const handleLonChange = (value: string) => {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    setLonInput(cleaned);
    validateLongitude(cleaned);
  };

  const handleValidate = () => {
    if (Platform.OS !== "web") {
      hapticImpact();
    }
    setError(null);

    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);

    if (isNaN(lat)) {
      setError("Latitude must be a valid number");
      return;
    }

    if (isNaN(lon)) {
      setError("Longitude must be a valid number");
      return;
    }

    if (!validateCoordinates(lat, lon)) {
      setError(
        "Coordinates out of range. Latitude: -90 to 90, Longitude: -180 to 180",
      );
      return;
    }

    dispatch({
      type: "SET_START_POINT",
      payload: {
        coordinates: { latitude: lat, longitude: lon },
        name: nameInput || undefined,
        isValid: true,
      },
    });

    dispatch({
      type: "ADD_LOG_ENTRY",
      payload: generateLogEntry(
        `Start point set: ${lat.toFixed(6)}, ${lon.toFixed(6)}${nameInput ? ` (${nameInput})` : ""}`,
        "success",
      ),
    });

    if (Platform.OS !== "web") {
      hapticNotification(NotificationFeedbackType.Success);
    }
  };

  const handleClear = () => {
    if (Platform.OS !== "web") {
      hapticImpact();
    }
    setLatInput("");
    setLonInput("");
    setNameInput("");
    setError(null);
    setLatError(null);
    setLonError(null);
    dispatch({ type: "SET_START_POINT", payload: undefined });
    dispatch({
      type: "ADD_LOG_ENTRY",
      payload: generateLogEntry(
        "Start point cleared - will use graph centroid",
        "info",
      ),
    });
  };

  const handleUseCurrentLocation = async () => {
    if (Platform.OS !== "web") {
      hapticImpact();
    }
    setLocationError(null);
    setError(null);
    setLocationLoading(true);

    try {
      if (Platform.OS === "web") {
        if (!navigator?.geolocation) {
          setLocationError("Geolocation is not supported by this browser");
          return;
        }
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 60000,
            });
          },
        );
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setLatInput(lat.toFixed(6));
        setLonInput(lon.toFixed(6));
        setNameInput((prev) => prev || "Current location");
        setLatError(null);
        setLonError(null);
        dispatch({
          type: "SET_START_POINT",
          payload: {
            coordinates: { latitude: lat, longitude: lon },
            name: "Current location",
            isValid: true,
          },
        });
        dispatch({
          type: "ADD_LOG_ENTRY",
          payload: generateLogEntry(
            `Start point set from current location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
            "success",
          ),
        });
      } else {
        const Location = await import("expo-location");
        const getCurrentPositionAsync = (Location as any).getCurrentPositionAsync || (Location.default && (Location.default as any).getCurrentPositionAsync);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocationError("Location permission is required");
          return;
        }
        if (!getCurrentPositionAsync) throw new Error("Could not load location module");
        const location = await getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });
        const lat = location.coords.latitude;
        const lon = location.coords.longitude;
        setLatInput(lat.toFixed(6));
        setLonInput(lon.toFixed(6));
        setNameInput((prev) => prev || "Current location");
        setLatError(null);
        setLonError(null);
        dispatch({
          type: "SET_START_POINT",
          payload: {
            coordinates: { latitude: lat, longitude: lon },
            name: "Current location",
            isValid: true,
          },
        });
        dispatch({
          type: "ADD_LOG_ENTRY",
          payload: generateLogEntry(
            `Start point set from current location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
            "success",
          ),
        });
        hapticNotification(NotificationFeedbackType.Success);
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not get current location";
      setLocationError(message);
    } finally {
      setLocationLoading(false);
    }
  };

  const isValid = state.configuration.startPoint?.isValid;
  const hasInputErrors = !!latError || !!lonError;

  return (
    <StartPointConfigUI
      latInput={latInput}
      lonInput={lonInput}
      nameInput={nameInput}
      error={error}
      latError={latError}
      lonError={lonError}
      locationLoading={locationLoading}
      locationError={locationError}
      hasInputErrors={hasInputErrors}
      isValid={isValid}
      startPointConfig={state.configuration.startPoint}
      colors={colors}
      onLatChange={handleLatChange}
      onLonChange={handleLonChange}
      onNameChange={setNameInput}
      onValidate={handleValidate}
      onClear={handleClear}
      onUseCurrentLocation={handleUseCurrentLocation}
    />
  );
}
