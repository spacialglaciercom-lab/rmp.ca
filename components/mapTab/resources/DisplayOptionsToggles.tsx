import React from "react";
import { View } from "react-native";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";
import { ToggleSwitchRow } from "@/components/shared/ToggleSwitchRow";

const DISPLAY_OPTIONS: {
  key: "showScaleBar" | "showCompass" | "showZoomControls";
  label: string;
}[] = [
  { key: "showScaleBar", label: "Scale Bar" },
  { key: "showCompass", label: "Compass" },
  { key: "showZoomControls", label: "Zoom Controls" },
];

const WIDGET_OPTIONS: {
  key:
    | "showMapillary"
    | "showSpeed"
    | "transparentWidgets"
    | "showRouteMarkers"
    | "showRouteLine";
  label: string;
  description?: string;
}[] = [
  {
    key: "showMapillary",
    label: "Mapillary",
    description: "Street View / Mapillary button when a location is selected",
  },
  {
    key: "showSpeed",
    label: "Speed",
    description: "Show current speed during navigation",
  },
  {
    key: "transparentWidgets",
    label: "Transparent widgets",
    description: "Use semi-transparent map overlay controls",
  },
  {
    key: "showRouteMarkers",
    label: "Route markers",
    description: "Show numbered stops and point markers on the map",
  },
  {
    key: "showRouteLine",
    label: "Route line",
    description: "Show route polyline on the map",
  },
];

function DisplayOptionsTogglesInner() {
  const colors = useColors();
  const store = useMapDisplayStore();

  return (
    <View style={{ paddingVertical: 4 }}>
      <SectionLabel
        color={colors.primary}
        style={{ marginTop: 0, marginBottom: 12 }}
      >
        Display options
      </SectionLabel>
      {DISPLAY_OPTIONS.map(({ key, label }) => {
        const setter =
          key === "showScaleBar"
            ? store.setShowScaleBar
            : key === "showCompass"
              ? store.setShowCompass
              : store.setShowZoomControls;
        return (
          <ToggleSwitchRow
            key={key}
            label={label}
            value={store[key]}
            onValueChange={setter}
          />
        );
      })}
      <SectionLabel
        color={colors.primary}
        style={{ marginTop: 20, marginBottom: 12 }}
      >
        Map & widgets
      </SectionLabel>
      {WIDGET_OPTIONS.map(({ key, label, description }) => {
        const setter =
          key === "showMapillary"
            ? store.setShowMapillary
            : key === "showSpeed"
              ? store.setShowSpeed
              : key === "transparentWidgets"
                ? store.setTransparentWidgets
                : key === "showRouteMarkers"
                  ? store.setShowRouteMarkers
                  : store.setShowRouteLine;
        return (
          <ToggleSwitchRow
            key={key}
            label={label}
            value={store[key]}
            onValueChange={setter}
            description={description}
          />
        );
      })}
    </View>
  );
}

export const DisplayOptionsToggles = React.memo(DisplayOptionsTogglesInner);
