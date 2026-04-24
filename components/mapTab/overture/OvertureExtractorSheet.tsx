/**
 * Overture Extractor — Bottom sheet for Overture GeoJSON route optimization.
 * Uses the Python/FastAPI Chinese Postman backend instead of OSM/Overpass.
 * Collapsible so you can hide the panel to interact with the map.
 */

import React, { useState, useCallback, useEffect } from "react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { OvertureExtractorContent } from "./OvertureExtractorContent";
import type { LatLonPoint } from "@/lib/overpassService";
import type {
  GeoJSONFeatureCollection,
  OptimizeResponse,
} from "@/services/overtureOptimizerService";

interface OvertureExtractorSheetProps {
  visible: boolean;
  onClose: () => void;
  points: LatLonPoint[];
  onClearPoints: () => void;
  onOptimizeRoute: (
    geojson: GeoJSONFeatureCollection,
    options?: {
      startLat?: number;
      startLon?: number;
      roadClasses?: string[];
      onewayMode?: string;
    },
  ) => void;
  optimizing?: boolean;
  optimizationStatus?: string;
  lastResult?: OptimizeResponse | null;
}

export function OvertureExtractorSheet({
  visible,
  onClose,
  points = [],
  onClearPoints,
  onOptimizeRoute,
  optimizing = false,
  optimizationStatus = "",
  lastResult = null,
}: OvertureExtractorSheetProps) {
  const [collapsed, setCollapsed] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  useEffect(() => {
    if (visible) setCollapsed(false);
  }, [visible]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Overture Route Optimizer"
      maxHeight={lastResult ? "50%" : "34%"}
      dismissOnBackdrop={false}
      renderInline
      collapsible
      collapsed={collapsed}
      onCollapseToggle={toggleCollapsed}
      collapsedHeight={56}
    >
      <OvertureExtractorContent
        points={points}
        onClearPoints={onClearPoints}
        onOptimizeRoute={onOptimizeRoute}
        optimizing={optimizing}
        optimizationStatus={optimizationStatus}
        lastResult={lastResult}
      />
    </BottomSheet>
  );
}

OvertureExtractorSheet.displayName = "OvertureExtractorSheet";
