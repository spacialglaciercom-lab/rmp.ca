import React from "react";
import { View } from "react-native";
import { useMapDisplayStore } from "@/stores/mapDisplayStore";
import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";
import { ToggleSwitchRow } from "@/components/shared/ToggleSwitchRow";

const OVERLAYS: {
  key: "showCollectionZones" | "showStreetNames" | "showPOIs";
  label: string;
}[] = [
  { key: "showCollectionZones", label: "Route Collection Zones" },
  { key: "showStreetNames", label: "Street Names" },
  { key: "showPOIs", label: "POI Icons" },
];

export function OverlayToggles() {
  const colors = useColors();
  const store = useMapDisplayStore();

  return (
    <View style={{ paddingVertical: 4 }}>
      <SectionLabel
        color={colors.primary}
        style={{ marginTop: 0, marginBottom: 12 }}
      >
        Overlays
      </SectionLabel>
      {OVERLAYS.map(({ key, label }) => {
        const setter =
          key === "showCollectionZones"
            ? store.setShowCollectionZones
            : key === "showStreetNames"
              ? store.setShowStreetNames
              : store.setShowPOIs;
        return (
          <ToggleSwitchRow
            key={key}
            label={label}
            value={store[key]}
            onValueChange={setter}
          />
        );
      })}
    </View>
  );
}
