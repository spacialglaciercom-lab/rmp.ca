/**
 * OSM Extractor — Bottom sheet to extract OSM data from a drawn polygon on the map.
 */

import React from "react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { OSMExtractorContent } from "./OSMExtractorContent";
import type {
  LatLonPoint,
  OverpassElement,
  ParsedOverpassResult,
} from "@/lib/overpassService";

interface OSMExtractorSheetProps {
  visible: boolean;
  onClose: () => void;
  points: LatLonPoint[];
  onClearPoints: () => void;
  onExtract: (data: ParsedOverpassResult) => void;
  extractedData: ParsedOverpassResult | null;
  onOptimizeRoute?: (rawElements: OverpassElement[]) => void;
  optimizing?: boolean;
  optimizationStatus?: string;
}

export function OSMExtractorSheet({
  visible,
  onClose,
  points = [],
  onClearPoints,
  onExtract,
  extractedData = null,
  onOptimizeRoute,
  optimizing = false,
  optimizationStatus = "",
}: OSMExtractorSheetProps) {
  const hasResults = !!extractedData?.features?.length;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="OSM Extractor"
      maxHeight={hasResults ? "85%" : "50%"}
      dismissOnBackdrop={false}
      renderInline
    >
      <OSMExtractorContent
        points={points}
        onClearPoints={onClearPoints}
        onExtract={onExtract}
        extractedData={extractedData}
        onOptimizeRoute={onOptimizeRoute}
        optimizing={optimizing}
        optimizationStatus={optimizationStatus}
      />
    </BottomSheet>
  );
}
OSMExtractorSheet.displayName = "OSMExtractorSheet";
