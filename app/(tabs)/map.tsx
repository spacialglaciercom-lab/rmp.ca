/**
 * Lazy-loaded Map tab (Phase 1.1). RouteMap, NavigationView, mapMatching, etc.
 * load only when the user opens this tab.
 */
import React, { Suspense, lazy } from "react";

import { TabScreenSkeleton } from "@/components/tab-screen-skeleton";
import { MapErrorBoundary } from "@/components/error-boundaries/map-error-boundary";

const MapContent = lazy(() => import("@/components/map-content"));

export default function MapScreen() {
  return (
    <MapErrorBoundary>
      <Suspense
        fallback={
          <TabScreenSkeleton
            title="Map"
            subtitle="Loading map..."
          />
        }
      >
        <MapContent />
      </Suspense>
    </MapErrorBoundary>
  );
}
