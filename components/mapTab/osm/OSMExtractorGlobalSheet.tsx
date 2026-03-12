/**
 * OSM Extractor sheet rendered at tab layout level so it stays visible on all tabs
 * (Map, Record, etc.) and tap-to-add-points works on whichever map is visible.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import { OSMExtractorSheet } from "./OSMExtractorSheet";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { useOsmOptimizeRoute } from "@/hooks/useOsmOptimizeRoute";

export function OSMExtractorGlobalSheet() {
  const visible = useMapSidebarStore((s) => s.osmExtractorVisible);
  const onClose = useMapSidebarStore((s) => s.closeOSMExtractor);
  const points = useMapStateStore((s) => s.osmExtractionPoints);
  const extractedData = useMapStateStore((s) => s.osmExtractedData);
  const actions = useMapActions();
  const { handleOsmOptimizeRoute, optimizing, optimizationStatus } =
    useOsmOptimizeRoute();

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <OSMExtractorSheet
        visible={visible}
        onClose={onClose}
        points={points}
        onClearPoints={() => actions.clearOsmExtraction()}
        onExtract={actions.setOsmExtractedData}
        extractedData={extractedData}
        onOptimizeRoute={handleOsmOptimizeRoute}
        optimizing={optimizing}
        optimizationStatus={optimizationStatus}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
