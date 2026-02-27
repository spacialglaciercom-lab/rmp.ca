import React from "react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { MapSourcePicker } from "./MapSourcePicker";

interface MapStyleSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function MapStyleSheet({ visible, onClose }: MapStyleSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Map style" maxHeight="40%">
      <MapSourcePicker />
    </BottomSheet>
  );
}
