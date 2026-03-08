import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Linking, Alert } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";

interface RouteActionChipsProps {
  hasTapDestination?: boolean;
  hasSelectedLocation?: boolean;
  canStartNavigation?: boolean;
  onDirectionsHere?: () => void;
  onStreetView?: () => void;
  /** Open Mapillary to contribute images. Shown next to Street View when Mapillary is on. */
  onContributeImages?: () => void;
  onStartNavigation?: () => void;
  /** Start collection route (in-app navigator with segment tracking). */
  onStartCollectionRoute?: () => void;
  /** Navigate to destination via external app (Google Maps / Apple Maps / Waze). */
  onNavigateExternal?: () => void;
  onFixToRoads?: () => void;
  onClearRoute?: () => void;
  onDownloadGPX?: () => void;
  onDrivePreview?: () => void;
  onOpenInGoogle?: () => void;
  directionsLoading?: boolean;
  streetViewLoading?: boolean;
  navLoading?: boolean;
  fixToRoadsLoading?: boolean;
  /** When false, Street View chip is hidden (Configure Screen → Mapillary off). */
  showMapillary?: boolean;
}

const chipStyles = StyleSheet.create({
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  chipText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
});

function RouteActionChipsInner({
  hasTapDestination = false,
  hasSelectedLocation = false,
  canStartNavigation = false,
  onDirectionsHere,
  onStreetView,
  onContributeImages,
  onStartNavigation,
  onStartCollectionRoute,
  onNavigateExternal,
  onFixToRoads,
  onClearRoute,
  onDownloadGPX,
  onDrivePreview,
  onOpenInGoogle,
  directionsLoading = false,
  streetViewLoading = false,
  navLoading = false,
  fixToRoadsLoading = false,
  showMapillary = true,
}: RouteActionChipsProps) {
  const colors = useColors();

  const handlePress = (fn?: () => void) => {
    if (Platform.OS !== "web") hapticImpact();
    fn?.();
  };

  return (
    <View style={chipStyles.row}>
      {showMapillary && hasSelectedLocation && onStreetView && (
        <TouchableOpacity
          style={[chipStyles.chip, { backgroundColor: "#3B82F6" }]}
          onPress={() => handlePress(onStreetView)}
          disabled={streetViewLoading}
        >
          {streetViewLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={chipStyles.chipText}>Mapillary</Text>
          )}
        </TouchableOpacity>
      )}
      {showMapillary && hasSelectedLocation && onContributeImages && (
        <TouchableOpacity
          style={[chipStyles.chip, { backgroundColor: "#10B981" }]}
          onPress={() => handlePress(onContributeImages)}
        >
          <Text style={chipStyles.chipText}>Contribute images</Text>
        </TouchableOpacity>
      )}
      {hasTapDestination && (
        <TouchableOpacity
          style={[chipStyles.chip, { backgroundColor: colors.primary }]}
          onPress={() => handlePress(onDirectionsHere)}
          disabled={directionsLoading}
        >
          {directionsLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={chipStyles.chipText}>Directions here</Text>
          )}
        </TouchableOpacity>
      )}
      {(hasTapDestination || hasSelectedLocation) && onNavigateExternal && (
        <TouchableOpacity
          style={[chipStyles.chip, { backgroundColor: "#059669" }]}
          onPress={() => handlePress(onNavigateExternal)}
        >
          <Text style={chipStyles.chipText}>Navigate To</Text>
        </TouchableOpacity>
      )}
      {canStartNavigation && (
        <>
          {onStartNavigation && (
            <TouchableOpacity
              style={[
                chipStyles.chip,
                { backgroundColor: colors.primary, marginLeft: hasTapDestination ? 0 : 0 },
              ]}
              onPress={() => handlePress(onStartNavigation)}
              disabled={navLoading}
            >
              {navLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={chipStyles.chipText}>Start Navigation</Text>
              )}
            </TouchableOpacity>
          )}
          {onStartCollectionRoute && (
            <TouchableOpacity
              style={[chipStyles.chip, { backgroundColor: "#F97316" }]}
              onPress={() => handlePress(onStartCollectionRoute)}
            >
              <Text style={chipStyles.chipText}>Collection Route</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[chipStyles.chip, { backgroundColor: colors.muted + "CC" }]}
            onPress={() => handlePress(onFixToRoads)}
            disabled={fixToRoadsLoading}
          >
            {fixToRoadsLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={chipStyles.chipText}>Fix to roads</Text>
            )}
          </TouchableOpacity>
          {onClearRoute && (
            <TouchableOpacity
              style={[chipStyles.chip, { backgroundColor: (colors.error ?? "#ef4444") + "CC" }]}
              onPress={() => handlePress(onClearRoute)}
            >
              <Text style={chipStyles.chipText}>Clear route</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[chipStyles.chip, { backgroundColor: colors.muted + "CC" }]}
            onPress={() => handlePress(onDownloadGPX)}
          >
            <Text style={chipStyles.chipText}>Download GPX</Text>
          </TouchableOpacity>
          {onOpenInGoogle && (
            <TouchableOpacity
              style={[chipStyles.chip, { backgroundColor: "#EA4335" }]}
              onPress={() => handlePress(onOpenInGoogle)}
            >
              <Text style={chipStyles.chipText}>Open in Google</Text>
            </TouchableOpacity>
          )}
          {Platform.OS !== "web" && onDrivePreview && (
            <TouchableOpacity
              style={[chipStyles.chip, { backgroundColor: "#8B5CF6" }]}
              onPress={() => handlePress(onDrivePreview)}
            >
              <Text style={chipStyles.chipText}>Drive Preview</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

export const RouteActionChips = React.memo(RouteActionChipsInner);
