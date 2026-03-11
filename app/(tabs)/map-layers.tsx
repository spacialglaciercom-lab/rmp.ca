/**
 * Map Layers screen - Layer Picker interface
 * Provides comprehensive map layer and display option controls
 */
import React, { Suspense, lazy } from "react";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";

const LayerPickerContent = lazy(
  () => import("@/components/mapTab/layers/LayerPickerContent"),
);

export default function MapLayersScreen() {
  return (
    <Suspense
      fallback={
        <TabScreenSkeleton
          title="Map Layers"
          subtitle="Customize your map appearance..."
        />
      }
    >
      <LayerPickerContent />
    </Suspense>
  );
}
