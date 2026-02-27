/**
 * Overture Extractor sheet rendered at tab layout level (replaces OSM extractor).
 * Uses the Python/FastAPI Chinese Postman backend for route optimization.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { OvertureExtractorSheet } from "./OvertureExtractorSheet";
import { useMapSidebarStore } from "@/stores/mapSidebarStore";
import { useMapStateStore, useMapActions } from "@/stores/mapStateStore";
import { useOvertureOptimizeRoute } from "@/hooks/useOvertureOptimizeRoute";

export function OvertureExtractorGlobalSheet() {
  const visible = useMapSidebarStore((s) => s.osmExtractorVisible);
  const onClose = useMapSidebarStore((s) => s.closeOSMExtractor);
  const points = useMapStateStore((s) => s.osmExtractionPoints);
  const actions = useMapActions();
  const {
    handleOvertureOptimizeRoute,
    optimizing,
    optimizationStatus,
    lastResult,
  } = useOvertureOptimizeRoute();

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <OvertureExtractorSheet
        visible={visible}
        onClose={onClose}
        points={points}
        onClearPoints={() => actions.clearOsmExtraction()}
        onOptimizeRoute={handleOvertureOptimizeRoute}
        optimizing={optimizing}
        optimizationStatus={optimizationStatus}
        lastResult={lastResult}
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
