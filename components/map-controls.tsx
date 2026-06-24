import React from "react";
import { View, TouchableOpacity, Text, Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";

export interface MapControlsProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitBounds?: () => void;
  onToggleRoute?: () => void;
  onToggleMarkers?: () => void;
  showRoute?: boolean;
  showMarkers?: boolean;
}

/**
 * Map controls for interactive map features
 */
export function MapControls({
  onZoomIn,
  onZoomOut,
  onFitBounds,
  onToggleRoute,
  onToggleMarkers,
  showRoute = true,
  showMarkers = true,
}: MapControlsProps) {
  const colors = useColors();

  return (
    <View
      style={{
        position: "absolute",
        top: Platform.OS === "web" ? 10 : 60, // Higher on mobile to avoid status bar
        right: 10,
        zIndex: 1000,
        gap: 8,
      }}
    >
      {/* Zoom Controls */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 8,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <TouchableOpacity
          onPress={onZoomIn}
          accessibilityLabel="Zoom In"
          accessibilityRole="button"
          accessibilityHint="Zooms the map in"
          style={{
            padding: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontSize: 18,
              fontWeight: "bold",
            }}
          >
            +
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onZoomOut}
          accessibilityLabel="Zoom Out"
          accessibilityRole="button"
          accessibilityHint="Zooms the map out"
          style={{ padding: 8 }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontSize: 18,
              fontWeight: "bold",
            }}
          >
            −
          </Text>
        </TouchableOpacity>
      </View>

      {/* Fit Bounds Button */}
      {onFitBounds && (
        <TouchableOpacity
          onPress={onFitBounds}
          accessibilityLabel="Fit to Route"
          accessibilityRole="button"
          accessibilityHint="Adjusts the map view to show the entire route"
          style={{
            backgroundColor: colors.primary,
            borderRadius: 8,
            padding: 10,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: colors.background,
              fontSize: 14,
              fontWeight: "600",
            }}
          >
            Fit
          </Text>
        </TouchableOpacity>
      )}

      {/* Toggle Route */}
      {onToggleRoute && (
        <TouchableOpacity
          onPress={onToggleRoute}
          accessibilityLabel={showRoute ? "Hide Route" : "Show Route"}
          accessibilityRole="button"
          accessibilityHint="Toggles the visibility of the route on the map"
          style={{
            backgroundColor: showRoute ? colors.primary : colors.surface,
            borderRadius: 8,
            padding: 10,
            alignItems: "center",
            borderWidth: 1,
            borderColor: showRoute ? colors.primary : colors.border,
          }}
        >
          <Text
            style={{
              color: showRoute ? colors.background : colors.foreground,
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            Route
          </Text>
        </TouchableOpacity>
      )}

      {/* Toggle Markers */}
      {onToggleMarkers && (
        <TouchableOpacity
          onPress={onToggleMarkers}
          accessibilityLabel={showMarkers ? "Hide Collection Points" : "Show Collection Points"}
          accessibilityRole="button"
          accessibilityHint="Toggles the visibility of collection points on the map"
          style={{
            backgroundColor: showMarkers ? colors.primary : colors.surface,
            borderRadius: 8,
            padding: 10,
            alignItems: "center",
            borderWidth: 1,
            borderColor: showMarkers ? colors.primary : colors.border,
          }}
        >
          <Text
            style={{
              color: showMarkers ? colors.background : colors.foreground,
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            Points
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
