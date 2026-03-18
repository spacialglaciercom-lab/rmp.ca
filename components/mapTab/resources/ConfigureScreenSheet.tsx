import React from "react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { DisplayOptionsToggles } from "./DisplayOptionsToggles";

interface ConfigureScreenSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ConfigureScreenSheet({
  visible,
  onClose,
}: ConfigureScreenSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Configure screen">
      <DisplayOptionsToggles />
    </BottomSheet>
  );
}
